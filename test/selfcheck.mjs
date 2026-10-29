// Self-check for the host half: no framework, run with `npm test`.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const home = mkdtempSync(path.join(tmpdir(), 'dsh-session-rules-'))
process.env.DSH_HOME = home

const { __test } = await import('../dist/index.js')
const { rulesFor, entryOf, idCandidates, projectFiles, workspaceOf } = __test

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

// Shared rules live per workspace: the sessions tree decides which block a
// session belongs to, and the session opts in with `inherit`.
mkdirSync(path.join(home, 'sessions', '--tmp-ws--'), { recursive: true })
writeFileSync(path.join(home, 'sessions', '--tmp-ws--', 'session-abc'), '')
const WS_KEY = 'ws:--tmp-ws--'

store({ [WS_KEY]: { rules: '工作区：统一用 pnpm' }, abc: { rules: '本会话：先跑测试', sources: [], enabled: true } })
assert.equal(rulesFor('abc'), '本会话：先跑测试')
assert.equal(rulesFor('session-other'), '')

store({
  [WS_KEY]: { rules: '工作区：统一用 pnpm' },
  abc: { rules: '本会话：先跑测试', sources: [], enabled: true, inherit: true },
})
assert.equal(rulesFor('abc'), '工作区：统一用 pnpm\n\n本会话：先跑测试')
assert.equal(rulesFor('session-abc'), '工作区：统一用 pnpm\n\n本会话：先跑测试')

// A session in another workspace never sees this block.
mkdirSync(path.join(home, 'sessions', '--tmp-other--'), { recursive: true })
writeFileSync(path.join(home, 'sessions', '--tmp-other--', 'session-xyz'), '')
store({
  [WS_KEY]: { rules: '工作区：统一用 pnpm' },
  xyz: { rules: '', sources: [], enabled: false, inherit: true },
})
assert.equal(rulesFor('xyz'), '')

// The shared block alone is enough: the session may keep no rules of its own.
store({ [WS_KEY]: { rules: '工作区：统一用 pnpm' }, abc: { rules: '', sources: [], enabled: false, inherit: true } })
assert.equal(rulesFor('abc'), '工作区：统一用 pnpm')

// An empty shared block injects nothing.
store({ [WS_KEY]: { rules: '   ' }, abc: { rules: '本会话：先跑测试', sources: [], enabled: true, inherit: true } })
assert.equal(rulesFor('abc'), '本会话：先跑测试')

// The workspace block is discovered from the sessions tree, not from the store.
assert.equal(workspaceOf('session-abc'), '--tmp-ws--')

// No sessions directory => nothing to import, and no throw.
assert.deepEqual(projectFiles('session-abc'), [])

rmSync(home, { recursive: true, force: true })
console.log('selfcheck ok')
