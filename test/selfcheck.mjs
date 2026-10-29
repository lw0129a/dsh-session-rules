// Self-check for the host half: no framework, run with `npm test`.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

const home = mkdtempSync(path.join(tmpdir(), 'dsh-session-rules-'))
process.env.DSH_HOME = home

const { __test } = await import('../dist/index.js')
const { rulesFor, entryOf, idCandidates, workspaceOf, ancestorsOf, knownWorkspaces, handleRequest, readStore, apply } = __test

// The editor's list helpers live in the browser bundle, so pull their source
// out and exercise it: markers continue themselves, ordered markers count up,
// Enter on an empty item closes the list, Tab shifts two spaces per level.
function sourceOf(name) {
  const source = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `${name} exists`)
  let depth = 0
  let end = start
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) {
        end = index + 1
        break
      }
    }
  }
  return source.slice(start, end)
}

const clientBundle = readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8')
// The web renderer has no Node globals: touching any of them kills the whole
// client bundle at load time (0.7.4 shipped `process.platform` and did exactly that).
for (const [pattern, why] of [
  [/\bprocess\s*\./, 'process'],
  [/\b__dirname\b/, '__dirname'],
  [/\b__filename\b/, '__filename'],
  [/\bBuffer\s*\./, 'Buffer'],
  [/\brequire\(\s*['"]node:/, 'node: modules'],
]) {
  assert.doesNotMatch(clientBundle, pattern, `browser bundle must not access ${why}`)
}

const clientSource = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
const listItemLine = [
  'const LIST_ITEM =',
  'const MARKERS_BY_DEPTH =',
].map((needle) =>
  clientSource.slice(clientSource.indexOf(needle), clientSource.indexOf('\n', clientSource.indexOf(needle))),
).join('\n')
const { listContinuation, indentLine } = new Function(`
  const INDENT = '  '
  ${listItemLine}
  ${sourceOf('nextMarker')}
  ${sourceOf('nextLetter')}
  ${sourceOf('listContinuation')}
  ${sourceOf('markerAtDepth')}
  ${sourceOf('indentLine')}
  return { listContinuation, indentLine }
`)()

assert.equal(listContinuation('- 需要编写样式'), '- ')
assert.equal(listContinuation('  1) 使用 tailwind-utils 原子类'), '  2) ')
assert.equal(listContinuation('(1) 禁止 <style>'), '(2) ')
assert.equal(listContinuation('1. 先跑测试'), '2. ')
assert.equal(listContinuation('a. 第三层'), 'b. ')
assert.equal(listContinuation('(z) 最后一项'), '(a) ')
assert.equal(listContinuation('- '), '')
assert.equal(listContinuation('普通段落'), '')
assert.equal(indentLine('- 需要编写样式', 1), '  1. 需要编写样式')
assert.equal(indentLine('  1. 使用原子类', 1), '    (1) 使用原子类')
assert.equal(indentLine('    (1) 禁止 <style>', -1), '  1. 禁止 <style>')
assert.equal(indentLine('  1. 使用原子类', -1), '- 使用原子类')
assert.equal(indentLine('    (1) 三级', 1), '      a. 三级')
assert.equal(indentLine('      a. 四级', 1), '        (a) 四级')
assert.equal(indentLine('        (a) 五级', 1), '          (a) 五级', 'past level five the marker repeats')
assert.equal(indentLine('普通段落', 1), '  普通段落')

// Undo / redo: one snapshot per burst, so a run of typing undoes in one step.
const { createHistory, historyRecord, historyUndo, historyRedo } = new Function(`
  ${sourceOf('createHistory')}
  ${sourceOf('sharedPrefixLength')}
  ${sourceOf('historyRecord')}
  ${sourceOf('historyUndo')}
  ${sourceOf('historyRedo')}
  return { createHistory, historyRecord, historyUndo, historyRedo }
`)()
const history = createHistory('')
historyRecord(history, 'a')
historyRecord(history, 'ab')
historyRecord(history, 'abc')
assert.equal(history.past.length, 1, 'a typing burst is one snapshot (the empty start)')
assert.equal(historyUndo(history), '', 'a typing burst undoes as one step')
assert.equal(historyRedo(history), 'abc')
historyRecord(history, 'abc\n- 另一条')
assert.equal(historyUndo(history), 'abc')
assert.equal(historyRedo(history), 'abc\n- 另一条')
assert.equal(historyRedo(history), undefined)

// Activating the plugin must never fail the whole web boot: a host that
// refuses every service still has to leave the app running.
assert.doesNotThrow(() =>
  apply({
    inject() {
      throw new Error('no systemPrompt')
    },
    effect() {},
    logger: { warn() {} },
  }),
)
assert.doesNotThrow(() =>
  apply({
    inject() {
      throw new Error('no webServer')
    },
    logger: { warn() {} },
  }),
)
// A working host registers both entry points exactly once.
{
  const calls = []
  apply({
    inject(services, register) {
      calls.push(services.join(','))
      register({
        systemPrompt: { section: () => ({}) },
        webServer: { register: () => ({}) },
        effect: (factory) => factory(),
        logger: { warn() {} },
      })
    },
    logger: { warn() {} },
  })
  assert.deepEqual(calls, ['systemPrompt', 'webServer'])
}

// Session ids reach us as `session-<uuid>` in the client and at prompt
// assembly; the store must find either spelling.
assert.deepEqual(idCandidates('session-abc'), ['session-abc', 'abc'])
assert.deepEqual(idCandidates('abc'), ['abc', 'session-abc'])

// Missing / malformed store entries degrade to empty, disabled rules.
assert.deepEqual(entryOf({}, 'abc'), { rules: '', sources: [], enabled: false, inherit: [] })
assert.deepEqual(entryOf({ abc: { rules: 42, sources: 'x' } }, 'abc'), { rules: '', sources: [], enabled: false, inherit: [] })
assert.equal(rulesFor('abc'), '')

const storeDir = path.join(home, 'plugin-data', 'dsh-session-rules')
mkdirSync(storeDir, { recursive: true })
const store = (value) => writeFileSync(path.join(storeDir, 'rules.json'), JSON.stringify(value))

// Everything is off by default: saved text without the switch is inert.
store({ abc: { rules: '先跑测试\n只改相关文件', sources: ['AGENTS.md'] } })
assert.equal(rulesFor('abc'), '')
assert.equal(rulesFor('session-abc'), '')

store({ abc: { rules: '先跑测试\n只改相关文件', sources: ['AGENTS.md'], enabled: true } })

// The bare uuid and the prefixed form both resolve the same rules.
assert.equal(rulesFor('abc'), '先跑测试\n只改相关文件')
assert.equal(rulesFor('session-abc'), '先跑测试\n只改相关文件')
assert.equal(rulesFor('session-other'), '')

// Unsafe ids never touch the store.
assert.equal(rulesFor('../etc/passwd'), '')

// A disabled entry injects nothing even with rules saved.
store({ abc: { rules: '先跑测试', sources: [], enabled: false } })
assert.equal(rulesFor('abc'), '')
assert.equal(rulesFor('session-abc'), '')

// Workspace rules: registered workspaces nest by path. A session's `inherit`
// holds the absolute paths of the levels it pulls in ('*' = the whole chain).
const workspaces = {
  parent: { path: '/tmp/ws-parent', title: 'anjuyi', sessionIds: ['parent-session'] },
  app: { path: '/tmp/ws-parent/app', title: 'uni-platform-app', sessionIds: ['session-abc'] },
  other: { path: '/tmp/ws-other', title: 'other', sessionIds: ['session-xyz'] },
}
mkdirSync(path.join(home, 'storages'), { recursive: true })
writeFileSync(
  path.join(home, 'storages', 'workspace.json'),
  JSON.stringify({ unit: 'x', global: {}, tables: { workspaces } }),
)

store({
  abc: { rules: '本会话：先跑测试', sources: [], enabled: true },
  xyz: { rules: '', sources: [], enabled: false, inherit: true },
})
assert.equal(rulesFor('abc'), '本会话：先跑测试')
assert.equal(rulesFor('xyz'), '')

// Opting into a parent prepends it; the parent is read-only from the child.
store({
  'ws:/tmp/ws-parent': { rules: '上层：统一用 pnpm' },
  'ws:/tmp/ws-parent/app': { rules: '本层：先跑测试' },
  abc: { rules: '', sources: [], enabled: false, inherit: true },
})
// The legacy boolean means "the whole chain".
assert.equal(rulesFor('abc'), '上层：统一用 pnpm\n\n本层：先跑测试')

store({
  'ws:/tmp/ws-parent': { rules: '上层：统一用 pnpm' },
  'ws:/tmp/ws-parent/app': { rules: '本层：先跑测试', inherit: ['/tmp/ws-parent'] },
  abc: { rules: '', sources: [], enabled: false, inherit: true },
})
assert.equal(rulesFor('abc'), '上层：统一用 pnpm\n\n本层：先跑测试')

// A session that has not opted in gets nothing from its workspace.
store({
  'ws:/tmp/ws-parent/app': { rules: '本层：先跑测试', inherit: ['/tmp/ws-parent'] },
  abc: { rules: '', sources: [], enabled: false, inherit: [] },
})
assert.equal(rulesFor('abc'), '')

// Levels are picked one by one: only the listed ones are injected.
store({
  'ws:/tmp/ws-parent': { rules: '上层：统一用 pnpm' },
  'ws:/tmp/ws-parent/app': { rules: '本层：先跑测试' },
  abc: { rules: '', sources: [], enabled: false, inherit: ['/tmp/ws-parent'] },
})
assert.equal(rulesFor('abc'), '上层：统一用 pnpm')

// Overlapping levels: a child that already repeats its parent's block must not
// duplicate those lines when the session ticks both.
store({
  'ws:/tmp/ws-parent': { rules: '- 共用：统一用 pnpm\n- 上层：提交前跑测试' },
  'ws:/tmp/ws-parent/app': { rules: '- 共用：统一用 pnpm\n- 本层：先跑测试', inherit: ['/tmp/ws-parent'] },
  abc: { rules: '- 共用：统一用 pnpm\n- 会话：中文回复', sources: [], enabled: true, inherit: ['/tmp/ws-parent', '/tmp/ws-parent/app'] },
})
assert.equal(
  rulesFor('abc'),
  '- 共用：统一用 pnpm\n- 上层：提交前跑测试\n\n- 本层：先跑测试\n\n- 会话：中文回复',
)

// Unknown paths in the list are ignored.
store({ 'ws:/tmp/ws-parent/app': { rules: '本层：先跑测试' }, abc: { rules: '', sources: [], enabled: false, inherit: ['/etc'] } })
assert.equal(rulesFor('abc'), '')

// Both levels ticked, outermost first.
store({
  'ws:/tmp/ws-parent': { rules: '上层：统一用 pnpm' },
  'ws:/tmp/ws-parent/app': { rules: '本层：先跑测试' },
  abc: { rules: '', sources: [], enabled: false, inherit: ['/tmp/ws-parent/app', '/tmp/ws-parent'] },
})
assert.equal(rulesFor('abc'), '上层：统一用 pnpm\n\n本层：先跑测试')

// Another workspace's rules never reach this session.
store({
  'ws:/tmp/ws-other': { rules: '别的工作区' },
  abc: { rules: '', sources: [], enabled: false, inherit: true },
})
assert.equal(rulesFor('abc'), '')

// Ancestors come outermost first and only from the registry.
assert.deepEqual(
  ancestorsOf('/tmp/ws-parent/app').map((item) => item.path),
  ['/tmp/ws-parent'],
)
assert.deepEqual(ancestorsOf('/tmp/ws-parent'), [])

// HTTP: the dialog reads the workspace tree in one request.
const ctx = { get: () => ({ requestRejection: () => undefined }), logger: { warn() {} } }
function fakeResponse() {
  return {
    status: 0,
    payload: '',
    writeHead(status) {
      this.status = status
    },
    end(text) {
      this.payload = text
    },
  }
}
const listRes = fakeResponse()
await handleRequest(ctx, { method: 'GET', url: '/__chameleon/session/rules?workspaces=1', headers: {} }, listRes)
const list = JSON.parse(listRes.payload).workspaces
assert.deepEqual(
  list.map((item) => item.title),
  ['other', 'anjuyi', 'uni-platform-app'],
)
assert.deepEqual(
  list.find((item) => item.title === 'uni-platform-app').ancestors.map((item) => item.title),
  ['anjuyi'],
)

// A session that never saved anything starts with nothing ticked, even when
// its workspace levels do have content.
store({ 'ws:/tmp/ws-parent/app': { rules: '本层：先跑测试' } })
const freshRes = fakeResponse()
await handleRequest(ctx, { method: 'GET', url: '/__chameleon/session/rules?sessionId=session-abc', headers: {} }, freshRes)
const fresh = JSON.parse(freshRes.payload)
assert.deepEqual(fresh.inherit, [])
assert.ok(fresh.shared.layers.every((layer) => layer.selected === false))

// Saving a workspace block validates the path against the registry.
const saveRes = fakeResponse()
const saveBody = JSON.stringify({
  action: 'save-workspace',
  path: '/tmp/ws-parent/app',
  rules: '本层：先跑测试',
  inherit: ['/tmp/ws-parent', '/etc'],
})
await handleRequest(
  ctx,
  Object.assign(Readable.from([Buffer.from(saveBody)]), {
    method: 'POST',
    url: '/__chameleon/session/rules',
    headers: {},
  }),
  saveRes,
)
assert.equal(saveRes.status, 200)
assert.deepEqual(JSON.parse(readFileSync(path.join(storeDir, 'rules.json'), 'utf8'))['ws:/tmp/ws-parent/app'].inherit, ['/tmp/ws-parent'])

const badRes = fakeResponse()
await handleRequest(
  ctx,
  Object.assign(Readable.from([Buffer.from(JSON.stringify({ action: 'save-workspace', path: '/etc', rules: 'x' }))]), {
    method: 'POST',
    url: '/__chameleon/session/rules',
    headers: {},
  }),
  badRes,
)
assert.equal(badRes.status, 404)

// A workspace that has no session yet can still be configured: it shows up in
// the panel and its rules save normally. Sessions in it start with nothing
// ticked until the user opts in.
writeFileSync(
  path.join(home, 'storages', 'workspace.json'),
  JSON.stringify({
    tables: {
      workspaces: {
        fresh: { path: '/tmp/ws-fresh', title: '新建工作区', sessionIds: [] },
      },
    },
  }),
)
const freshListRes = fakeResponse()
await handleRequest(ctx, { method: 'GET', url: '/__chameleon/session/rules?workspaces=1', headers: {} }, freshListRes)
const freshList = JSON.parse(freshListRes.payload).workspaces
assert.deepEqual(freshList.map((item) => item.path), ['/tmp/ws-fresh'])
assert.equal(freshList[0].rules, '')
assert.deepEqual(freshList[0].inherit, [])

const freshSaveRes = fakeResponse()
await handleRequest(
  ctx,
  Object.assign(Readable.from([Buffer.from(JSON.stringify({ action: 'save-workspace', path: '/tmp/ws-fresh', rules: '新工作区默认不启用', inherit: [] }))]), {
    method: 'POST',
    url: '/__chameleon/session/rules',
    headers: {},
  }),
  freshSaveRes,
)
assert.equal(freshSaveRes.status, 200)
assert.equal(readStore()['ws:/tmp/ws-fresh'].rules, '新工作区默认不启用')

// No session exists in it yet, so nothing is injected anywhere.
assert.equal(rulesFor('session-anything'), '')

// The store is cached by file stamp, so an edit made behind our back has to
// invalidate it instead of serving stale rules for the rest of the process.
const storePath = path.join(home, 'plugin-data', 'dsh-session-rules', 'rules.json')
const external = JSON.parse(readFileSync(storePath, 'utf8'))
external['ws:/tmp/ws-fresh'].rules = '外部改动'
writeFileSync(storePath, JSON.stringify(external))
const bumped = new Date(Date.now() + 5000)
utimesSync(storePath, bumped, bumped)
assert.equal(readStore()['ws:/tmp/ws-fresh'].rules, '外部改动')

// Only registered workspaces are levels: the sidebar's own grouping option
// (分组方式 → 按工作区树) is what makes the tree, not this plugin.
writeFileSync(
  path.join(home, 'storages', 'workspace.json'),
  JSON.stringify({
    tables: {
      workspaces: {
        only: { path: '/tmp/ws-parent/app', title: 'app', sessionIds: ['session-abc'] },
      },
    },
  }),
)
assert.deepEqual(knownWorkspaces().map((item) => item.path), ['/tmp/ws-parent/app'])
assert.deepEqual(ancestorsOf('/tmp/ws-parent/app').map((item) => item.path), [])

// Nesting is decided by the path relation, not by string prefixes: a deeper
// directory under a registered workspace is its child, duplicate slashes still
// resolve to the same workspace, and a sibling with a longer name is not a
// parent. Same rule carries the Windows separator.
assert.deepEqual(ancestorsOf('/tmp/ws-parent/app/deep').map((item) => item.path), ['/tmp/ws-parent/app'])
assert.deepEqual(ancestorsOf('/tmp/ws-parent//app').map((item) => item.path), [])
assert.deepEqual(ancestorsOf('/tmp/ws-parent/app2').map((item) => item.path), [])

// Deleting a workspace or a session drops its block on the next read.
writeFileSync(
  path.join(home, 'storages', 'workspace.json'),
  JSON.stringify({ tables: { workspaces: { keep: { path: '/tmp/ws-keep', title: 'keep', sessionIds: ['session-keep'] } } } }),
)
mkdirSync(path.join(home, 'sessions', '--tmp-ws-keep--', 'session-keep'), { recursive: true })
writeFileSync(
  path.join(storeDir, 'rules.json'),
  JSON.stringify({
    'ws:/tmp/ws-keep': { rules: '保留' },
    'ws:/tmp/ws-gone': { rules: '已删工作区' },
    'session-keep': { rules: '保留', inherit: [] },
    'session-gone': { rules: '已删会话', inherit: [] },
  }),
)
const pruned = readStore()
assert.deepEqual(Object.keys(pruned).sort(), ['session-keep', 'ws:/tmp/ws-keep'])
assert.deepEqual(
  Object.keys(JSON.parse(readFileSync(path.join(storeDir, 'rules.json'), 'utf8'))).sort(),
  ['session-keep', 'ws:/tmp/ws-keep'],
)

// The store is keyed by plugin name only, inside the plugin's own data
// directory: upgrading the plugin keeps every rule, and nothing else on the
// machine reads it.
assert.equal(path.join(storeDir, 'rules.json'), path.join(home, 'plugin-data', 'dsh-session-rules', 'rules.json'))
assert.ok(existsSync(path.join(storeDir, 'rules.json')))

rmSync(home, { recursive: true, force: true })
console.log('selfcheck ok')
