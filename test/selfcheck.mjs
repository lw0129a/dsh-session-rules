// Self-check for the host half: no framework, run with `npm test`.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

const home = mkdtempSync(path.join(tmpdir(), 'dsh-session-rules-'))
process.env.DSH_HOME = home

const { __test } = await import('../dist/index.js')
const { rulesFor, entryOf, idCandidates, projectFiles, workspaceOf, ancestorsOf, knownWorkspaces, handleRequest } = __test

// Session ids reach us as `session-<uuid>` in the client and at prompt
// assembly; the store must find either spelling.
assert.deepEqual(idCandidates('session-abc'), ['session-abc', 'abc'])
assert.deepEqual(idCandidates('abc'), ['abc', 'session-abc'])

// Missing / malformed store entries degrade to empty, disabled rules.
assert.deepEqual(entryOf({}, 'abc'), { rules: '', sources: [], enabled: false, inherit: false })
assert.deepEqual(entryOf({ abc: { rules: 42, sources: 'x' } }, 'abc'), { rules: '', sources: [], enabled: false, inherit: false })
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

// Workspace rules: registered workspaces nest by path, and each level opts into
// the ancestors it wants (`inherit` holds their absolute paths).
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
assert.equal(rulesFor('abc'), '本层：先跑测试')

store({
  'ws:/tmp/ws-parent': { rules: '上层：统一用 pnpm' },
  'ws:/tmp/ws-parent/app': { rules: '本层：先跑测试', inherit: ['/tmp/ws-parent'] },
  abc: { rules: '', sources: [], enabled: false, inherit: true },
})
assert.equal(rulesFor('abc'), '上层：统一用 pnpm\n\n本层：先跑测试')

// A session that has not opted in gets nothing from its workspace.
store({
  'ws:/tmp/ws-parent/app': { rules: '本层：先跑测试', inherit: ['/tmp/ws-parent'] },
  abc: { rules: '', sources: [], enabled: false, inherit: false },
})
assert.equal(rulesFor('abc'), '')

// Non-registered paths in `inherit` are ignored.
store({ 'ws:/tmp/ws-parent/app': { rules: '本层：先跑测试', inherit: ['/etc'] }, abc: { rules: '', sources: [], enabled: false, inherit: true } })
assert.equal(rulesFor('abc'), '本层：先跑测试')

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

// No sessions directory => nothing to import, and no throw.
assert.deepEqual(projectFiles('session-abc'), [])

// A parent directory that was never registered as a workspace still becomes a
// level, so the chain is hierarchical however flat the registry is.
mkdirSync('/tmp/ws-parent', { recursive: true })
mkdirSync('/tmp/ws-parent/app', { recursive: true })
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
const known = knownWorkspaces().map((item) => item.path)
assert.ok(known.includes('/tmp/ws-parent'), 'unregistered parent is a level')
assert.ok(!known.includes('/tmp'), 'shallow directories are not levels')
assert.ok(!known.includes('/'), 'the root is never a level')
assert.deepEqual(ancestorsOf('/tmp/ws-parent/app').map((item) => item.path), ['/tmp/ws-parent'])
assert.equal(knownWorkspaces().find((item) => item.path === '/tmp/ws-parent').implicit, true)

// Rules can be saved on an implicit level, and a child opts into it.
const implicitBody = JSON.stringify({ action: 'save-workspace', path: '/tmp/ws-parent', rules: '上层：统一用 pnpm' })
const implicitRes = fakeResponse()
await handleRequest(
  ctx,
  Object.assign(Readable.from([Buffer.from(implicitBody)]), {
    method: 'POST',
    url: '/__chameleon/session/rules',
    headers: {},
  }),
  implicitRes,
)
assert.equal(implicitRes.status, 200)
store({
  'ws:/tmp/ws-parent': { rules: '上层：统一用 pnpm' },
  'ws:/tmp/ws-parent/app': { rules: '本层：先跑测试', inherit: ['/tmp/ws-parent'] },
  abc: { rules: '', sources: [], enabled: false, inherit: true },
})
assert.equal(rulesFor('abc'), '上层：统一用 pnpm\n\n本层：先跑测试')

// Blocks keyed by the old encoded directory name are rewritten to the absolute
// path, so one naming scheme covers every level.
mkdirSync('/tmp/wsx', { recursive: true })
writeFileSync(
  path.join(home, 'storages', 'workspace.json'),
  JSON.stringify({ tables: { workspaces: { wsx: { path: '/tmp/wsx', title: 'wsx', sessionIds: ['session-old'] } } } }),
)
store({ 'ws:--tmp-wsx--': { rules: '旧键内容' }, old: { rules: '', sources: [], enabled: false, inherit: true } })
assert.equal(rulesFor('old'), '旧键内容')
assert.deepEqual(Object.keys(readFileSync(path.join(storeDir, 'rules.json'), 'utf8') ? JSON.parse(readFileSync(path.join(storeDir, 'rules.json'), 'utf8')) : {}).sort(), ['old', 'ws:/tmp/wsx'])

rmSync(home, { recursive: true, force: true })
console.log('selfcheck ok')
