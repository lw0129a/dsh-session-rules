// dsh-session-rules — host half.
//
// Two jobs:
//   1. Register a system-prompt section whose text provider looks up the
//      *current* session id at every prompt assembly, so the rules saved for
//      one conversation apply to the next model call in that conversation only.
//   2. Serve the editor dialog's HTTP endpoint: read/save this session's rules
//      and list project guideline files that can be imported read-only.
//
// Nothing here edits app files or the project: imported guidelines are copied
// into the store as text, and the source file is only ever read.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'

export const name = 'dsh-session-rules'
export const inject = ['systemPrompt']

const ROUTE_PATH = '/__chameleon/session/rules'
const SECTION_NAME = 'session-rules'
const SECTION_ORDER = 10190
const MAX_BODY = 1e6
const MAX_IMPORT = 20000

// Files a project may already use to state its conventions. Read-only: the
// import copies text into the session store and never writes these files.
const PROJECT_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
  'docs/AGENTS.md',
]

function dshHome() {
  return process.env.DSH_HOME || path.join(homedir(), '.dsh')
}

function storeFile() {
  return path.join(dshHome(), 'plugin-data', 'dsh-session-rules', 'rules.json')
}

function readStore() {
  try {
    const parsed = JSON.parse(readFileSync(storeFile(), 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(store) {
  const file = storeFile()
  mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  renameSync(temp, file)
}

function entryOf(store, sessionId) {
  const entry = store[sessionId]
  if (entry === null || typeof entry !== 'object') return { rules: '', sources: [], enabled: true, inherit: true }
  return {
    rules: typeof entry.rules === 'string' ? entry.rules : '',
    sources: Array.isArray(entry.sources) ? entry.sources.filter((item) => typeof item === 'string') : [],
    // Absent means enabled: entries written before the switch existed keep working.
    enabled: entry.enabled !== false,
    // Per-session opt-in for the shared ('*') rules; absent means yes.
    inherit: entry.inherit !== false,
  }
}

const VALID_ID = /^[A-Za-z0-9._:-]{1,200}$/

function isSessionId(value) {
  return typeof value === 'string' && VALID_ID.test(value)
}

function idCandidates(sessionId) {
  const bare = sessionId.startsWith('session-') ? sessionId.slice(8) : sessionId
  return [...new Set([sessionId, bare, `session-${bare}`])]
}

// Reserved store key for the rules that apply to every session.
const GLOBAL_KEY = '*'

function isTargetId(value) {
  return value === GLOBAL_KEY || isSessionId(value)
}

// Evaluated at every prompt assembly: a broken store must never take prompt
// assembly down, so failures fall back to "no rules".
// Order: the shared ('*') rules first, then this session's own. A session can
// opt out of the shared ones with its `inherit` flag.
function rulesFor(sessionId) {
  if (!isSessionId(sessionId)) return ''
  try {
    const store = readStore()
    const own = ownEntry(store, sessionId)
    const parts = []
    if (own.inherit) parts.push(activeRules(entryOf(store, GLOBAL_KEY)))
    if (own.enabled) parts.push(activeRules(own))
    return parts.filter((part) => part !== '').join('\n\n')
  } catch {
    return ''
  }
}

function activeRules(entry) {
  return entry.enabled && entry.rules.trim() !== '' ? entry.rules.trim() : ''
}

function ownEntry(store, sessionId) {
  return entryOf(store, keyFor(store, sessionId))
}

function storeKey(store, sessionId) {
  return sessionId === GLOBAL_KEY ? GLOBAL_KEY : keyFor(store, sessionId)
}

function keyFor(store, sessionId) {
  return idCandidates(sessionId).find((candidate) => candidate in store) ?? sessionId
}

function warn(ctx, message) {
  try {
    const logger = ctx.logger ?? ctx.log
    if (logger !== null && logger !== undefined && typeof logger.warn === 'function') logger.warn(`[session-rules] ${message}`)
    else console.warn(`[session-rules] ${message}`)
  } catch {
    // Logging must never break a request.
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// Exact routes take precedence over the SPA fallback that would otherwise
// answer unauthenticated requests, so the route enforces its own fence.
function rejectUnauthenticated(ctx, req) {
  let connection
  try {
    connection = ctx.get('connection')
  } catch {
    return 401
  }
  if (connection === null || connection === undefined || typeof connection.requestRejection !== 'function') return 401
  try {
    const rejection = connection.requestRejection({ headers: req.headers })
    if (rejection === undefined || rejection === null) return undefined
    return typeof rejection === 'number' ? rejection : 403
  } catch {
    return 403
  }
}

// --- project guideline discovery (read-only) -------------------------------

function decodeWorkspace(encoded) {
  const attempts = [`/${encoded.replace(/^-/, '').replaceAll('-', '/')}`, encoded.replaceAll('-', '/')]
  for (const attempt of attempts) {
    try {
      if (existsSync(attempt) && statSync(attempt).isDirectory()) return attempt
    } catch {
      // Try the next decoding.
    }
  }
  return undefined
}

function workspaceOf(sessionId) {
  const root = path.join(dshHome(), 'sessions')
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return undefined
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    for (const candidate of idCandidates(sessionId)) {
      if (existsSync(path.join(root, entry.name, candidate))) return decodeWorkspace(entry.name)
    }
  }
  return undefined
}

function readCapped(file) {
  const text = readFileSync(file, 'utf8')
  if (text.length <= MAX_IMPORT) return text
  return `${text.slice(0, MAX_IMPORT)}\n…（已截断，原文件 ${text.length} 字符）`
}

function projectFiles(sessionId) {
  const workspace = workspaceOf(sessionId)
  if (workspace === undefined) return []
  const files = []
  for (const relative of PROJECT_FILES) {
    const absolute = path.join(workspace, relative)
    try {
      if (!existsSync(absolute) || !statSync(absolute).isFile()) continue
      files.push({ path: relative, content: readCapped(absolute) })
    } catch {
      // Unreadable file: skip it, the dialog simply does not offer it.
    }
  }
  return files
}

// --- rule polishing -------------------------------------------------------
// Optional: rewrite the user's notes as tighter, executable rules. Runs on the
// harness LLM service, i.e. the provider/model the app itself is configured
// with — no second API key, no external endpoint. When the service is missing
// or the model fails, the dialog reports it and the user keeps editing by hand.
const OPTIMIZE_SYSTEM = [
  '你把用户随手写的「会话守则」整理成给编码助手看的规范。',
  '要求：保留原意和全部约束，不新增事实、不删减要求；合并重复项；',
  '每条一句，动词开头，可执行；中文输出。',
  '输出格式固定：每一行都是一条以「- 」开头的条目，不要小标题、不要编号、不要空行分组、不要解释、不要代码块围栏。',
].join('')

// The lowest reasoning effort the model advertises: a few rules need no deep
// thinking, and a high default can spend the whole output budget on reasoning
// and return no text at all.
async function lowestReasoningEffort(llm, provider, model) {
  if (typeof llm.resolveModelInfo !== 'function') return undefined
  try {
    const info = await llm.resolveModelInfo(provider, model)
    const efforts = info?.reasoning?.efforts
    if (Array.isArray(efforts) && efforts.length > 0 && typeof efforts[0]?.id === 'string') return efforts[0].id
  } catch {}
  return undefined
}

async function optimizeRules(ctx, text) {
  const llm = ctx.get('llm')
  if (!llm || typeof llm.stream !== 'function') throw new Error('llm service unavailable')
  const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
  if (!selection || typeof selection.provider !== 'string' || typeof selection.model !== 'string') {
    throw new Error('no model selection')
  }
  const effort = await lowestReasoningEffort(llm, selection.provider, selection.model)
  let out = ''
  const stream = llm.stream({
    provider: selection.provider,
    model: selection.model,
    messages: [
      {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'plugin:dsh-session-rules' },
      },
    ],
    system: OPTIMIZE_SYSTEM,
    maxTokens: 1200,
    signal: AbortSignal.timeout(120000),
    ...(effort === undefined ? {} : { reasoningEffort: effort }),
  })
  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
  }
  out = out.trim().replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim()
  if (out === '') throw new Error('empty completion')
  return out
}

// --- HTTP handler ----------------------------------------------------------

async function handleRequest(ctx, req, res) {
  const rejection = rejectUnauthenticated(ctx, req)
  if (rejection !== undefined) {
    sendJson(res, rejection, { ok: false, error: 'unauthorized' })
    return
  }

  let url
  try {
    url = new URL(req.url ?? ROUTE_PATH, 'http://localhost')
  } catch {
    sendJson(res, 400, { ok: false, error: 'bad request url' })
    return
  }

  if (req.method === 'GET') {
    const sessionId = url.searchParams.get('sessionId') ?? ''
    if (!isTargetId(sessionId)) {
      sendJson(res, 400, { ok: false, error: 'sessionId is required' })
      return
    }
    const store = readStore()
    const entry = entryOf(store, storeKey(store, sessionId))
    const body: any = {
      ok: true,
      sessionId,
      rules: entry.rules,
      sources: entry.sources,
      enabled: entry.enabled,
      inherit: entry.inherit,
    }
    if (url.searchParams.get('candidates') === '1' && isSessionId(sessionId)) body.files = projectFiles(sessionId)
    sendJson(res, 200, body)
    return
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'method not allowed' })
    return
  }

  let payload
  try {
    payload = JSON.parse(await readBody(req))
  } catch {
    sendJson(res, 400, { ok: false, error: 'bad json body' })
    return
  }

  if (payload?.action === 'optimize') {
    const text = typeof payload?.rules === 'string' ? payload.rules : ''
    if (text.trim() === '') {
      sendJson(res, 400, { ok: false, error: 'nothing to optimize' })
      return
    }
    if (text.length > 20000) {
      sendJson(res, 413, { ok: false, error: 'rules too long to optimize' })
      return
    }
    try {
      sendJson(res, 200, { ok: true, rules: await optimizeRules(ctx, text) })
    } catch (error) {
      warn(ctx, `optimize failed: ${String(error?.message ?? error)}`)
      sendJson(res, 502, { ok: false, error: 'model unavailable' })
    }
    return
  }

  const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : ''
  if (!isTargetId(sessionId)) {
    sendJson(res, 400, { ok: false, error: 'sessionId is required' })
    return
  }
  const rules = typeof payload?.rules === 'string' ? payload.rules : ''
  if (rules.length > 100000) {
    sendJson(res, 413, { ok: false, error: 'rules too long' })
    return
  }
  const enabled = payload?.enabled !== false
  const inherit = payload?.inherit !== false
  const rawSources = Array.isArray(payload?.sources) ? payload.sources : []
  const sources = rawSources.filter((item) => typeof item === 'string' && item.length <= 500).slice(0, 100)

  const store = readStore()
  store[storeKey(store, sessionId)] = { rules, sources, enabled, inherit, updatedAt: new Date().toISOString() }
  try {
    writeStore(store)
  } catch (error) {
    warn(ctx, `save failed: ${String(error?.message ?? error)}`)
    sendJson(res, 500, { ok: false, error: 'could not save rules' })
    return
  }
  sendJson(res, 200, { ok: true, sessionId, rules, sources, enabled, inherit })
}

// --- plugin entry ----------------------------------------------------------

export function apply(ctx) {
  ctx.inject(['systemPrompt'], (sub) => {
    sub.effect(
      () =>
        sub.systemPrompt.section({
          name: SECTION_NAME,
          order: SECTION_ORDER,
          // User text is literal: never interpolate {{name}} inside rules.
          interpolate: false,
          text: (context) => {
            const agent = context?.agent
            const sessionId = agent?.session?.id ?? agent?.id
            return rulesFor(typeof sessionId === 'string' ? sessionId : '')
          },
        }),
      'session-rules: section',
    )
  })

  ctx.inject(['webServer'], (sub) => {
    sub.effect(
      () =>
        sub.webServer.register({
          kind: 'exact',
          path: ROUTE_PATH,
          handler: (req, res) => handleRequest(sub, req, res),
        }),
      'session-rules: editor route',
    )
  })
}

// Exposed for the self-check: the store helpers and the handler are plain
// functions that take their dependencies explicitly.
export const __test = { handleRequest, rulesFor, entryOf, idCandidates, projectFiles, workspaceOf, optimizeRules }
