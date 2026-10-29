# dsh-session-rules

[简体中文](README.md) · **English**

Workspace- and session-scoped rules for DeepSeek Harness. The popup UI follows the app's language (Chinese or English).

Open the `⋯` menu on a workspace row → **Workspace rules**: one rules block per workspace directory; when directories nest, a child can only tick which ancestor blocks it inherits, never edit them. Open the `⋯` menu on a session row → **Session rules**: write this session's own block and tick, level by level, which workspace blocks to pull in (multi-select, read-only). A workspace with no sessions yet can still be configured. Saved text takes effect from the **next turn**. Every switch defaults to **off**: writing text is not enough, you also tick "apply to this session" / the workspace levels you want — otherwise the text stays stored and is not injected. Nothing outside the plugin's own data file is written.

Typical use:

- **Guardrails**: don't touch that directory this round, don't bump dependencies, run the tests before reporting back.
- **Coding conventions**: indentation, naming, comment language, commit message style.
- **Polish draft**: ask the model this session already uses (Harness's own `llm` service, whatever provider/model the app is configured with) to turn rough notes into executable bullets. The result never overwrites silently: the popup shows "original / rewritten" side by side and only "replace original" applies it. If the model is unavailable the button reports an error and manual editing still works.
- Every line of the editor is a `- ` bullet automatically (the prefix is added on input and newline, and cannot be deleted); blank lines stay for grouping.

The workspace `⋯` menu has no official extension slot in DSH: that item is added by DOM enhancement (it reuses the built-in item's style and keyboard behaviour). It may break when DSH reshapes its sidebar.

## Install

```bash
dsh plugin --profile desktop add /path/to/dsh-session-rules
```

Restart DeepSeek Harness afterwards. Both entries (`⋯` on a workspace row, `⋯` on a session row) appear in the sidebar.

From GitHub (builds `dist/` on install):

```bash
dsh plugin --profile desktop add github:lw0129a/dsh-session-rules
```

From npm:

```bash
dsh plugin --profile desktop add dsh-session-rules
```

## Usage

- **Workspace rules**: `⋯` on a workspace row → "Workspace rules". A workspace with no sessions yet can be configured as long as DSH has registered it.
- **Session rules**: `⋯` on a session row → "Session rules". Write this session's block, and tick any number of workspace levels to bring in (read-only preview per level).
- "Save" → effective from the next turn; save with empty text = stop injecting.

Rules live in `~/.dsh/plugin-data/dsh-session-rules/rules.json` (`DSH_HOME` overrides): session blocks keyed by session id, workspace blocks keyed by `ws:<absolute path>` (e.g. `ws:/Users/you/project`). The hierarchy is the paths themselves: every ancestor of a workspace (that is also a registered workspace) can hold its own block, and a child records which ancestors it inherits in `inherit`. Injection order is "ticked ancestors (outer → inner) → this level → this session". Everything is **off by default**; only explicit ticks reach the system prompt.

## Scope and cost

- **Sent every turn**: once "apply to this session" (or "apply workspace rules") is ticked, the text becomes part of the system prompt and is sent on **every** turn of that session; untick it and nothing is sent, the text just stays on disk. Edits apply from the next turn; earlier turns are not rewritten.
- **More levels, more tokens**: workspace rules accumulate by level — ticking three levels puts three blocks into the prompt. Tick only what the session actually needs.
- **Where the hierarchy comes from**: the workspace directory paths, which match the sidebar's "View options → Group by → Workspace tree". That grouping is DSH's own setting and the plugin does not change it; without the tree view everything still works, the sidebar just shows a different shape.

## Where the data lives / when it disappears

- **Location**: `$DSH_HOME/plugin-data/dsh-session-rules/rules.json` (default `~/.dsh/plugin-data/dsh-session-rules/rules.json`), owned by this plugin, version-free path.
- **Survives upgrades**: upgrading swaps the code directory only; data is stored per plugin name. Copy that file to migrate machines.
- **Disabled / not loaded**: no routes, no menu entries, no prompt injection; the file stays untouched and works again once re-enabled.
- **Deleting a workspace / session**: the matching block is dropped on the next read.
- **Uninstalling**: DSH does not call back into the plugin, so the file stays under `plugin-data/dsh-session-rules/`; delete that directory yourself if you don't want it.

## Permissions and footprint

| Touches | What for | Where |
| --- | --- | --- |
| System prompt | Adds a `session-rules` section (order 10190, no interpolation). **Only injected for sessions that ticked the switches**; otherwise stored but never sent | Harness `systemPrompt` service |
| Plugin data (the only file it writes) | Rules text, switches, per-level ticks; stale blocks are dropped on read | `$DSH_HOME/plugin-data/dsh-session-rules/rules.json` |
| Workspace list (read-only) | Real paths, titles, member sessions — used to derive the hierarchy | `$DSH_HOME/storages/workspace.json` |
| Sessions tree (read-only) | Which workspace a session belongs to, and whether it still exists | `$DSH_HOME/sessions/**` |
| Local HTTP route | Popup read/write: `GET/POST /__chameleon/session/rules` on Harness's own web server | Local, same origin |
| Model call | Only on "polish draft", through the provider/model Harness is configured with — no direct external API | Harness `llm` service |
| UI | Session-row menu item, workspace-rules dialog, one DOM-enhanced item in the workspace `⋯` menu, one injected stylesheet | Harness sidebar / overlay |

It never modifies Harness's app files or any project file, and makes no network calls other than Harness's own model service.

## Safety and boundaries

- The plugin does exactly one thing: workspace and session rules. It ships no sample rules, carries no user content, reports nothing anywhere, and the repo contains no user rules or machine paths.
- It never modifies Harness's app files or any project file (`AGENTS.md` is injected by Harness itself; the plugin does not read it).
- Injected text goes in verbatim — no `{{variable}}` interpolation.
- The HTTP route rejects unauthenticated requests through `connection.requestRejection`, like every other Harness plugin.
- One block is capped at 100 K characters.

## Development

TypeScript in `src/`, `tsc` emits `dist/`. npm or pnpm:

```bash
npm install && npm run build   # or pnpm install && pnpm build
npm test                        # build + self-check: id normalisation, store I/O, injection
```

- `src/index.ts`: host side. Registers the `systemPrompt` section (rules resolved per session on each assembly) and one exact `webServer` route.
- `src/client.ts`: browser side. A classic script emitted by `tsc` (the `__ModuleLoader__` factory), no bundler; sidebar menu items and the two dialogs.
- `tsconfig.json`: mirrors the `dsh-app-packager` plugin (ES2022 / nodenext / declaration).
- `cordis.patch.yml`: the plugin row inserted when installed as a bundle.

Installing from git requires `npm run build` (or `pnpm build`) first, because `dsh plugin add` on a directory uses `dist/`.

## License

MIT
