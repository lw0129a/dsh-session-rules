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
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const name = 'dsh-session-rules';
export const inject = ['systemPrompt'];
const ROUTE_PATH = '/__chameleon/session/rules';
const SECTION_NAME = 'session-rules';
const SECTION_ORDER = 10190;
const MAX_BODY = 1e6;
function dshHome() {
    return process.env.DSH_HOME || path.join(homedir(), '.dsh');
}
function storeFile() {
    return path.join(dshHome(), 'plugin-data', 'dsh-session-rules', 'rules.json');
}
// A cached copy of the store, refreshed only when the file changes. Prompt
// assembly runs on every turn, so re-reading and re-pruning the JSON each time
// is wasted work: the stamp below makes the common path zero disk reads.
let storeCache = null;
let registryCache = null;
function fileStamp(file) {
    try {
        const info = statSync(file);
        return `${info.mtimeMs}:${info.size}`;
    }
    catch {
        return '';
    }
}
function readStore() {
    const file = storeFile();
    const stamp = fileStamp(file);
    if (storeCache !== null && storeCache.stamp === stamp)
        return storeCache.store;
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(file, 'utf8'));
    }
    catch {
        storeCache = { stamp, store: {} };
        return storeCache.store;
    }
    const store = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    // Prune on reload only: this is the one path that sees changes made behind
    // our back, and a directory walk per turn is exactly what we are avoiding.
    if (pruneStore(store)) {
        try {
            writeStore(store);
        }
        catch {
            // A read must never fail because the prune could not be persisted.
        }
    }
    storeCache = { stamp: fileStamp(file), store };
    return store;
}
// Drop blocks whose workspace was deleted or whose session no longer exists.
// Runs whenever the store is reloaded, so deletions need no event from DSH. An empty registry
// or an unreadable sessions tree means "cannot tell yet", never "all gone".
function pruneStore(store) {
    const workspacePaths = workspaceRegistry().map((item) => item.path);
    const live = liveSessionIds();
    let changed = false;
    for (const key of Object.keys(store)) {
        if (key.startsWith('ws:')) {
            const stored = normalizeWorkspacePath(key.slice(3));
            if (workspacePaths.length > 0 && !workspacePaths.some((item) => samePath(item, stored))) {
                delete store[key];
                changed = true;
            }
            continue;
        }
        if (live !== null && !live.some((id) => idCandidates(key).includes(id))) {
            delete store[key];
            changed = true;
        }
    }
    return changed;
}
function liveSessionIds() {
    const root = path.join(dshHome(), 'sessions');
    let workspaces;
    try {
        workspaces = readdirSync(root, { withFileTypes: true });
    }
    catch {
        return null;
    }
    const ids = [];
    let seen = 0;
    for (const workspace of workspaces) {
        if (!workspace.isDirectory())
            continue;
        seen += 1;
        try {
            for (const entry of readdirSync(path.join(root, workspace.name)))
                ids.push(entry);
        }
        catch {
            // Skip a workspace directory that cannot be listed.
        }
    }
    return seen === 0 ? null : ids;
}
// Where this copy of the plugin lives and which version it is. Both are needed
// to tell a reinstall from an upgrade: see `reclaimStore`.
function packageRoot() {
    try {
        return fileURLToPath(new URL('..', import.meta.url));
    }
    catch {
        return '';
    }
}
function ownVersion() {
    try {
        const raw = JSON.parse(readFileSync(path.join(packageRoot(), 'package.json'), 'utf8'));
        return typeof raw?.version === 'string' ? raw.version : '';
    }
    catch {
        return '';
    }
}
// DSH has no uninstall hook and leaves our store alone, so the plugin has to
// infer it: a marker written into the installed package disappears when the
// package is removed. Missing marker + same version as last activation means
// the user reinstalled this version → start empty. Missing marker + a different
// version means an upgrade → keep the data.
function reclaimStore() {
    const root = packageRoot();
    const version = ownVersion();
    if (root === '' || version === '')
        return false;
    const marker = path.join(root, '.install-marker');
    const seen = path.join(path.dirname(storeFile()), 'install.json');
    let lastVersion = '';
    if (existsSync(marker))
        return false;
    try {
        const raw = JSON.parse(readFileSync(seen, 'utf8'));
        if (typeof raw?.version === 'string')
            lastVersion = raw.version;
    }
    catch {
        // No record yet: a first install, nothing to reclaim.
    }
    try {
        writeFileSync(marker, version, 'utf8');
        mkdirSync(path.dirname(seen), { recursive: true });
        writeFileSync(seen, `${JSON.stringify({ version, at: Date.now() }, null, 2)}\n`, 'utf8');
    }
    catch {
        // A read-only install cannot be marker-ed: never wipe user rules on a guess.
        return false;
    }
    return lastVersion === version;
}
function writeStore(store) {
    const file = storeFile();
    mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
    renameSync(temp, file);
    storeCache = { stamp: fileStamp(file), store };
}
// One shape for both stores: session blocks and workspace blocks differ only
// in which switches they carry, and a missing switch reads as "off".
function readEntry(raw) {
    return {
        rules: typeof raw?.rules === 'string' ? raw.rules : '',
        sources: Array.isArray(raw?.sources) ? raw.sources.filter((item) => typeof item === 'string') : [],
        // Every switch starts off: saved text is inert until the user enables it.
        enabled: raw?.enabled === true,
        // Levels this block pulls in. Empty = nothing inherited. A stored `true` is
        // the pre-0.7 boolean and means "the whole chain".
        inherit: Array.isArray(raw?.inherit)
            ? raw.inherit.filter((item) => typeof item === 'string')
            : raw?.inherit === true
                ? ['*']
                : [],
    };
}
function entryOf(store, sessionId) {
    return readEntry(store[sessionId]);
}
const VALID_ID = /^[A-Za-z0-9._:-]{1,200}$/;
function isSessionId(value) {
    return typeof value === 'string' && VALID_ID.test(value);
}
function idCandidates(sessionId) {
    const bare = sessionId.startsWith('session-') ? sessionId.slice(8) : sessionId;
    return [...new Set([sessionId, bare, `session-${bare}`])];
}
// --- workspaces -------------------------------------------------------------
// A workspace's rules are stored under `ws:<absolute path>`; nesting comes from
// the paths themselves (a registered workspace that prefixes another one is its
// parent), and each level opts into ancestors explicitly.
function workspaceRegistry() {
    const file = path.join(dshHome(), 'storages', 'workspace.json');
    const stamp = fileStamp(file);
    if (registryCache !== null && registryCache.stamp === stamp)
        return registryCache.list;
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(file, 'utf8'));
    }
    catch {
        registryCache = { stamp, list: [] };
        return registryCache.list;
    }
    const table = parsed?.tables?.workspaces;
    if (table === null || typeof table !== 'object') {
        registryCache = { stamp, list: [] };
        return registryCache.list;
    }
    const byPath = new Map();
    for (const [workspaceId, value] of Object.entries(table)) {
        if (value === null || typeof value !== 'object')
            continue;
        const item = value;
        const workspacePath = normalizeWorkspacePath(typeof item.path === 'string' ? item.path : '');
        if (workspacePath === '' || byPath.has(workspacePath))
            continue;
        byPath.set(workspacePath, {
            id: workspaceId,
            path: workspacePath,
            title: typeof item.title === 'string' && item.title !== '' ? item.title : path.basename(workspacePath),
            sessionIds: Array.isArray(item.sessionIds)
                ? item.sessionIds.filter((id) => typeof id === 'string')
                : [],
        });
    }
    registryCache = {
        stamp,
        list: [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path)),
    };
    return registryCache.list;
}
// Workspace identity is an absolute path, so it has to survive Windows as well
// as POSIX: resolve it, drop a trailing separator, and compare case-insensitively
// where the filesystem does (path.relative already knows).
const CASE_INSENSITIVE_FS = process.platform === 'win32';
function normalizeWorkspacePath(input) {
    const trimmed = typeof input === 'string' ? input.trim() : '';
    if (trimmed === '')
        return '';
    const resolved = path.resolve(trimmed);
    const root = path.parse(resolved).root;
    return resolved.length > root.length ? resolved.replace(/[\\/]+$/, '') : resolved;
}
function samePath(left, right) {
    if (left === right)
        return true;
    return CASE_INSENSITIVE_FS && left.toLowerCase() === right.toLowerCase();
}
function isInsideWorkspace(parent, child) {
    if (samePath(parent, child))
        return false;
    const relative = path.relative(parent, child);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
function workspaceKey(workspacePath) {
    return `ws:${normalizeWorkspacePath(workspacePath)}`;
}
function workspaceEntryOf(store, workspacePath) {
    return readEntry(store[workspaceKey(workspacePath)]);
}
// Every level of the chain is a registered workspace; which grouping the
// sidebar uses is DSH's own view option (分组方式 → 按工作区树), not ours.
function knownWorkspaces() {
    return workspaceRegistry();
}
function ancestorsOf(workspacePath) {
    const target = normalizeWorkspacePath(workspacePath);
    return knownWorkspaces()
        .filter((item) => isInsideWorkspace(item.path, target))
        .sort((left, right) => left.path.length - right.path.length);
}
// Every level a session may pull from: ancestors outermost first, then its own
// workspace last. Paths are the identity used everywhere in the store.
function layersOf(workspacePath, title) {
    const rows = ancestorsOf(workspacePath).map((item) => ({ path: item.path, title: item.title }));
    rows.push({ path: workspacePath, title: title === '' ? path.basename(workspacePath) : title });
    return rows;
}
// '\u0000' is impossible in a path, so it doubles as the "whole chain" marker
// left behind by the old boolean switch.
function selectedLayers(layers, inherit) {
    if (inherit.includes('*'))
        return layers.map((item) => item.path);
    return layers.filter((item) => inherit.includes(item.path)).map((item) => item.path);
}
// The text a session receives from its workspace levels, in display order.
function sessionLayerText(store, workspacePath, title, inherit) {
    return selectedLayers(layersOf(workspacePath, title), inherit)
        .map((layerPath) => sharedText(workspaceEntryOf(store, layerPath)))
        .filter((part) => part !== '')
        .join('\n\n');
}
// ponytail: memo has no TTL — a workspace registered while the app runs is
// picked up on the next start. The fallback walk is what makes this worth
// caching; drop the memo if stale entries ever hurt.
const workspaceMemo = new Map();
function workspaceForSession(sessionId) {
    if (workspaceMemo.has(sessionId))
        return workspaceMemo.get(sessionId);
    const candidates = idCandidates(sessionId);
    let found;
    for (const item of workspaceRegistry()) {
        if (item.sessionIds.some((id) => candidates.includes(id))) {
            found = item;
            break;
        }
    }
    if (found === undefined) {
        // Sessions whose workspace has been archived still sit in the sessions tree.
        const legacy = workspaceEntry(sessionId);
        if (legacy !== undefined)
            found = { path: legacy.label, title: path.basename(legacy.label) };
    }
    if (workspaceMemo.size > 500)
        workspaceMemo.clear();
    workspaceMemo.set(sessionId, found);
    return found;
}
function sharedText(entry) {
    return entry.rules.trim();
}
// Layers can overlap: a session that ticks both a parent and its child would
// inject the parent's block twice. Identical lines are kept once, in the order
// they first appear; blank lines inside one block survive, blocks stay apart.
function dedupeLines(parts) {
    const seen = new Set();
    const blocks = [];
    for (const part of parts) {
        const kept = [];
        for (const line of part.split('\n')) {
            const key = line.trim();
            if (key === '') {
                kept.push(line);
                continue;
            }
            if (seen.has(key))
                continue;
            seen.add(key);
            kept.push(line.trimEnd());
        }
        const text = kept.join('\n').trim();
        if (text !== '')
            blocks.push(text);
    }
    return blocks.join('\n\n');
}
function activeRules(entry) {
    return entry.enabled && entry.rules.trim() !== '' ? entry.rules.trim() : '';
}
function ownEntry(store, sessionId) {
    return entryOf(store, keyFor(store, sessionId));
}
// The text injected for a session: the workspace's rules (only when the
// session opted in), then the session's own rules (only when enabled).
function rulesFor(sessionId) {
    const store = readStore();
    const own = ownEntry(store, sessionId);
    const parts = [];
    if (own.inherit.length > 0) {
        const workspace = workspaceForSession(sessionId);
        if (workspace !== undefined) {
            parts.push(sessionLayerText(store, workspace.path, workspace.title, own.inherit));
        }
    }
    if (own.enabled)
        parts.push(activeRules(own));
    return dedupeLines(parts.filter((part) => part !== ''));
}
function keyFor(store, sessionId) {
    return idCandidates(sessionId).find((candidate) => candidate in store) ?? sessionId;
}
function warn(ctx, message) {
    try {
        const logger = ctx.logger ?? ctx.log;
        if (logger !== null && logger !== undefined && typeof logger.warn === 'function')
            logger.warn(`[session-rules] ${message}`);
        else
            console.warn(`[session-rules] ${message}`);
    }
    catch {
        // Logging must never break a request.
    }
}
function sendJson(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY) {
                reject(new Error('body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}
// Exact routes take precedence over the SPA fallback that would otherwise
// answer unauthenticated requests, so the route enforces its own fence.
function rejectUnauthenticated(ctx, req) {
    let connection;
    try {
        connection = ctx.get('connection');
    }
    catch {
        return 401;
    }
    if (connection === null || connection === undefined || typeof connection.requestRejection !== 'function')
        return 401;
    try {
        const rejection = connection.requestRejection({ headers: req.headers });
        if (rejection === undefined || rejection === null)
            return undefined;
        return typeof rejection === 'number' ? rejection : 403;
    }
    catch {
        return 403;
    }
}
// --- project guideline discovery (read-only) -------------------------------
function decodeWorkspace(encoded) {
    const drive = /^-*([A-Za-z])-+/.exec(encoded);
    const attempts = [
        `/${encoded.replace(/^-/, '').replaceAll('-', '/')}`,
        encoded.replaceAll('-', '/'),
        ...(drive === null ? [] : [`${drive[1].toUpperCase()}:/${encoded.slice(drive[0].length).replaceAll('-', '/')}`]),
    ];
    for (const attempt of attempts) {
        try {
            if (!existsSync(attempt) || !statSync(attempt).isDirectory())
                continue;
            const clean = path.normalize(attempt).replace(/\/+$/, '');
            return clean === '' ? '/' : clean;
        }
        catch {
            // Try the next decoding.
        }
    }
    return undefined;
}
// The sessions tree is <DSH_HOME>/sessions/<encoded workspace>/<session id>, so
// the directory name is a stable per-workspace identity even before it decodes
// back to an existing path.
function workspaceEntry(sessionId) {
    const root = path.join(dshHome(), 'sessions');
    let entries;
    try {
        entries = readdirSync(root, { withFileTypes: true });
    }
    catch {
        return undefined;
    }
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        for (const candidate of idCandidates(sessionId)) {
            if (existsSync(path.join(root, entry.name, candidate))) {
                return { label: decodeWorkspace(entry.name) ?? entry.name };
            }
        }
    }
    return undefined;
}
// Absolute path when the workspace registry knows the session, otherwise the
// sessions-tree label (which may be an encoded directory name).
function workspaceOf(sessionId) {
    return workspaceForSession(sessionId)?.path ?? workspaceEntry(sessionId)?.label;
}
// --- rule polishing -------------------------------------------------------
// Optional: rewrite the user's notes as tighter, executable rules. Runs on the
// harness LLM service, i.e. the provider/model the app itself is configured
// with — no second API key, no external endpoint. When the service is missing
// or the model fails, the dialog reports it and the user keeps editing by hand.
const OPTIMIZE_SYSTEM = [
    '你把用户随手写的「会话守则」整理成给编码助手看的规范。',
    '要求：保留原意和全部约束，不新增事实、不删减要求；合并重复项；',
    '每条一句，动词开头，可执行；输出语言与原文一致。',
    '输出格式固定：每一行都是一条以「- 」开头的条目，不要小标题、不要编号、不要空行分组、不要解释、不要代码块围栏。',
].join('');
// The lowest reasoning effort the model advertises: a few rules need no deep
// thinking, and a high default can spend the whole output budget on reasoning
// and return no text at all.
async function lowestReasoningEffort(llm, provider, model) {
    if (typeof llm.resolveModelInfo !== 'function')
        return undefined;
    try {
        const info = await llm.resolveModelInfo(provider, model);
        const efforts = info?.reasoning?.efforts;
        if (Array.isArray(efforts) && efforts.length > 0 && typeof efforts[0]?.id === 'string')
            return efforts[0].id;
    }
    catch { }
    return undefined;
}
async function optimizeRules(ctx, text) {
    const llm = ctx.get('llm');
    if (!llm || typeof llm.stream !== 'function')
        throw new Error('llm service unavailable');
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.();
    if (!selection || typeof selection.provider !== 'string' || typeof selection.model !== 'string') {
        throw new Error('no model selection');
    }
    const effort = await lowestReasoningEffort(llm, selection.provider, selection.model);
    let out = '';
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
    });
    for await (const chunk of stream) {
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string')
            out += chunk.text;
    }
    out = out.trim().replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();
    if (out === '')
        throw new Error('empty completion');
    return out;
}
// --- HTTP handler ----------------------------------------------------------
async function handleRequest(ctx, req, res) {
    const rejection = rejectUnauthenticated(ctx, req);
    if (rejection !== undefined) {
        sendJson(res, rejection, { ok: false, error: 'unauthorized' });
        return;
    }
    let url;
    try {
        url = new URL(req.url ?? ROUTE_PATH, 'http://localhost');
    }
    catch {
        sendJson(res, 400, { ok: false, error: 'bad request url' });
        return;
    }
    if (req.method === 'GET') {
        if (url.searchParams.get('workspaces') === '1') {
            const store = readStore();
            sendJson(res, 200, {
                ok: true,
                workspaces: knownWorkspaces().map((item) => {
                    const entry = workspaceEntryOf(store, item.path);
                    return {
                        id: item.id ?? '',
                        path: item.path,
                        title: item.title,
                        rules: entry.rules,
                        sources: entry.sources,
                        inherit: entry.inherit,
                        ancestors: ancestorsOf(item.path).map((ancestor) => ({
                            path: ancestor.path,
                            title: ancestor.title,
                        })),
                    };
                }),
            });
            return;
        }
        const sessionId = url.searchParams.get('sessionId') ?? '';
        if (!isSessionId(sessionId)) {
            sendJson(res, 400, { ok: false, error: 'sessionId is required' });
            return;
        }
        const store = readStore();
        const storedKey = keyFor(store, sessionId);
        const entry = entryOf(store, storedKey);
        const workspace = workspaceForSession(sessionId);
        const layers = workspace === undefined ? [] : layersOf(workspace.path, workspace.title);
        // Nothing is ticked until this session ticks it itself.
        const inherit = entry.inherit;
        const body = {
            ok: true,
            sessionId,
            rules: entry.rules,
            sources: entry.sources,
            enabled: entry.enabled,
            inherit,
            // null when the session's workspace cannot be located: the dialog then
            // hides the workspace block instead of writing to a guessed key.
            shared: workspace === undefined
                ? null
                : {
                    path: workspace.path,
                    title: workspace.title,
                    layers: layers.map((layer) => ({
                        path: layer.path,
                        title: layer.title,
                        rules: workspaceEntryOf(store, layer.path).rules,
                        selected: selectedLayers(layers, inherit).includes(layer.path),
                    })),
                },
        };
        sendJson(res, 200, body);
        return;
    }
    if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
    }
    let payload;
    try {
        payload = JSON.parse(await readBody(req));
    }
    catch {
        sendJson(res, 400, { ok: false, error: 'bad json body' });
        return;
    }
    if (payload?.action === 'optimize') {
        const text = typeof payload?.rules === 'string' ? payload.rules : '';
        if (text.trim() === '') {
            sendJson(res, 400, { ok: false, error: 'nothing to optimize' });
            return;
        }
        if (text.length > 20000) {
            sendJson(res, 413, { ok: false, error: 'rules too long to optimize' });
            return;
        }
        try {
            sendJson(res, 200, { ok: true, rules: await optimizeRules(ctx, text) });
        }
        catch (error) {
            warn(ctx, `optimize failed: ${String(error?.message ?? error)}`);
            sendJson(res, 502, { ok: false, error: 'model unavailable' });
        }
        return;
    }
    if (payload?.action === 'save-workspace') {
        const workspacePath = typeof payload?.path === 'string' ? payload.path.trim() : '';
        if (workspacePath === '' || !knownWorkspaces().some((item) => item.path === workspacePath)) {
            sendJson(res, 404, { ok: false, error: 'unknown workspace' });
            return;
        }
        const sharedRules = typeof payload?.rules === 'string' ? payload.rules : '';
        if (sharedRules.length > 100000) {
            sendJson(res, 413, { ok: false, error: 'rules too long' });
            return;
        }
        const rawSources = Array.isArray(payload?.sources) ? payload.sources : [];
        const sources = rawSources
            .filter((item) => typeof item === 'string' && item.length <= 500)
            .slice(0, 100);
        // Only registered ancestors may be opted into, so a crafted body cannot
        // pull in an arbitrary path.
        const registered = ancestorsOf(workspacePath).map((item) => item.path);
        const rawInherit = Array.isArray(payload?.inherit) ? payload.inherit : [];
        const inherit = rawInherit
            .filter((item) => typeof item === 'string' && registered.includes(item))
            .slice(0, 50);
        const store = readStore();
        store[workspaceKey(workspacePath)] = {
            rules: sharedRules,
            sources,
            inherit,
            updatedAt: new Date().toISOString(),
        };
        writeStore(store);
        sendJson(res, 200, { ok: true });
        return;
    }
    const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : '';
    if (!isSessionId(sessionId)) {
        sendJson(res, 400, { ok: false, error: 'sessionId is required' });
        return;
    }
    const rules = typeof payload?.rules === 'string' ? payload.rules : '';
    if (rules.length > 100000) {
        sendJson(res, 413, { ok: false, error: 'rules too long' });
        return;
    }
    const enabled = payload?.enabled === true;
    const inherit = Array.isArray(payload?.inherit)
        ? payload.inherit.filter((item) => typeof item === 'string').slice(0, 100)
        : payload?.inherit === true
            ? ['*']
            : [];
    const rawSources = Array.isArray(payload?.sources) ? payload.sources : [];
    const sources = rawSources.filter((item) => typeof item === 'string' && item.length <= 500).slice(0, 100);
    const store = readStore();
    store[keyFor(store, sessionId)] = { rules, sources, enabled, inherit, updatedAt: new Date().toISOString() };
    try {
        writeStore(store);
    }
    catch (error) {
        warn(ctx, `save failed: ${String(error?.message ?? error)}`);
        sendJson(res, 500, { ok: false, error: 'could not save rules' });
        return;
    }
    sendJson(res, 200, {
        ok: true,
        sessionId,
        rules,
        sources,
        enabled,
        inherit,
        shared: null,
    });
}
// --- plugin entry ----------------------------------------------------------
export function apply(ctx) {
    try {
        if (reclaimStore())
            writeStore({});
    }
    catch (error) {
        warn(ctx, `store reclaim skipped: ${String(error?.message ?? error)}`);
    }
    // A plugin that throws while activating fails the whole web boot, so every
    // registration is best-effort: log it and carry on with whatever loaded.
    try {
        ctx.inject(['systemPrompt'], (sub) => {
            sub.effect(() => sub.systemPrompt.section({
                name: SECTION_NAME,
                order: SECTION_ORDER,
                // User text is literal: never interpolate {{name}} inside rules.
                interpolate: false,
                text: (context) => {
                    try {
                        const agent = context?.agent;
                        const sessionId = agent?.session?.id ?? agent?.id;
                        return rulesFor(typeof sessionId === 'string' ? sessionId : '');
                    }
                    catch {
                        // Never let a rules lookup break prompt assembly.
                        return '';
                    }
                },
            }), 'session-rules: section');
        });
    }
    catch (error) {
        warn(ctx, `system prompt section unavailable: ${String(error?.message ?? error)}`);
    }
    try {
        ctx.inject(['webServer'], (sub) => {
            sub.effect(() => sub.webServer.register({
                kind: 'exact',
                path: ROUTE_PATH,
                handler: (req, res) => handleRequest(sub, req, res),
            }), 'session-rules: editor route');
        });
    }
    catch (error) {
        warn(ctx, `editor route unavailable: ${String(error?.message ?? error)}`);
    }
}
// Exposed for the self-check: the store helpers and the handler are plain
// functions that take their dependencies explicitly.
export const __test = {
    reclaimStore,
    dedupeLines,
    handleRequest,
    readStore,
    rulesFor,
    entryOf,
    idCandidates,
    workspaceOf,
    workspaceEntry,
    workspaceRegistry,
    knownWorkspaces,
    layersOf,
    sessionLayerText,
    selectedLayers,
    ancestorsOf,
    workspaceForSession,
    optimizeRules,
    apply,
};
