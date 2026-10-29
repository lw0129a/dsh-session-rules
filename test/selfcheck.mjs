// Self-check for the host half: no framework, run with `npm test`.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const home = mkdtempSync(path.join(tmpdir(), 'dsh-session-rules-'))
process.env.DSH_HOME = home

const { __test } = await import('../dist/index.js')
const { rulesFor, entryOf, idCandidates, projectFiles } = __test

// Session ids reach us as `session-<uuid>` in the client and at prompt
// assembly; the store must find either spelling.
assert.deepEqual(idCandidates('session-abc'), ['session-abc', 'abc'])
assert.deepEqual(idCandidates('abc'), ['abc', 'session-abc'])

// Missing / malformed store entries degrade to empty rules.
assert.deepEqual(entryOf({}, 'abc'), { rules: '', sources: [], enabled: true, inherit: false })
assert.deepEqual(entryOf({ abc: { rules: 42, sources: 'x' } }, 'abc'), { rules: '', sources: [], enabled: true, inherit: false })
assert.equal(rulesFor('abc'), '')

const storeDir = path.join(home, 'plugin-data', 'dsh-session-rules')
mkdirSync(storeDir, { recursive: true })
writeFileSync(
  path.join(storeDir, 'rules.json'),
  JSON.stringify({ abc: { rules: '先跑测试\n只改相关文件', sources: ['AGENTS.md'] } }),
)

// The bare uuid and the prefixed form both resolve the same rules.
assert.equal(rulesFor('abc'), '先跑测试\n只改相关文件')
assert.equal(rulesFor('session-abc'), '先跑测试\n只改相关文件')
assert.equal(rulesFor('session-other'), '')

// Unsafe ids never touch the store.
assert.equal(rulesFor('../etc/passwd'), '')

// The per-session switch: a disabled entry injects nothing even with rules saved.
writeFileSync(
  path.join(storeDir, 'rules.json'),
  JSON.stringify({ abc: { rules: '先跑测试', sources: [], enabled: false } }),
)
assert.equal(rulesFor('abc'), '')
assert.equal(rulesFor('session-abc'), '')
assert.equal(entryOf(JSON.parse(JSON.stringify({ abc: { rules: 'x' } })), 'abc').enabled, true)

// Shared rules (store key '*') are off by default: a session gets them only
// after the user turns the switch on.
writeFileSync(
  path.join(storeDir, 'rules.json'),
  JSON.stringify({ '*': { rules: '通用：中文回复', sources: [] }, abc: { rules: '本会话：先跑测试', sources: [] } }),
)
assert.equal(rulesFor('abc'), '本会话：先跑测试')
assert.equal(rulesFor('session-other'), '')

writeFileSync(
  path.join(storeDir, 'rules.json'),
  JSON.stringify({ '*': { rules: '通用：中文回复', sources: [] }, abc: { rules: '本会话：先跑测试', sources: [], inherit: true } }),
)
assert.equal(rulesFor('abc'), '通用：中文回复\n\n本会话：先跑测试')
assert.equal(rulesFor('session-other'), '')

// Global rules respect the same on/off switch.
writeFileSync(path.join(storeDir, 'rules.json'), JSON.stringify({ '*': { rules: '通用：中文回复', sources: [], enabled: false } }))
assert.equal(rulesFor('abc'), '')
writeFileSync(path.join(storeDir, 'rules.json'), JSON.stringify({ '*': { rules: '通用：中文回复', sources: [] } }))
assert.equal(entryOf({ '*': { rules: 'x' } }, '*').rules, 'x')

// A session that keeps only its own rules ignores the shared ones.
writeFileSync(
  path.join(storeDir, 'rules.json'),
  JSON.stringify({ '*': { rules: '通用：中文回复', sources: [] }, abc: { rules: '本会话：先跑测试', sources: [], inherit: false } }),
)
assert.equal(rulesFor('abc'), '本会话：先跑测试')
assert.equal(rulesFor('session-other'), '')

// No sessions directory => nothing to import, and no throw.
assert.deepEqual(projectFiles('session-abc'), [])

rmSync(home, { recursive: true, force: true })
console.log('selfcheck ok')
