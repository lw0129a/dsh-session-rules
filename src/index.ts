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
  let parsed
  try {
    parsed = JSON.parse(readFileSync(storeFile(), 'utf8'))
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  return migrateStore(parsed)
}

// Older builds keyed workspace blocks by the encoded sessions directory
// (`ws:--Users-lw-dev--`). Rewrite those to `ws:<absolute path>` so every level
// of the hierarchy lives under one naming scheme; merge when both exist.
function migrateStore(store) {
  const legacy = Object.keys(store).filter((key) => {
    if (!key.startsWith('ws:') || key.startsWith('ws:/')) return false
    return decodeWorkspace(key.slice(3)) !== undefined
  })
  if (legacy.length === 0) return store
  for (const key of legacy) {
    const target = workspaceKey(decodeWorkspace(key.slice(3)))
    const entry = store[key]
    const previous = store[target]
    if (previous === undefined || previous === null || typeof previous !== 'object') {
      store[target] = entry
    } else {
      const rules = [previous.rules, entry?.rules]
        .filter((text) => typeof text === 'string' && text.trim() !== '')
        .join('\n\n')
      const inherit = [
        ...new Set([
          ...(Array.isArray(previous.inherit) ? previous.inherit : []),
          ...(Array.isArray(entry?.inherit) ? entry.inherit : []),
        ]),
      ]
      store[target] = { ...previous, rules, inherit, updatedAt: new Date().toISOString() }
    }
    delete store[key]
  }
  try {
    writeStore(store)
  } catch {
    // A read must never fail because the rewrite could not be persisted.
  }
  return store
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
  if (entry === null || typeof entry !== 'object') return { rules: '', sources: [], enabled: false, inherit: false }
  return {
    rules: typeof entry.rules === 'string' ? entry.rules : '',
    sources: Array.isArray(entry.sources) ? entry.sources.filter((item) => typeof item === 'string') : [],
    // Every switch starts off: saved text is inert until the user enables it.
    enabled: entry.enabled === true,
    // Per-session opt-in for the shared ('*') rules: off unless the user
    // enabled it for this session.
    inherit: entry.inherit === true,
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

// --- workspaces -------------------------------------------------------------
// A workspace's rules are stored under `ws:<absolute path>`; nesting comes from
// the paths themselves (a registered workspace that prefixes another one is its
// parent), and each level opts into ancestors explicitly.

function workspaceRegistry() {
  const file = path.join(dshHome(), 'storages', 'workspace.json')
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return []
  }
  const table = parsed?.tables?.workspaces
  if (table === null || typeof table !== 'object') return []
  const byPath = new Map()
  for (const value of Object.values(table)) {
    if (value === null || typeof value !== 'object') continue
    const item = value as any
    const workspacePath = typeof item.path === 'string' ? item.path.trim() : ''
    if (workspacePath === '' || byPath.has(workspacePath)) continue
    byPath.set(workspacePath, {
      path: workspacePath,
      title:
        typeof item.title === 'string' && item.title !== '' ? item.title : path.basename(workspacePath),
      sessionIds: Array.isArray(item.sessionIds)
        ? item.sessionIds.filter((id) => typeof id === 'string')
        : [],
    })
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path))
}

function workspaceKey(workspacePath) {
  return `ws:${workspacePath}`
}

function workspaceEntryOf(store, workspacePath) {
  const raw = store[workspaceKey(workspacePath)]
  return {
    rules: typeof raw?.rules === 'string' ? raw.rules : '',
    sources: Array.isArray(raw?.sources)
      ? raw.sources.filter((item) => typeof item === 'string')
      : [],
    // Registered ancestor workspaces this level draws rules from. Empty means
    // "this level stands alone" and is the default.
    inherit: Array.isArray(raw?.inherit)
      ? raw.inherit.filter((item) => typeof item === 'string')
      : [],
  }
}

// True when `candidate` is a directory a workspace path may nest under. The
// home directory and everything above it are never levels of their own, and
// neither is the root: those would be noise, not project grouping.
function usableLevel(candidate) {
  if (candidate === '/' || candidate === '') return false
  if (candidate.split('/').filter((part) => part !== '').length < 2) return false
  const home = homedir()
  if (home !== '' && (home === candidate || home.startsWith(`${candidate}/`))) return false
  try {
    return statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

// The registered workspaces, plus the directories they live under: a parent
// folder that was never registered as a workspace is still a level, so the
// chain stays hierarchical no matter how flat the registry is.
function knownWorkspaces() {
  const registered = workspaceRegistry()
  const byPath = new Map()
  for (const item of registered) byPath.set(item.path, { ...item, implicit: false })
  for (const item of registered) {
    let parent = path.dirname(item.path)
    while (parent !== '/' && usableLevel(parent)) {
      if (!byPath.has(parent)) {
        byPath.set(parent, { path: parent, title: path.basename(parent), sessionIds: [], implicit: true })
      }
      const next = path.dirname(parent)
      if (next === parent) break
      parent = next
    }
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path))
}

function ancestorsOf(workspacePath) {
  return knownWorkspaces()
    .filter(
      (item) =>
        item.path !== workspacePath &&
        workspacePath.startsWith(item.path.endsWith('/') ? item.path : `${item.path}/`),
    )
    .sort((left, right) => left.path.length - right.path.length)
}

// What a session in this workspace actually receives: the ancestors it opted
// into (outermost first), then the workspace's own block.
function workspaceRulesOf(store, workspacePath) {
  const entry = workspaceEntryOf(store, workspacePath)
  const inherited = ancestorsOf(workspacePath)
    .filter((item) => entry.inherit.includes(item.path))
    .map((item) => sharedText(workspaceEntryOf(store, item.path)))
  return [...inherited, sharedText(entry)].filter((part) => part !== '').join('\n\n')
}

function workspaceForSession(sessionId) {
  const candidates = idCandidates(sessionId)
  for (const item of workspaceRegistry()) {
    if (item.sessionIds.some((id) => candidates.includes(id))) return item
  }
  // Sessions whose workspace has been archived still sit in the sessions tree.
  const legacy = workspaceEntry(sessionId)
  if (legacy === undefined) return undefined
  return { path: legacy.label, title: path.basename(legacy.label) }
}

function sharedText(entry) {
  return entry.rules.trim()
}

function activeRules(entry) {
  return entry.enabled && entry.rules.trim() !== '' ? entry.rules.trim() : ''
}

function ownEntry(store, sessionId) {
  return entryOf(store, keyFor(store, sessionId))
}

// The text injected for a session: the workspace's rules (only when the
// session opted in), then the session's own rules (only when enabled).
function rulesFor(sessionId) {
  const store = readStore()
  const own = ownEntry(store, sessionId)
  const parts = []
  if (own.inherit) {
    const workspace = workspaceForSession(sessionId)
    if (workspace !== undefined) parts.push(workspaceRulesOf(store, workspace.path))
  }
  if (own.enabled) parts.push(activeRules(own))
  return parts.filter((part) => part !== '').join('\n\n')
}

function storeKey(store, sessionId) {
  return keyFor(store, sessionId)
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
      if (!existsSync(attempt) || !statSync(attempt).isDirectory()) continue
      const clean = path.normalize(attempt).replace(/\/+$/, '')
      return clean === '' ? '/' : clean
    } catch {
      // Try the next decoding.
    }
  }
  return undefined
}

// The sessions tree is <DSH_HOME>/sessions/<encoded workspace>/<session id>, so
// the directory name is a stable per-workspace identity even before it decodes
// back to an existing path.
function workspaceEntry(sessionId) {
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
      if (existsSync(path.join(root, entry.name, candidate))) {
        return { label: decodeWorkspace(entry.name) ?? entry.name }
      }
    }
  }
  return undefined
}

// Absolute path when the workspace registry knows the session, otherwise the
// sessions-tree label (which may be an encoded directory name).
function workspaceOf(sessionId) {
  return workspaceForSession(sessionId)?.path ?? workspaceEntry(sessionId)?.label
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
    if (url.searchParams.get('workspaces') === '1') {
      const store = readStore()
      sendJson(res, 200, {
        ok: true,
        workspaces: knownWorkspaces().map((item) => {
          const entry = workspaceEntryOf(store, item.path)
          return {
            path: item.path,
            title: item.title,
            rules: entry.rules,
            sources: entry.sources,
            inherit: entry.inherit,
            implicit: item.implicit === true,
            ancestors: ancestorsOf(item.path).map((ancestor) => ({
              path: ancestor.path,
              title: ancestor.title,
            })),
          }
        }),
      })
      return
    }
    const sessionId = url.searchParams.get('sessionId') ?? ''
    if (!isSessionId(sessionId)) {
      sendJson(res, 400, { ok: false, error: 'sessionId is required' })
      return
    }
    const store = readStore()
    const entry = entryOf(store, storeKey(store, sessionId))
    const workspace = workspaceForSession(sessionId)
    const body: any = {
      ok: true,
      sessionId,
      rules: entry.rules,
      sources: entry.sources,
      enabled: entry.enabled,
      inherit: entry.inherit,
      // null when the session's workspace cannot be located: the dialog then
      // hides the workspace block instead of writing to a guessed key.
      shared:
        workspace === undefined
          ? null
          : {
              path: workspace.path,
              title: workspace.title,
              rules: workspaceRulesOf(store, workspace.path),
            },
    }
    if (url.searchParams.get('candidates') === '1') body.files = projectFiles(sessionId)
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

  if (payload?.action === 'save-workspace') {
    const workspacePath = typeof payload?.path === 'string' ? payload.path.trim() : ''
    if (workspacePath === '' || !knownWorkspaces().some((item) => item.path === workspacePath)) {
      sendJson(res, 404, { ok: false, error: 'unknown workspace' })
      return
    }
    const sharedRules = typeof payload?.rules === 'string' ? payload.rules : ''
    if (sharedRules.length > 100000) {
      sendJson(res, 413, { ok: false, error: 'rules too long' })
      return
    }
    const rawSources = Array.isArray(payload?.sources) ? payload.sources : []
    const sources = rawSources
      .filter((item) => typeof item === 'string' && item.length <= 500)
      .slice(0, 100)
    // Only registered ancestors may be opted into, so a crafted body cannot
    // pull in an arbitrary path.
    const registered = ancestorsOf(workspacePath).map((item) => item.path)
    const rawInherit = Array.isArray(payload?.inherit) ? payload.inherit : []
    const inherit = rawInherit
      .filter((item) => typeof item === 'string' && registered.includes(item))
      .slice(0, 50)
    const store = readStore()
    store[workspaceKey(workspacePath)] = {
      rules: sharedRules,
      sources,
      inherit,
      updatedAt: new Date().toISOString(),
    }
    writeStore(store)
    sendJson(res, 200, { ok: true })
    return
  }

  const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : ''
  if (!isSessionId(sessionId)) {
    sendJson(res, 400, { ok: false, error: 'sessionId is required' })
    return
  }
  const rules = typeof payload?.rules === 'string' ? payload.rules : ''
  if (rules.length > 100000) {
    sendJson(res, 413, { ok: false, error: 'rules too long' })
    return
  }
  const enabled = payload?.enabled === true
  const inherit = payload?.inherit === true
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
  sendJson(res, 200, {
    ok: true,
    sessionId,
    rules,
    sources,
    enabled,
    inherit,
    shared: null,
  })
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
export const __test = {
  handleRequest,
  rulesFor,
  entryOf,
  idCandidates,
  projectFiles,
  workspaceOf,
  workspaceEntry,
  workspaceRegistry,
  knownWorkspaces,
  workspaceRulesOf,
  ancestorsOf,
  workspaceForSession,
  optimizeRules,
}
