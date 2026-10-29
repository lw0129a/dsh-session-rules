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

// Shared rules (store key '*') are off by default and need both switches.
store({ '*': { rules: '通用：中文回复', sources: [] }, abc: { rules: '本会话：先跑测试', sources: [], enabled: true } })
assert.equal(rulesFor('abc'), '本会话：先跑测试')
assert.equal(rulesFor('session-other'), '')

store({
  '*': { rules: '通用：中文回复', sources: [], enabled: true },
  abc: { rules: '本会话：先跑测试', sources: [], enabled: true, inherit: true },
})
assert.equal(rulesFor('abc'), '通用：中文回复\n\n本会话：先跑测试')
assert.equal(rulesFor('session-other'), '')

// The shared block switches off on its own.
store({
  '*': { rules: '通用：中文回复', sources: [], enabled: false },
  abc: { rules: '本会话：先跑测试', sources: [], enabled: true, inherit: true },
})
assert.equal(rulesFor('abc'), '本会话：先跑测试')

// A session that keeps only its own rules ignores the shared ones.
store({
  '*': { rules: '通用：中文回复', sources: [], enabled: true },
  abc: { rules: '本会话：先跑测试', sources: [], enabled: true, inherit: false },
})
assert.equal(rulesFor('abc'), '本会话：先跑测试')
assert.equal(rulesFor('session-other'), '')

// No sessions directory => nothing to import, and no throw.
assert.deepEqual(projectFiles('session-abc'), [])

rmSync(home, { recursive: true, force: true })
console.log('selfcheck ok')
