# dsh-session-rules

[简体中文](README.md) · **English**

Two kinds of rules for DeepSeek Harness: **workspace rules** (one block per directory; sub-directories can inherit from their parents) and **session rules** (this conversation only). The text rides along in that session's system prompt, which makes it a good place for standing preferences, coding conventions, or a temporary constraint for this round.

Every switch is **off by default**: writing text without ticking anything sends nothing.

## Install

```bash
# a local directory
dsh plugin --profile desktop add /path/to/dsh-session-rules

# or straight from GitHub (builds on install)
dsh plugin --profile desktop add github:lw0129a/dsh-session-rules

# or from npm
dsh plugin --profile desktop add dsh-session-rules
```

Restart DeepSeek Harness afterwards.

## Using it

**Workspace rules** — `⋯` on a workspace row in the sidebar → "Workspace rules".

- Put what every session under that directory should follow: "run `npm test` before reporting back", "only touch files the request mentions".
- When workspaces nest (`work` → `anjuyi` → `uni-platform-app`), a child can only **tick which parent blocks it inherits**; it cannot edit them.
- A workspace with no sessions yet can still be configured.

**Session rules** — `⋯` on a session row → "Session rules".

- Write what only applies to this conversation.
- The workspace section lists the chain level by level; tick any levels you want (multi-select). Those are read-only here — edit them in the workspace panel.

**Applying**: "Save" takes effect from the **next turn**. Saving an empty box turns injection off.

**Polish draft**: hands your rough notes to the model this session already uses. It never overwrites silently — the popup shows "original / rewritten" side by side and only "replace original" applies it. If the model is unavailable the button just reports an error; typing by hand keeps working.

## What the text can look like

The editor behaves like a Markdown list editor (Typora style). The text is injected verbatim — the plugin neither rewrites nor parses it:

- Levels go `-` → `1.` → `(1)` → `a.` → `(a)`, then `(a)` repeats; Enter continues the same level and numbers or letters count up (`a.` → `b.`).
- Enter on an empty item leaves the list; `Tab` indents two spaces, `Shift+Tab` outdents; `⌘Z` / `Ctrl+Z` undoes, `⇧⌘Z` / `Ctrl+Y` / `Ctrl+Shift+Z` redoes.
- Indentation, numbering, `##` headings and tables stay exactly as typed; conditional rules are just nested items.
- How the levels are interpreted is up to the model; the plugin only concatenates the blocks in the order you wrote (workspace levels outermost first).

## Token cost

- Once ticked, the text is part of **every** turn's request for that session. Untick it and nothing is sent — the text simply stays on disk.
- Workspace rules accumulate by level: three ticked levels means three blocks in the prompt. Long rules cost the same way. Tick only what a session actually needs.

## Where the data lives

- `~/.dsh/plugin-data/dsh-session-rules/rules.json` (`DSH_HOME` overrides the root).
- It belongs to this plugin alone; upgrading the plugin keeps it; copying it to another machine carries your rules over.
- Disabling the plugin removes the menu entries and stops all injection; the file stays untouched.
- Deleting a workspace or a session drops its block on the next read.
- Uninstalling leaves the file under `plugin-data/dsh-session-rules/`; delete that folder yourself if you don't want it.

## Boundaries

- It only reads and writes that one file — never Harness's app files, never anything in your project.
- No sample rules shipped, no user content carried, nothing reported anywhere.
- The only network activity is "Polish draft" calling the model service Harness is configured with.
- One block is capped at 100 K characters.
- The workspace-row `⋯` menu has no official extension slot in DSH, so that item is added by DOM enhancement (reusing the built-in item's style and keyboard behaviour). It may break when DSH reshapes its sidebar.

Works on macOS, Linux and Windows: rules are keyed by the workspace's absolute path and the hierarchy is derived from the path relation, not from one platform's spelling.

Install details, permissions and internals: [docs/DEVELOPING.md](docs/DEVELOPING.md).

## License

MIT
