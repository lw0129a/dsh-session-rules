// dsh-session-rules — client half (browser module-loader bundle).
//
// An entry in the sidebar session row's "..." menu opens a dialog where the
// user edits the rules/notes for THAT conversation. Saved text is injected by the host half
// into that session's system prompt (see src/index.ts).
//
// Bundle protocol: classic script registering a lazy factory.

(window as any).__ModuleLoader__.load({
  id: 'dsh-session-rules',
  factory(require) {
    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const Button = primitives.Button
    const MenuItemButton = primitives.MenuItemButton
    const Modal = primitives.Modal
    const h = React.createElement

    const MENU_SLOT = 'sidebar.workspaces.session.menu.item'
    const OVERLAY_SLOT = 'shell.overlay'
    // `sidebar.workspaces` is a `single` slot owned by the built-in browser, and
    // the workspace "..." menu is hard-coded, so the workspace editor hangs off
    // the footer action list (a `list` slot: any number of plugins may join).
    const MENU_ID = 'session-rules.menu'
    const DIALOG_ID = 'session-rules.dialog'
    const WORKSPACE_DIALOG_ID = 'session-rules.workspace-dialog'

    // Wider panels that still fit the window: 80% of the viewport at most, so
    // the dialog never spills out on a small window. DSH's Modal takes
    // `className` for the panel and `contentClassName` for the scrolling body.
    const DIALOG_CSS = [
      // Width follows the content, capped at 80% of the window; height is capped
      // the same way and the body scrolls when the content does not fit.
      '.dsw-session-rules-panel,.dsw-session-rules-panel-narrow{',
      'width:fit-content!important;min-width:min(520px,80vw);max-width:80vw;',
      'max-height:80vh!important;display:flex;flex-direction:column}',
      '.dsw-session-rules-panel-narrow{min-width:min(460px,80vw)}',
      // Header and footer stay put; only the body between them scrolls.
      '.dsw-session-rules-content{min-height:0;flex:1 1 auto;display:flex;flex-direction:column;overflow:hidden}',
      '.dsw-session-rules-content>*:last-child{min-height:0;overflow-y:auto}',
      // Footer buttons: roomier tap target, and the save button reads as the
      // primary action instead of looking like another cancel.
      '.dsw-session-rules-action{min-height:36px;padding:0 20px;border-radius:9px;',
      'font-size:13.5px;font-weight:500;display:inline-flex;align-items:center;',
      'justify-content:center;transition:background-color .15s,border-color .15s}',
      '.dsw-session-rules-action-primary{background:var(--dsw-alias-button-primary-fill,#1f6feb);',
      'border:1px solid transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}',
      '.dsw-session-rules-action-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#1a5fd0)}',
      '.dsw-session-rules-action-primary:disabled{opacity:.5;cursor:not-allowed}',
    ].join('')
    const DIALOG_CSS_ID = 'session-rules.dialog-css'

    function ensureDialogCss() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css="${DIALOG_CSS_ID}"]`) !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-session-rules'
      tag.dataset.pluginCss = DIALOG_CSS_ID
      tag.textContent = DIALOG_CSS
      document.head.appendChild(tag)
    }
    const ENDPOINT = '/__chameleon/session/rules'
    // The workspace "..." menu has no extension slot, so a DOM enhancer adds one
    // entry to it; the click lands here and the footer dialog opens on that
    // workspace.
    function pickStore() {
      const listeners: any = new Set()
      return {
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        pick(value) {
          for (const listener of listeners) listener(value)
        },
      }
    }
    const workspacePicker = pickStore()
    const NS = 'session-rules'

    const ZH = {
      'menu.title': '会话守则',
      'dialog.title': '会话守则',
      'dialog.hint': '这里写的内容会加入本会话的系统提示词，每轮对话生效；不影响其他会话，也不改动项目文件。',
      'dialog.listHint':
        '回车：续一条同级别条目（空条目回车退出列表）· Tab：缩进一级 · Shift+Tab：退回一级 · 层级标记：- → 1. → (1) → a. → (a)',
      'dialog.historyHint': '撤销 %s · 重做 %s',
      'dialog.placeholder': '例如：\n- 修改前先跑测试\n- 只改和相关功能有关的文件\n- 中文回复，少用列表',
      'dialog.optimize': '优化描述',
      'dialog.confirmTitle': '优化前请确认',
      'dialog.confirmBody': '会用当前会话所用的模型重写整段内容，原描述不会立刻改动，稍后可在新旧对照里选择是否替换。',
      'dialog.confirmPoints': '注意：\n- 内容会发送给你当前配置的模型厂商，按 token 计费\n- 重写可能改变措辞、合并或删减你认为重要的句子\n- 生成通常需要几秒到几十秒\n- 结果不满意可放弃本次优化，原描述保留',
      'dialog.confirmStart': '开始优化',
      'dialog.optimizing': '优化中…',
      'dialog.optimizeFailed': '优化失败（当前会话模型没响应，可稍后重试）',
      'dialog.optimized': '已优化，确认后点保存。',
      'dialog.reviewTitle': '优化结果对比',
      'dialog.reviewNote': '优化会把整段描述发给你配置的本机模型重新生成（消耗本机算力与时间，可能几十秒）；下面的「新描述」只在点「替换原描述」后才会生效，替换前的原文仍可复制留存。',
      'dialog.original': '原描述',
      'dialog.candidate': '新描述（可编辑）',
      'dialog.copy': '复制',
      'dialog.copied': '已复制',
      'dialog.replace': '替换原描述',
      'dialog.discardOptimize': '放弃本次优化',
      'dialog.candidateEmpty': '模型返回了空内容，请重试。',
      'dialog.nothingToOptimize': '先写点内容再优化。',
      'dialog.sources': '已导入：',
      'dialog.cancel': '取消',
      'dialog.save': '保存',
      'dialog.saved': '已保存，下一轮对话生效。',
      'dialog.loadFailed': '读取失败',
      'error.bad json body': '请求内容不是合法 JSON。',
      'error.body too large': '请求内容过长。',
      'error.could not save rules': '写入守则文件失败。',
      'error.empty completion': '模型返回了空内容。',
      'error.llm service unavailable': '当前没有可用的模型服务。',
      'error.method not allowed': '不支持的请求方法。',
      'error.model unavailable': '模型暂时不可用。',
      'error.no model selection': '这个会话没有选中的模型。',
      'error.nothing to optimize': '没有可以整理的内容。',
      'error.rules too long': '守则太长，超出了上限。',
      'error.rules too long to optimize': '守则太长，无法整理。',
      'error.sessionId is required': '没有取到会话 id，请重开会话。',
      'error.unauthorized': '请求被拒绝（未授权）。',
      'error.unknown workspace': '这个工作区已经不在工作区列表里了。',
      'error.invalid response': '返回内容无法解析。',
      'dialog.saveFailed': '保存失败',
      'dialog.empty': '（尚未设置，留空即不注入）',
      'dialog.sessionSection': '本会话守则',
      'dialog.sharedSection': '工作区守则',
      'dialog.sharedHint': '按层列出本会话所在工作区的守则，逐层勾选要带进本会话的内容（可多选）。内容要到「工作区守则」面板里编辑，这里只读。',
      'dialog.sharedUnavailable': '未能识别本会话的工作区，本次只能编辑本会话守则。',
      'dialog.inheritLayer': '沿用「%s」的守则',
      'dialog.sharedEditHint': '要改这些内容，用侧边栏工作区行的「⋯」菜单 →「会话守则」。',
      'menu.workspace': '会话守则',
      'ws.title': '工作区守则',
      'ws.hint': '每个工作区可以写一份守则；子工作区只能勾选是否沿用上层，不能改上层内容。会话里默认不带入，需要各自勾选启用。',
      'ws.empty': '还没有登记任何工作区。',
      'ws.loadFailed': '读取失败',
      'ws.saveFailed': '保存失败',
      'ws.saved': '已保存。',
      'ws.unknown': '找不到这个工作区，可能已被删除。',
      'ws.preview': '查看内容（只读）',
      'ws.own': '本工作区守则',
      'ws.ancestors': '沿用上层',
      'ws.noAncestors': '没有上层工作区。',
      'ws.inheritLabel': '沿用「%s」的守则',
      'ws.readonly': '上层守则由它自己维护，这里只能看。',
      'ws.close': '关闭',
      'ws.save': '保存',
      'dialog.enabled': '对本会话生效',
      'dialog.disabledHint': '已关闭：守则内容保留，但不会加入本会话的系统提示词。',
    }
    const EN = {
      'menu.title': 'Session rules',
      'dialog.title': 'Session rules',
      'dialog.hint': 'Text here is added to this conversation’s system prompt on every turn. Other sessions and project files are untouched.',
      'dialog.listHint':
        'Enter continues the item (on an empty item it leaves the list) · Tab indents · Shift+Tab outdents · Levels: - → 1. → (1) → a. → (a)',
      'dialog.historyHint': 'Undo %s / Redo %s',
      'dialog.placeholder': 'e.g.\n- Run the tests before changing code\n- Only touch files related to the task\n- Reply in Chinese, keep lists short',
      'dialog.optimize': 'Polish',
      'dialog.confirmTitle': 'Before polishing',
      'dialog.confirmBody': 'The session model rewrites the whole text. Your original stays untouched until you accept the result in the comparison view.',
      'dialog.confirmPoints': 'Heads up:\n- The text goes to your configured model provider and is billed per token\n- Rewording may merge or drop sentences you care about\n- It usually takes seconds to tens of seconds\n- You can discard the result; the original is kept',
      'dialog.confirmStart': 'Start polishing',
      'dialog.optimizing': 'Polishing…',
      'dialog.optimizeFailed': 'Polish failed (the session model did not answer — try again)',
      'dialog.optimized': 'Polished — review it, then save.',
      'dialog.reviewTitle': 'Review the polish',
      'dialog.reviewNote': 'Polishing sends the whole text to your local model and can take a while. Nothing changes until you press “Replace original”; the original below stays copyable either way.',
      'dialog.original': 'Original',
      'dialog.candidate': 'New text (editable)',
      'dialog.copy': 'Copy',
      'dialog.copied': 'Copied',
      'dialog.replace': 'Replace original',
      'dialog.discardOptimize': 'Discard polish',
      'dialog.candidateEmpty': 'The model returned nothing — try again.',
      'dialog.nothingToOptimize': 'Write something first.',
      'dialog.sources': 'Imported from: ',
      'dialog.cancel': 'Cancel',
      'dialog.save': 'Save',
      'dialog.saved': 'Saved — active from the next turn.',
      'dialog.loadFailed': 'Could not load',
      'error.bad json body': 'The request body was not valid JSON.',
      'error.body too large': 'The request body was too large.',
      'error.could not save rules': 'Could not write the rules file.',
      'error.empty completion': 'The model returned nothing.',
      'error.llm service unavailable': 'No model service is available.',
      'error.method not allowed': 'Unsupported request method.',
      'error.model unavailable': 'The model is unavailable right now.',
      'error.no model selection': 'This session has no model selected.',
      'error.nothing to optimize': 'There is nothing to tidy up yet.',
      'error.rules too long': 'The rules are too long.',
      'error.rules too long to optimize': 'The rules are too long to tidy up.',
      'error.sessionId is required': 'No session id — reopen the session.',
      'error.unauthorized': 'The request was rejected (unauthorized).',
      'error.unknown workspace': 'That workspace is no longer registered.',
      'error.invalid response': 'The response could not be read.',
      'dialog.saveFailed': 'Could not save',
      'dialog.empty': '(empty — nothing is injected)',
      'dialog.sessionSection': 'This session',
      'dialog.sharedSection': 'Workspace rules',
      'dialog.sharedHint': 'One row per workspace level; tick any number of them to bring their rules into this session. Read-only — edit the content in the Workspace rules panel.',
      'dialog.sharedUnavailable': 'This session’s workspace could not be located, so only the session rules can be edited here.',
      'dialog.inheritLayer': 'Inherit “%s”',
      'dialog.sharedEditHint': 'To change them, use the sidebar workspace row’s “⋯” menu → “Session rules”.',
      'menu.workspace': 'Session rules',
      'ws.title': 'Workspace rules',
      'ws.hint': 'Each workspace keeps its own rules; a child workspace can only opt into its ancestors, never edit them. Sessions do not inherit anything until they tick the box.',
      'ws.empty': 'No workspace is registered yet.',
      'ws.loadFailed': 'Could not load',
      'ws.saveFailed': 'Could not save',
      'ws.saved': 'Saved.',
      'ws.unknown': 'This workspace is gone — it may have been deleted.',
      'ws.preview': 'Show content (read only)',
      'ws.own': 'Rules for this workspace',
      'ws.ancestors': 'Inherited from',
      'ws.noAncestors': 'No parent workspace.',
      'ws.inheritLabel': 'Inherit “%s”',
      'ws.readonly': 'Owned by that workspace — read-only here.',
      'ws.close': 'Close',
      'ws.save': 'Save',
      'dialog.enabled': 'Apply to this session',
      'dialog.disabledHint': 'Off — the rules are kept but not added to this session’s system prompt.',
    }

    // Host errors arrive as English strings; the dictionaries carry one entry
    // per message so the dialog speaks the same language as the app.
    function describeError(t, cause) {
      const raw = String(cause?.message ?? cause ?? '').trim()
      const text = t(`error.${raw}`)
      return text === `error.${raw}` ? raw : text
    }

    function seatOf(props) {
      return props !== null && props !== undefined && typeof props.t === 'function' ? props.t : null
    }

    function resolveText(seat, key) {
      if (seat !== null) {
        try {
          const text = seat(key)
          if (typeof text === 'string' && text !== key) return text
        } catch {
          // Fall through to the built-in dictionaries.
        }
      }
      // The desktop UI ships Chinese by default; English only when the page or
      // the browser explicitly says so.
      let lang = 'zh'
      try {
        const docLang = typeof document !== 'undefined' ? String(document.documentElement?.lang || '') : ''
        const browserLang = typeof navigator !== 'undefined' ? String(navigator.language || '') : ''
        const raw = docLang !== '' ? docLang : browserLang
        if (raw.toLowerCase().startsWith('en')) lang = 'en'
      } catch {
        // Keep Chinese.
      }
      const dict = lang === 'zh' ? ZH : EN
      return dict[key] ?? key
    }

    // --- dialog request store (header button -> overlay dialog) -------------
    const listeners: Set<() => void> = new Set()
    let request: any = null

    function setRequest(next) {
      request = next
      for (const listener of listeners) {
        try {
          listener()
        } catch {
          // A dead subscriber must not break the others.
        }
      }
    }

    function subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    function useRequest() {
      const [value, setValue] = React.useState(request)
      React.useEffect(() => subscribe(() => setValue(request)), [])
      return value
    }

    // --- icon ---------------------------------------------------------------
    // Shield + check: the same glyph at every size, drawn inline so the menu
    // entry does not depend on which icon set a given shell build ships.
    function RulesIcon(props: any) {
      const size = props?.size ?? 14
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M8 1.6 13 3.5v4.1c0 3.1-2.1 5.6-5 6.8-2.9-1.2-5-3.7-5-6.8V3.5z' }),
        h('path', { d: 'm5.7 7.9 1.7 1.7 3-3.3' }),
      )
    }

    // --- sidebar session-row menu item ---------------------------------------
    // Same dialog as the header button: the row menu is the place users look
    // for per-session actions, and the header can be crowded.
    function MenuItem(props) {
      const text = resolveText(seatOf(props), 'menu.title')
      const openMenuState = props.useMenuOpenState
      const menu = typeof openMenuState === 'function' ? openMenuState() : undefined
      const closeMenu = menu && typeof menu[1] === 'function' ? menu[1] : null
      const select = () => {
        if (closeMenu !== null) closeMenu(false)
        setRequest({ sessionId: props.sessionId, seat: seatOf(props) })
      }
      return h(MenuItemButton, { icon: h(RulesIcon, { size: 14 }), onSelect: select }, text)
    }

    // --- dialog -------------------------------------------------------------
    const bodyStyle = { fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-text-secondary, #57606a)' }
    const errorStyle = { fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #cf222e)' }
    const goodStyle = { fontSize: 12, color: 'var(--dsw-alias-state-success-primary, #1a7f37)' }
    const textareaStyle = {
      width: '100%',
      boxSizing: 'border-box',
      minHeight: 180,
      padding: 8,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.5,
      color: 'var(--dsw-alias-text-primary, #1f2328)',
      background: 'var(--dsw-alias-bg-secondary, #f6f8fa)',
      border: '1px solid var(--dsw-alias-border-secondary, #d0d7de)',
      borderRadius: 6,
      resize: 'vertical',
    }

    // Markdown-style list editing, the way Typora does it: whatever marker the
    // author typed is what continues, Enter on an empty item leaves the list,
    // and Tab / Shift+Tab shift the line two spaces per level. Nothing is
    // rewritten behind the user's back.
    const LIST_ITEM = /^(\s*)([-*+]|\d+[.)]|\(\d+\)|[a-z][.)]|\([a-z]\))(\s+)(.*)$/i
    const INDENT = '  '

    function nextMarker(marker) {
      const parenNumber = /^\((\d+)\)$/.exec(marker)
      if (parenNumber !== null) return `(${Number(parenNumber[1]) + 1})`
      const dottedNumber = /^(\d+)([.)])$/.exec(marker)
      if (dottedNumber !== null) return `${Number(dottedNumber[1]) + 1}${dottedNumber[2]}`
      const parenLetter = /^\(([a-z])\)$/i.exec(marker)
      if (parenLetter !== null) return `(${nextLetter(parenLetter[1])})`
      const dottedLetter = /^([a-z])([.)])$/i.exec(marker)
      if (dottedLetter !== null) return `${nextLetter(dottedLetter[1])}${dottedLetter[2]}`
      return marker
    }

    function nextLetter(letter) {
      const lower = letter === letter.toLowerCase()
      const code = letter.toLowerCase().charCodeAt(0)
      const next = code >= 122 ? 97 : code + 1
      return String.fromCharCode(lower ? next : next - 32)
    }

    // The text to insert after Enter, or '' when the item is being closed.
    function listContinuation(line) {
      const match = LIST_ITEM.exec(line)
      if (match === null) return ''
      if (match[4].trim() === '') return ''
      return `${match[1]}${nextMarker(match[2])}${match[3]}`
    }

    // Depth decides the marker style, mirroring how the guide describes it:
    // level 1 is "- ", level 2 is "1. ", level 3 is "(1) ". Enter continues the
    // level you are on; Tab is what moves the line between levels.
    const MARKERS_BY_DEPTH = ['- ', '1. ', '(1) ', 'a. ', '(a) ']

    function markerAtDepth(depth, gap) {
      const marker = MARKERS_BY_DEPTH[Math.min(depth, MARKERS_BY_DEPTH.length - 1)]
      return `${marker.trimEnd()}${gap}`
    }

    function indentLine(line, shift) {
      const match = LIST_ITEM.exec(line)
      if (match === null) {
        return shift < 0 ? line.replace(/^ {0,2}/, '') : `${INDENT}${line}`
      }
      const spaces = shift < 0 ? Math.max(0, match[1].length - INDENT.length) : match[1].length + INDENT.length
      return `${' '.repeat(spaces)}${markerAtDepth(Math.floor(spaces / INDENT.length), match[3])}${match[4]}`
    }

    // Undo / redo for the rule text: one snapshot per edit burst, so a whole
    // burst of typing undoes at once instead of one character at a time.
    function createHistory(initial) {
      return { past: [], future: [], current: initial, stamp: 0 }
    }

    function sharedPrefixLength(left, right) {
      const limit = Math.min(left.length, right.length)
      let index = 0
      while (index < limit && left[index] === right[index]) index += 1
      return index
    }

    function historyRecord(history, value) {
      if (value === history.current) return
      const now = Date.now()
      const small = Math.abs(value.length - history.current.length) <= 40
      const burst = small && now - history.stamp < 700 && sharedPrefixLength(value, history.current) >= Math.min(value.length, history.current.length) - 40
      if (!burst) {
        history.past.push(history.current)
        if (history.past.length > 300) history.past.shift()
      }
      history.current = value
      history.stamp = now
      history.future.length = 0
    }

    function historyUndo(history) {
      if (history.past.length === 0) return undefined
      history.future.push(history.current)
      history.current = history.past.pop()
      history.stamp = 0
      return history.current
    }

    function historyRedo(history) {
      if (history.future.length === 0) return undefined
      history.past.push(history.current)
      history.current = history.future.pop()
      history.stamp = 0
      return history.current
    }

    // Cmd on macOS, Ctrl elsewhere: Cmd/Ctrl+Z undoes, Shift+Cmd/Ctrl+Z redoes,
    // and Windows also accepts the traditional Ctrl+Y.
    function isApplePlatform() {
      const platform = (navigator as any)?.userAgentData?.platform ?? navigator?.platform ?? ''
      return /mac|iphone|ipad/i.test(String(platform))
    }

    function handleHistoryKeys(event, apply) {
      const apple = isApplePlatform()
      if (event.altKey) return
      if (apple ? !event.metaKey : !(event.ctrlKey || event.metaKey)) return
      const key = String(event.key).toLowerCase()
      if (key === 'z') {
        event.preventDefault()
        apply(event.shiftKey ? 'redo' : 'undo')
        return
      }
      if (key === 'y' && !apple) {
        event.preventDefault()
        apply('redo')
      }
    }

    // React tracks the value it last rendered. Writing textarea.value directly
    // leaves that tracker stale, so the dispatched input event is dropped and
    // the edit is reverted on the next render — go through the native setter.
    function setValue(element, value) {
      const view = element.ownerDocument?.defaultView
      const prototype = view === null || view === undefined ? null : view.HTMLTextAreaElement.prototype
      const setter = prototype === null ? null : Object.getOwnPropertyDescriptor(prototype, 'value')?.set
      if (typeof setter === 'function') setter.call(element, value)
      else element.value = value
    }

    function editLine(target, edit) {
      const raw = target.value
      const start = raw.lastIndexOf('\n', (target.selectionStart ?? 0) - 1) + 1
      const endIndex = raw.indexOf('\n', target.selectionStart ?? 0)
      const end = endIndex < 0 ? raw.length : endIndex
      const line = raw.slice(start, end)
      const next = edit(line)
      if (next === line) return
      const caret = start + Math.max(0, (target.selectionStart ?? 0) - start + (next.length - line.length))
      setValue(target, `${raw.slice(0, start)}${next}${raw.slice(end)}`)
      target.setSelectionRange(caret, caret)
    }

    // Marker families: 1./1) and (1) count with digits, a./a) and (a) with
    // letters. Two items only renumber together when they share a family.
    function markerFamily(marker) {
      if (/^\(\d+\)$/.test(marker)) return 'paren-number'
      if (/^\d+[.)]$/.test(marker)) return 'number'
      if (/^\([a-z]\)$/i.test(marker)) return 'paren-letter'
      if (/^[a-z][.)]$/i.test(marker)) return 'letter'
      return ''
    }

    // After Enter inserts a sibling, the items below it at the same indent keep
    // counting from that sibling, so a list never shows 3 twice.
    function renumberTail(lines, index, indent, marker, gap) {
      const family = markerFamily(marker)
      if (family === '') return lines
      let current = marker
      for (let i = index; i < lines.length; i += 1) {
        const match = LIST_ITEM.exec(lines[i])
        if (match === null || match[1] !== indent || markerFamily(match[2]) !== family) break
        if (match[2] !== current) lines[i] = `${indent}${current}${gap}${match[4]}`
        current = nextMarker(current)
      }
      return lines
    }

    function handleListKeys(event) {
      const target = event.target
      if (event.key === 'Tab') {
        event.preventDefault()
        editLine(target, (line) => indentLine(line, event.shiftKey ? -1 : 1))
        target.dispatchEvent(new Event('input', { bubbles: true }))
        return
      }
      if (event.key !== 'Enter' || event.shiftKey) return
      const raw = target.value
      const caret = target.selectionStart ?? raw.length
      if (caret !== (target.selectionEnd ?? caret)) return
      const start = raw.lastIndexOf('\n', caret - 1) + 1
      const line = raw.slice(start, caret)
      const match = LIST_ITEM.exec(line)
      if (match === null) {
        // Plain text: Enter still starts a bullet, so no line is left without one.
        if (line.trim() === '') return
        event.preventDefault()
        const insert = `${MARKERS_BY_DEPTH[0]}`
        setValue(target, `${raw.slice(0, caret)}\n${insert}${raw.slice(caret)}`)
        target.setSelectionRange(caret + 1 + insert.length, caret + 1 + insert.length)
        target.dispatchEvent(new Event('input', { bubbles: true }))
        return
      }
      event.preventDefault()
      if (match[4].trim() === '') {
        // Empty item: drop the marker and stay on this line.
        setValue(target, `${raw.slice(0, start)}\n${raw.slice(caret)}`)
        target.setSelectionRange(start + 1, start + 1)
      } else {
        const insert = `${nextMarker(match[2])}${match[3]}`
        const head = `${raw.slice(0, caret)}\n${match[1]}${insert}`
        // tail[0] is what is left of the current line; the siblings below it
        // start at index 1 and are renumbered from the fresh marker.
        const tail = renumberTail(raw.slice(caret).split('\n'), 1, match[1], nextMarker(match[2]), match[3])
        setValue(target, `${head}${tail.join('\n')}`)
        target.setSelectionRange(caret + 1 + match[1].length + insert.length, caret + 1 + match[1].length + insert.length)
      }
      target.dispatchEvent(new Event('input', { bubbles: true }))
    }

  const checkbox = (key, checked, onChange, label) =>
    h(
      'label',
      {
        key,
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          margin: '0 0 10px',
          fontSize: 13,
          cursor: 'pointer',
          userSelect: 'none',
        },
      },
      h('input', {
        type: 'checkbox',
        checked,
        onChange: (event) => onChange(event.target.checked),
        style: { width: 14, height: 14, accentColor: 'var(--dsw-alias-brand-primary, #0969da)', cursor: 'pointer' },
      }),
      h('span', null, label),
    )

  const apple = isApplePlatform()
  const undoKey = apple ? '⌘Z' : 'Ctrl+Z'
  const redoKey = apple ? '⇧⌘Z' : 'Ctrl+Y'
  const hintStyle = {
    margin: '6px 0 0',
    fontSize: 12,
    lineHeight: 1.6,
    color: 'var(--dsw-alias-text-secondary, #57606a)',
  }

  const listHint = (t) =>
    h(
      'p',
      { key: 'listHint', style: { ...hintStyle, margin: '6px 0 0' } },
      `${t('dialog.listHint')} · ${t('dialog.historyHint').replace('%s', undoKey).replace('%s', redoKey)}`,
    )

  const sectionTitle = (key, label, extra?) =>
    h(
      'p',
      { key, style: { ...bodyStyle, fontWeight: 600, margin: extra === undefined ? '0 0 6px' : extra } },
      label,
    )

    function EditorDialog(props) {
      const seat = props.seat
      const sessionId = props.sessionId
      const t = (key) => resolveText(seat, key)
      // The shared block belongs to this session's workspace; the host resolves
      // and owns that store key. `shared === null` means it cannot be located.
      const [shared, setShared] = React.useState(null)
      const [rules, setRules] = React.useState('')
      const [sources, setSources] = React.useState([])
      const [enabled, setEnabled] = React.useState(false)
      const [inherit, setInherit] = React.useState([])
      const [loading, setLoading] = React.useState(true)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [note, setNote] = React.useState(null)
      const [review, setReview] = React.useState(null)
      const [confirmOpen, setConfirmOpen] = React.useState(false)
      const history = React.useRef(createHistory(''))
      const areaRef = React.useRef(null)

      const applyHistory = (direction) => {
        const next = direction === 'undo' ? historyUndo(history.current) : historyRedo(history.current)
        if (next === undefined) return
        setRules(next)
        const area = areaRef.current
        if (area !== null) {
          area.focus()
          area.setSelectionRange(next.length, next.length)
        }
      }

      const editRules = (value) => {
        setRules(value)
        historyRecord(history.current, value)
      }

      React.useEffect(() => {
        let cancelled = false
        setLoading(true)
        setError(null)
        setNote(null)
        setRules('')
        setSources([])
        setShared(null)
        fetch(`${ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}`, { credentials: 'same-origin' })
          .then((res) => res.json())
          .then((body) => {
            if (cancelled) return
            if (!body || body.ok !== true) throw new Error(body?.error ?? 'invalid response')
            const loaded = typeof body.rules === 'string' ? body.rules : ''
            setRules(loaded)
            history.current = createHistory(loaded)
            setSources(Array.isArray(body.sources) ? body.sources : [])
            setEnabled(body.enabled === true)
            setInherit(Array.isArray(body.inherit) ? body.inherit : [])
            const scope = body.shared
            if (scope !== null && typeof scope === 'object') {
              setShared({
                path: typeof scope.path === 'string' ? scope.path : '',
                title: typeof scope.title === 'string' ? scope.title : '',
                layers: Array.isArray(scope.layers)
                  ? scope.layers.map((layer) => ({
                      path: typeof layer?.path === 'string' ? layer.path : '',
                      title: typeof layer?.title === 'string' ? layer.title : '',
                      rules: typeof layer?.rules === 'string' ? layer.rules : '',
                    }))
                  : [],
              })
            }
          })
          .catch((cause) => {
            if (!cancelled) setError(`${t('dialog.loadFailed')}: ${describeError(t, cause)}`)
          })
          .finally(() => {
            if (!cancelled) setLoading(false)
          })
        return () => {
          cancelled = true
        }
      }, [sessionId])

      async function optimize() {
        if (rules.trim() === '') {
          setNote(t('dialog.nothingToOptimize'))
          return
        }
        setBusy(true)
        setError(null)
        setNote(null)
        try {
          const res = await fetch(ENDPOINT, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'optimize', rules }),
          })
          const body = await res.json()
          if (!body || body.ok !== true) throw new Error(t('dialog.optimizeFailed'))
          const candidate = String(body.rules ?? '').trim()
          if (candidate === '') throw new Error(t('dialog.candidateEmpty'))
          setReview({ original: rules, candidate })
        } catch (cause) {
          setError(`${t('dialog.optimizeFailed')} ${describeError(t, cause)}`)
        } finally {
          setBusy(false)
        }
      }

      async function save() {
        setBusy(true)
        setError(null)
        setNote(null)
        try {
          const res = await fetch(ENDPOINT, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              rules,
              sources,
              enabled,
              inherit,
            }),
          })
          const body = await res.json()
          if (!body || body.ok !== true) throw new Error(body?.error ?? `HTTP ${res.status}`)
          setNote(t('dialog.saved'))
        } catch (cause) {
          setError(`${t('dialog.saveFailed')}: ${describeError(t, cause)}`)
        } finally {
          setBusy(false)
        }
      }

      async function copyText(value) {
        try {
          await navigator.clipboard.writeText(value)
          setNote(t('dialog.copied'))
          setError(null)
        } catch (cause) {
          setError(`${t('dialog.saveFailed')}: ${describeError(t, cause)}`)
        }
      }

      const reviewChildren = []
      if (review !== null) {
        reviewChildren.push(h('p', { key: 'note', style: { ...bodyStyle, margin: '0 0 10px' } }, t('dialog.reviewNote')))

        const panel = (key, label, value, editable) => {
          const area = h('textarea', {
            key: `${key}Area`,
            value,
            readOnly: !editable,
            spellCheck: false,
            rows: 8,
            onChange: editable
              ? (event) => {
                  const next = event.target.value
                  setReview((previous) => (previous === null ? previous : { ...previous, candidate: next }))
                }
              : undefined,
            style: { ...textareaStyle, minHeight: 120, background: editable ? textareaStyle.background : 'var(--dsw-alias-bg-tertiary, #eef1f4)' },
          })
          return h(
            'div',
            { key, style: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
              h('span', { style: { ...bodyStyle, fontWeight: 600 } }, label),
              h(Button, { variant: 'outline', size: 'sm', onClick: () => copyText(value) }, t('dialog.copy')),
            ),
            area,
          )
        }

        reviewChildren.push(panel('original', t('dialog.original'), review.original, false))
        reviewChildren.push(panel('candidate', t('dialog.candidate'), review.candidate, true))
      }

      const layerCard = (layer) =>
        h(
          'div',
          {
            key: layer.path,
            style: {
              border: '1px solid var(--dsw-alias-border-secondary, #d0d7de)',
              borderRadius: 8,
              padding: '10px 12px',
              margin: '0 0 8px',
            },
          },
          h(
            'label',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                cursor: 'pointer',
                userSelect: 'none',
              },
            },
            h('input', {
              type: 'checkbox',
              checked: inherit.includes(layer.path),
              onChange: (event) =>
                setInherit((previous) =>
                  event.target.checked
                    ? [...new Set([...previous, layer.path])]
                    : previous.filter((item) => item !== layer.path),
                ),
            }),
            h('span', null, t('dialog.inheritLayer').replace('%s', layer.title)),
          ),
          layer.rules === ''
            ? h('p', { style: { ...bodyStyle, margin: '6px 0 0' } }, t('dialog.empty'))
            : h(
                'details',
                { style: { margin: '8px 0 0' } },
                h('summary', { style: { ...bodyStyle, cursor: 'pointer', margin: 0 } }, t('ws.preview')),
                h(
                  'pre',
                  {
                    style: {
                      ...textareaStyle,
                      margin: '8px 0 0',
                      minHeight: 0,
                      maxHeight: 180,
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                    },
                  },
                  layer.rules,
                ),
              ),
        )

      const sharedBlock =
        shared === null
          ? h('p', { key: 'noShared', style: { ...bodyStyle, margin: '14px 0 0' } }, t('dialog.sharedUnavailable'))
          : h(
              'div',
              { key: 'sharedBlock', style: { margin: '14px 0 0' } },
              sectionTitle(
                'sharedTitle',
                shared.title === '' ? t('dialog.sharedSection') : `${t('dialog.sharedSection')} — ${shared.title}`,
              ),
              h('p', { key: 'sharedHint', style: { ...bodyStyle, margin: '0 0 10px' } }, t('dialog.sharedHint')),
              shared.layers.map(layerCard),
              h('p', { key: 'sharedEditHint', style: { ...bodyStyle, margin: '8px 0 0' } }, t('dialog.sharedEditHint')),
            )

      const children = review !== null ? reviewChildren : [
        sectionTitle('sessionTitle', t('dialog.sessionSection')),
        checkbox('toggle', enabled, setEnabled, t('dialog.enabled')),
        h('textarea', {
          key: 'editor',
          ref: areaRef,
          value: rules,
          placeholder: t('dialog.placeholder'),
          spellCheck: false,
          rows: 12,
          onKeyDown: (event) => {
            handleListKeys(event)
            handleHistoryKeys(event, applyHistory)
          },
          onChange: (event) => editRules(event.target.value),
          style: textareaStyle,
        }),
        listHint(t),
        sharedBlock,
      ].filter((item) => item !== null)
      if (sources.length > 0) {
        children.push(
          h('p', { key: 'sources', style: { ...bodyStyle, margin: '8px 0 0' } }, `${t('dialog.sources')}${sources.join('、')}`),
        )
      }
      if (!enabled) children.push(h('p', { key: 'off', style: { ...bodyStyle, margin: '8px 0 0' } }, t('dialog.disabledHint')))
      if (error !== null) children.push(h('p', { key: 'error', style: { ...errorStyle, margin: '8px 0 0' } }, error))
      else if (note !== null) children.push(h('p', { key: 'note', style: { ...goodStyle, margin: '8px 0 0' } }, note))

      const footer =
        review !== null
          ? [
              h(Button, { key: 'discard', variant: 'outline', size: 'sm', onClick: () => { setReview(null); setNote(null); setError(null) } }, t('dialog.discardOptimize')),
              h(
                Button,
                {
                  key: 'replace',
                  variant: 'outline',
                  size: 'sm',
                  onClick: () => {
                    editRules(review.candidate)
                    setReview(null)
                    setNote(t('dialog.optimized'))
                    setError(null)
                  },
                },
                t('dialog.replace'),
              ),
            ]
          : [
              h(Button, { key: 'cancel', variant: 'outline', size: 'sm', className: 'dsw-session-rules-action', onClick: props.onClose }, t('dialog.cancel')),
              h(Button, { key: 'save', variant: 'outline', size: 'sm', className: 'dsw-session-rules-action dsw-session-rules-action-primary', onClick: save, disabled: busy || loading }, t('dialog.save')),
            ]

      if (confirmOpen) {
        return h(
          Modal,
          {
            open: true,
            onClose: () => setConfirmOpen(false),
            title: t('dialog.confirmTitle'),
            closeLabel: t('dialog.cancel'),
            description: t('dialog.confirmBody'),
            footer: [
              h(Button, { key: 'cancel', variant: 'outline', size: 'sm', className: 'dsw-session-rules-action', onClick: () => setConfirmOpen(false) }, t('dialog.cancel')),
              h(
                Button,
                {
                  key: 'start',
                  variant: 'outline',
                  size: 'sm',
                  className: 'dsw-session-rules-action dsw-session-rules-action-primary',
                  onClick: () => {
                    setConfirmOpen(false)
                    void optimize()
                  },
                },
                t('dialog.confirmStart'),
              ),
            ],
          },
          h('p', { style: { ...bodyStyle, margin: 0, whiteSpace: 'pre-line' } }, t('dialog.confirmPoints')),
        )
      }

      return h(
        Modal,
        {
          open: true,
          onClose: props.onClose,
          className: 'dsw-session-rules-panel',
          contentClassName: 'dsw-session-rules-content',
          title: t('dialog.title'),
          closeLabel: t('dialog.cancel'),
          description: t('dialog.hint'),
          footer,
        },
        [
          ...children,
          h(
            'div',
            { key: 'optimizeRow', style: { marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' } },
            h(
              Button,
              {
                variant: 'outline',
                size: 'sm',
                onClick: () => {
                  if (rules.trim() === '') {
                    setNote(t('dialog.nothingToOptimize'))
                    return
                  }
                  setConfirmOpen(true)
                },
                disabled: busy || loading,
              },
              busy ? t('dialog.optimizing') : t('dialog.optimize'),
            ),
          ),
        ],
      )
    }

    // Workspace rules are per directory: the host stores them under the
    // absolute path and derives the hierarchy from path prefixes, so the dialog
    // only shows what the registry already knows.
    function WorkspaceDialog(props) {
      const seat = props.seat
      const t = (key) => resolveText(seat, key)
      const desired = typeof props.initialPath === 'string' ? props.initialPath : ''
      const [items, setItems] = React.useState(null)
      // The workspace is decided by the row this panel was opened from; there
      // is nothing to pick here.
      const selected = desired
      const [rules, setRules] = React.useState('')
      const [inherit, setInherit] = React.useState([])
      const [loading, setLoading] = React.useState(true)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [note, setNote] = React.useState(null)
      const history = React.useRef(createHistory(''))
      const areaRef = React.useRef(null)

      const applyHistory = (direction) => {
        const next = direction === 'undo' ? historyUndo(history.current) : historyRedo(history.current)
        if (next === undefined) return
        setRules(next)
        const area = areaRef.current
        if (area !== null) {
          area.focus()
          area.setSelectionRange(next.length, next.length)
        }
      }

      const editRules = (value) => {
        setRules(value)
        historyRecord(history.current, value)
      }

      function loadInto(list, workspacePath) {
        const item = list.find((candidate) => candidate.path === workspacePath)
        if (item === undefined) {
          setError(t('ws.unknown'))
          return
        }
        const loaded = typeof item.rules === 'string' ? item.rules : ''
        setRules(loaded)
        history.current = createHistory(loaded)
        setInherit(Array.isArray(item.inherit) ? item.inherit : [])
        setError(null)
        setNote(null)
      }

      React.useEffect(() => {
        let cancelled = false
        fetch(`${ENDPOINT}?workspaces=1`, { credentials: 'same-origin' })
          .then((res) => res.json())
          .then((body) => {
            if (cancelled) return
            if (!body || body.ok !== true) throw new Error(body?.error ?? 'invalid response')
            const list = Array.isArray(body.workspaces) ? body.workspaces : []
            setItems(list)
            loadInto(list, desired)
          })
          .catch((cause) => {
            if (!cancelled) setError(`${t('ws.loadFailed')}: ${describeError(t, cause)}`)
          })
          .finally(() => {
            if (!cancelled) setLoading(false)
          })
        return () => {
          cancelled = true
        }
      }, [])

      async function save() {
        if (selected === '') return
        setBusy(true)
        setError(null)
        setNote(null)
        try {
          const res = await fetch(ENDPOINT, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'save-workspace', path: selected, rules, inherit }),
          })
          const body = await res.json()
          if (!body || body.ok !== true) throw new Error(body?.error ?? `HTTP ${res.status}`)
          setItems((previous) =>
            previous === null ? previous : previous.map((item) => (item.path === selected ? { ...item, rules, inherit } : item)),
          )
          setNote(t('ws.saved'))
        } catch (cause) {
          setError(`${t('ws.saveFailed')}: ${describeError(t, cause)}`)
        } finally {
          setBusy(false)
        }
      }

      const current = items === null ? undefined : items.find((item) => item.path === selected)
      const ancestors = current !== undefined && Array.isArray(current.ancestors) ? current.ancestors : []
      const detailStyle = {
        border: '1px solid var(--dsw-alias-border-secondary, #d0d7de)',
        borderRadius: 8,
        padding: '10px 12px',
        margin: '0 0 8px',
      }
      const ancestorRows = ancestors.map((ancestor) => {
        const source = items.find((item) => item.path === ancestor.path)
        const text = source === undefined ? '' : source.rules
        return h(
          'div',
          { key: ancestor.path, style: detailStyle },
          h(
            'label',
            { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', userSelect: 'none' } },
            h('input', {
              type: 'checkbox',
              checked: inherit.includes(ancestor.path),
              onChange: (event) =>
                setInherit((previous) =>
                  event.target.checked
                    ? [...new Set([...previous, ancestor.path])]
                    : previous.filter((item) => item !== ancestor.path),
                ),
            }),
            h('span', null, t('ws.inheritLabel').replace('%s', ancestor.title)),
          ),
          text === ''
            ? h('p', { style: { ...bodyStyle, margin: '6px 0 0' } }, t('dialog.empty'))
            : h(
                'details',
                { style: { margin: '8px 0 0' } },
                h('summary', { style: { ...bodyStyle, cursor: 'pointer', margin: 0 } }, t('ws.preview')),
                h(
                  'pre',
                  {
                    style: {
                      ...textareaStyle,
                      margin: '8px 0 0',
                      minHeight: 0,
                      maxHeight: 180,
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                    },
                  },
                  text,
                ),
              ),
        )
      })

      const children = [
        h('p', { key: 'hint', style: { ...bodyStyle, margin: '0 0 12px' } }, t('ws.hint')),
        items === null
          ? loading
            ? null
            : h('p', { key: 'empty', style: bodyStyle }, t('ws.empty'))
          : h(
              'div',
              { key: 'main', style: { display: 'flex', flexDirection: 'column' } },
              h('p', { key: 'pickTitle', style: { ...bodyStyle, fontWeight: 600, margin: '0 0 2px' } }, current === undefined ? '' : current.title),
              h('p', { key: 'pickPath', style: { ...bodyStyle, margin: '0 0 16px', wordBreak: 'break-all' } }, selected),
              sectionTitle('ownTitle', t('ws.own')),
              h('textarea', {
                key: 'ownArea',
                ref: areaRef,
                value: rules,
                placeholder: t('dialog.placeholder'),
                spellCheck: false,
                rows: 8,
                onKeyDown: (event) => {
                  handleListKeys(event)
                  handleHistoryKeys(event, applyHistory)
                },
                onChange: (event) => editRules(event.target.value),
                style: { ...textareaStyle, minHeight: 120 },
              }),
              listHint(t),
              h(
                'p',
                { key: 'ancTitle', style: { ...bodyStyle, fontWeight: 600, margin: '18px 0 8px' } },
                t('ws.ancestors'),
              ),
              ancestorRows.length === 0
                ? h('p', { key: 'noAnc', style: { ...bodyStyle, margin: 0 } }, t('ws.noAncestors'))
                : ancestorRows,
            ),
      ].filter((item) => item !== null)
      if (error !== null) children.push(h('p', { key: 'error', style: { ...errorStyle, margin: '8px 0 0' } }, error))
      else if (note !== null) children.push(h('p', { key: 'note', style: { ...goodStyle, margin: '8px 0 0' } }, note))

      return h(
        Modal,
        {
          open: true,
          onClose: props.onClose,
          className: 'dsw-session-rules-panel-narrow',
          contentClassName: 'dsw-session-rules-content',
          title: t('ws.title'),
          closeLabel: t('ws.close'),
          footer: [
            h(Button, { key: 'close', variant: 'outline', size: 'sm', className: 'dsw-session-rules-action', onClick: props.onClose }, t('ws.close')),
            h(Button, { key: 'save', variant: 'outline', size: 'sm', className: 'dsw-session-rules-action dsw-session-rules-action-primary', onClick: save, disabled: busy || loading || selected === '' }, busy ? t('ws.saved') : t('ws.save')),
          ],
        },
        children,
      )
    }

    // --- workspace "..." menu enhancer --------------------------------------
    // The workspace row menu is hard-coded in DSH and has no extension slot, so
    // this marks it up in the DOM once it opens, cloning the built-in item
    // markup so styling and keyboard behaviour stay native.
    const MENU_MARKER = 'data-session-rules-workspace-menu'

    function isDomElement(node: any): node is Element {
      return typeof Element !== 'undefined' && node instanceof Element
    }

    function childByClassPart(node: any, part: string): any {
      return Array.from(node.children as ArrayLike<any>).find(
        (child) => isDomElement(child) && Array.from(child.classList).some((name) => name.indexOf(part) >= 0),
      )
    }

    function workspaceRows(doc: any): any[] {
      return Array.from(doc.querySelectorAll('[role="treeitem"][aria-expanded]')).filter(
        (row) => childByClassPart(row, 'projectText') !== undefined,
      )
    }

    function activeMenu(doc: any, row: any): any {
      const button = childByClassPart(row, 'rowActions')?.querySelector('button[aria-label]')
      if (button === undefined || button === null) return undefined
      const box = button.getBoundingClientRect()
      let best: any
      for (const menu of Array.from(doc.querySelectorAll('[role="menu"]')) as any[]) {
        if (menu.querySelector('[role="menuitem"]') === null) continue
        const style = doc.defaultView?.getComputedStyle(menu)
        if (style !== undefined && (style.display === 'none' || style.visibility === 'hidden')) continue
        const rect = menu.getBoundingClientRect()
        const distance = Math.abs(rect.left - box.left) + Math.abs(rect.top - box.bottom)
        if (best === undefined || distance < best.distance) best = { menu, distance }
      }
      return best === undefined ? undefined : best.menu
    }

    function menuIcon(doc: any): any {
      const ns = 'http://www.w3.org/2000/svg'
      const svg = doc.createElementNS(ns, 'svg')
      svg.setAttribute('width', '16')
      svg.setAttribute('height', '16')
      svg.setAttribute('viewBox', '0 0 16 16')
      svg.setAttribute('fill', 'none')
      svg.setAttribute('stroke', 'currentColor')
      svg.setAttribute('stroke-width', '1.5')
      svg.setAttribute('stroke-linecap', 'round')
      svg.setAttribute('stroke-linejoin', 'round')
      svg.setAttribute('aria-hidden', 'true')
      for (const d of [
        'M8 1.6 13 3.5v4.1c0 3.1-2.1 5.6-5 6.8-2.9-1.2-5-3.7-5-6.8V3.5z',
        'm5.7 7.9 1.7 1.7 3-3.3',
      ]) {
        const path = doc.createElementNS(ns, 'path')
        path.setAttribute('d', d)
        svg.appendChild(path)
      }
      return svg
    }

    function menuEntry(doc: any, menu: any, label: string, onSelect: () => void): any {
      const reference = menu.querySelector('[role="menuitem"]')
      const referenceWrapper = reference === null ? null : reference.parentElement
      const wrapper = doc.createElement(referenceWrapper === null ? 'div' : referenceWrapper.tagName.toLowerCase())
      if (referenceWrapper !== null && referenceWrapper.className !== '') wrapper.className = referenceWrapper.className
      wrapper.setAttribute(MENU_MARKER, 'true')
      const button = doc.createElement('button')
      button.type = 'button'
      button.setAttribute('role', 'menuitem')
      if (reference !== null && reference.className !== '') button.className = reference.className
      const icon = doc.createElement('span')
      const iconReference = reference === null ? null : reference.children.item(0)
      if (isDomElement(iconReference)) icon.className = iconReference.className
      icon.appendChild(menuIcon(doc))
      const text = doc.createElement('span')
      const textReference = reference === null ? null : reference.children.item(1)
      if (isDomElement(textReference)) text.className = textReference.className
      text.textContent = label
      button.append(icon, text)
      button.addEventListener('click', (event: any) => {
        event.preventDefault()
        event.stopPropagation()
        onSelect()
      })
      wrapper.appendChild(button)
      return wrapper
    }

    function isZh(doc: any): boolean {
      const lang = doc?.documentElement?.getAttribute('lang') ?? ''
      return lang.toLowerCase().startsWith('zh')
    }

    function menuLabel(doc: any): string {
      return isZh(doc) ? '工作区守则' : 'Workspace rules'
    }

    function closeMenu(doc: any): void {
      const PointerEventCtor = doc.defaultView?.PointerEvent ?? doc.defaultView?.MouseEvent
      if (PointerEventCtor !== undefined) doc.dispatchEvent(new PointerEventCtor('pointerdown', { bubbles: true }))
    }

    function enhanceWorkspaceMenu(
      doc: any,
      handlers: { workspace: (workspacePath: string) => void },
    ): () => void {
      if (typeof doc?.createElement !== 'function') return () => {}
      const ObserverCtor = doc.defaultView?.MutationObserver
      if (ObserverCtor === undefined) return () => {}
      let scheduled = false
      let disposed = false
      const sync = () => {
        scheduled = false
        if (disposed) return
        const row = workspaceRows(doc).find((candidate: any) =>
          Array.from(candidate.classList as ArrayLike<string>).some((name) => name.indexOf('menuOpen') >= 0),
        )
        if (row === undefined) return
        const menu = activeMenu(doc, row)
        if (menu === undefined || menu.querySelector(`[${MENU_MARKER}]`) !== null) return
        const rowKey = row.getAttribute('data-row-key') ?? ''
        const workspaceId = rowKey.startsWith('workspace:') ? rowKey.slice('workspace:'.length) : ''
        if (workspaceId === '') return
        const viewport = menu.querySelector('[role="presentation"]') ?? menu
        // Both entries go directly under 重命名 (always the first item), so the
        // menu reads: rename, workspace rules, session rules, delete.
        const rename = menu.querySelector('[role="menuitem"]')
        const insertAfter = (node: any) => {
          if (rename === null) viewport.prepend(node)
          else if (rename.parentElement === null) viewport.prepend(node)
          else rename.parentElement.after(node)
        }
        const lookup = () =>
          fetch(`${ENDPOINT}?workspaces=1`, { credentials: 'same-origin' })
            .then((res) => res.json())
            .then((body) => (Array.isArray(body?.workspaces) ? body.workspaces : []))
            .catch(() => [])
        // One entry per row: a workspace row owns its workspace rules only.
        insertAfter(
          menuEntry(doc, menu, menuLabel(doc), () => {
            void lookup()
              .then((list: any[]) => {
                const match = list.find((item) => item.id === workspaceId)
                // A brand-new workspace can be missing from the registry the
                // plugin reads; still open the panel so it can be configured
                // (the picker inside lists every known level).
                handlers.workspace(match === undefined ? '' : match.path)
              })
              .finally(() => closeMenu(doc))
          }),
        )
      }
      const schedule = () => {
        if (scheduled || disposed) return
        scheduled = true
        queueMicrotask(sync)
      }
      const observer = new ObserverCtor(schedule)
      observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
      doc.addEventListener('click', schedule, true)
      schedule()
      return () => {
        disposed = true
        observer.disconnect()
        doc.removeEventListener('click', schedule, true)
        Array.from(doc.querySelectorAll(`[${MENU_MARKER}]`) as any[]).forEach((entry) => entry.remove())
      }
    }

    // Opens from the workspace row's "..." menu (see the DOM enhancer below);
    // there is no persistent sidebar button.
    function WorkspaceHost(props) {
      const seat = seatOf(props)
      const [open, setOpen] = React.useState(false)
      const [initialPath, setInitialPath] = React.useState('')
      React.useEffect(
        () =>
          workspacePicker.subscribe((workspacePath) => {
            setInitialPath(workspacePath)
            setOpen(true)
          }),
        [],
      )
      return open ? h(WorkspaceDialog, { seat, initialPath, onClose: () => setOpen(false) }) : null
    }

    function DialogHost(props) {
      const current = useRequest()
      if (current === null) return null
      return h(EditorDialog, { sessionId: current.sessionId, seat: current.seat, onClose: () => setRequest(null) })
    }

    return {
      name: NS,
      inject: ['slots'],
      apply(ctx) {
        // A throwing client plugin can take the whole web boot down with it, so
        // activation is best-effort: log and keep the rest of the app alive.
        try {
          // `sessionId` is a standard prop for every row entry; only the row
          // owner's `useMenuOpenState` has to be contributed here.
          ctx.slots.inject(MENU_SLOT, () =>
            ctx.slots.register({
              name: MENU_SLOT,
              id: MENU_ID,
              // Built-in rows sit at 100/200/300/400/450 (pin, rename, fork,
              // archive, session-id) and sort ascending, so 201 puts this entry
              // immediately under 重命名.
              order: 201,
              locale: NS,
              inject: (standard, hookContext) => ({
                hooks: {
                  menuOpenState: () => (typeof hookContext === 'function' ? hookContext : () => [false, () => {}]),
                },
              }),
            }, MenuItem),
          )
          ctx.slots.inject(OVERLAY_SLOT, () =>
            ctx.slots.register({ name: OVERLAY_SLOT, id: WORKSPACE_DIALOG_ID, order: 110, locale: NS }, WorkspaceHost),
          )
          ctx.slots.inject(OVERLAY_SLOT, () =>
            ctx.slots.register({ name: OVERLAY_SLOT, id: DIALOG_ID, order: 100, locale: NS }, DialogHost),
          )
          if (typeof document !== 'undefined') {
            ensureDialogCss()
            enhanceWorkspaceMenu(document, {
              workspace: (workspacePath) => workspacePicker.pick(workspacePath),
            })
          }
        } catch (error) {
          try {
            console.warn('[session-rules] client activation failed', error)
          } catch {}
        }
      },
    }
  },
})
