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
    const MENU_ID = 'session-rules.menu'
    const DIALOG_ID = 'session-rules.dialog'
    const ENDPOINT = '/__chameleon/session/rules'
    const NS = 'session-rules'

    const ZH = {
      'menu.title': '会话守则',
      'dialog.title': '会话守则',
      'dialog.hint': '这里写的内容会加入本会话的系统提示词，每轮对话生效；不影响其他会话，也不改动项目文件。',
      'dialog.placeholder': '例如：\n- 修改前先跑测试\n- 只改和相关功能有关的文件\n- 中文回复，少用列表',
      'dialog.import': '导入项目规范',
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
      'dialog.pickHint': '选择要导入的项目规范文件（只读，不会修改原文件）：',
      'dialog.nothingFound': '没有找到项目规范文件（AGENTS.md / CLAUDE.md / .cursorrules 等）。',
      'dialog.importPicked': '导入选中',
      'dialog.sources': '已导入：',
      'dialog.cancel': '取消',
      'dialog.save': '保存',
      'dialog.saved': '已保存，下一轮对话生效。',
      'dialog.loadFailed': '读取失败',
      'dialog.saveFailed': '保存失败',
      'dialog.empty': '（尚未设置，留空即不注入）',
      'dialog.enabled': '对本会话生效',
      'dialog.disabledHint': '已关闭：守则内容保留，但不会加入本会话的系统提示词。',
    }
    const EN = {
      'menu.title': 'Session rules',
      'dialog.title': 'Session rules',
      'dialog.hint': 'Text here is added to this conversation’s system prompt on every turn. Other sessions and project files are untouched.',
      'dialog.placeholder': 'e.g.\n- Run the tests before changing code\n- Touch only files related to the task\n- Reply in Chinese',
      'dialog.import': 'Import project guidelines',
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
      'dialog.pickHint': 'Pick project guideline files to copy in (read-only, the originals are not modified):',
      'dialog.nothingFound': 'No project guideline file found (AGENTS.md / CLAUDE.md / .cursorrules …).',
      'dialog.importPicked': 'Import selected',
      'dialog.sources': 'Imported from: ',
      'dialog.cancel': 'Cancel',
      'dialog.save': 'Save',
      'dialog.saved': 'Saved — active from the next turn.',
      'dialog.loadFailed': 'Could not load',
      'dialog.saveFailed': 'Could not save',
      'dialog.empty': '(empty — nothing is injected)',
      'dialog.enabled': 'Apply to this session',
      'dialog.disabledHint': 'Off — the rules are kept but not added to this session’s system prompt.',
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

    // Every non-empty line is a rule bullet: "- " is added as you type and
    // cannot be deleted (deleting it just re-adds it). Lines you leave blank
    // stay blank so the text can be grouped.
    const BULLET = '- '
    function normalizeBullets(text) {
      const lines = text.split('\n').map((line) => {
        const bare = line.replace(/^[\s-]*/, '').replace(/\s+$/, '')
        return bare === '' ? '' : `${BULLET}${bare}`
      })
      return lines.join('\n')
    }

    function withBulletCaret(target) {
      const raw = target.value
      const caret = target.selectionStart ?? raw.length
      const beforeLines = raw.slice(0, caret).split('\n')
      const lineIndex = beforeLines.length - 1
      const oldLine = beforeLines[lineIndex]
      const next = normalizeBullets(raw)
      const newLine = next.split('\n')[lineIndex] ?? ''
      const shift = newLine.length - oldLine.length
      const position = Math.max(0, Math.min(next.length, caret + shift))
      if (next !== raw) {
        target.value = next
        target.setSelectionRange(position, position)
      }
      return next
    }

    function EditorDialog(props) {
      const seat = props.seat
      const sessionId = props.sessionId
      const t = (key) => resolveText(seat, key)
      const [rules, setRules] = React.useState('')
      const [sources, setSources] = React.useState([])
      const [enabled, setEnabled] = React.useState(true)
      const [loading, setLoading] = React.useState(true)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [note, setNote] = React.useState(null)
      const [candidates, setCandidates] = React.useState(null)
      const [picked, setPicked] = React.useState({})
      const [review, setReview] = React.useState(null)
      const [confirmOpen, setConfirmOpen] = React.useState(false)

      React.useEffect(() => {
        let cancelled = false
        fetch(`${ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}`, { credentials: 'same-origin' })
          .then((res) => res.json())
          .then((body) => {
            if (cancelled) return
            if (!body || body.ok !== true) throw new Error(body?.error ?? 'invalid response')
            setRules(typeof body.rules === 'string' ? body.rules : '')
            setSources(Array.isArray(body.sources) ? body.sources : [])
            setEnabled(body.enabled !== false)
          })
          .catch((cause) => {
            if (!cancelled) setError(`${t('dialog.loadFailed')}: ${String(cause?.message ?? cause)}`)
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
          const candidate = normalizeBullets(String(body.rules ?? '')).trim()
          if (candidate === '') throw new Error(t('dialog.candidateEmpty'))
          setReview({ original: rules, candidate })
        } catch (cause) {
          setError(`${t('dialog.optimizeFailed')} ${String(cause?.message ?? cause)}`)
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
            body: JSON.stringify({ sessionId, rules, sources, enabled }),
          })
          const body = await res.json()
          if (!body || body.ok !== true) throw new Error(body?.error ?? `HTTP ${res.status}`)
          setNote(t('dialog.saved'))
        } catch (cause) {
          setError(`${t('dialog.saveFailed')}: ${String(cause?.message ?? cause)}`)
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
          setError(`${t('dialog.saveFailed')}: ${String(cause?.message ?? cause)}`)
        }
      }

      async function loadCandidates() {
        setBusy(true)
        setError(null)
        try {
          const res = await fetch(`${ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}&candidates=1`, {
            credentials: 'same-origin',
          })
          const body = await res.json()
          if (!body || body.ok !== true) throw new Error(body?.error ?? `HTTP ${res.status}`)
          const files = Array.isArray(body.files) ? body.files : []
          setCandidates(files)
          const next = {}
          for (const file of files) next[file.path] = true
          setPicked(next)
        } catch (cause) {
          setError(`${t('dialog.loadFailed')}: ${String(cause?.message ?? cause)}`)
        } finally {
          setBusy(false)
        }
      }

      function importPicked() {
        if (!Array.isArray(candidates)) return
        const chunks = []
        const imported = []
        for (const file of candidates) {
          if (picked[file.path] !== true) continue
          chunks.push(`## 来源：${file.path}\n\n${file.content}`)
          imported.push(file.path)
        }
        if (chunks.length > 0) {
          setRules((previous) => {
            const base = previous.trim() === '' ? '' : `${previous.trimEnd()}\n\n`
            return `${base}${chunks.join('\n\n')}\n`
          })
          setSources((previous) => [...new Set([...previous, ...imported])])
          setNote(t('dialog.saved') === undefined ? null : null)
        }
        setCandidates(null)
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
                  const next = normalizeBullets(event.target.value)
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

      const children = review !== null ? reviewChildren : [
        h(
          'label',
          {
            key: 'toggle',
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              margin: '0 0 10px',
              fontSize: 13,
              color: 'var(--dsw-alias-text-primary, #1f2328)',
              cursor: 'pointer',
              userSelect: 'none',
            },
          },
          h('input', {
            type: 'checkbox',
            checked: enabled,
            onChange: (event) => setEnabled(event.target.checked),
            style: { width: 14, height: 14, accentColor: 'var(--dsw-alias-brand-primary, #0969da)', cursor: 'pointer' },
          }),
          h('span', null, t('dialog.enabled')),
        ),
        h('textarea', {
          key: 'editor',
          value: rules,
          placeholder: t('dialog.placeholder'),
          spellCheck: false,
          rows: 12,
          onChange: (event) => setRules(withBulletCaret(event.target)),
          style: textareaStyle,
        }),
      ]
      if (sources.length > 0) {
        children.push(
          h('p', { key: 'sources', style: { ...bodyStyle, margin: '8px 0 0' } }, `${t('dialog.sources')}${sources.join('、')}`),
        )
      }
      if (!enabled) children.push(h('p', { key: 'off', style: { ...bodyStyle, margin: '8px 0 0' } }, t('dialog.disabledHint')))
      if (error !== null) children.push(h('p', { key: 'error', style: { ...errorStyle, margin: '8px 0 0' } }, error))
      else if (note !== null) children.push(h('p', { key: 'note', style: { ...goodStyle, margin: '8px 0 0' } }, note))

      if (Array.isArray(candidates)) {
        children.push(h('p', { key: 'pickHint', style: { ...bodyStyle, margin: '12px 0 4px' } }, t('dialog.pickHint')))
        if (candidates.length === 0) {
          children.push(h('p', { key: 'none', style: bodyStyle }, t('dialog.nothingFound')))
        } else {
          children.push(
            h(
              'div',
              { key: 'pickList', style: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflow: 'auto' } },
              candidates.map((file) =>
                h(
                  'label',
                  { key: file.path, style: { ...bodyStyle, display: 'flex', gap: 6, alignItems: 'center' } },
                  h('input', {
                    type: 'checkbox',
                    checked: picked[file.path] === true,
                    onChange: (event) => setPicked((previous) => ({ ...previous, [file.path]: event.target.checked })),
                  }),
                  file.path,
                ),
              ),
            ),
          )
        }
      }

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
                    setRules(review.candidate)
                    setReview(null)
                    setNote(t('dialog.optimized'))
                    setError(null)
                  },
                },
                t('dialog.replace'),
              ),
            ]
          : [
              h(
                Button,
                { key: 'import', variant: 'outline', size: 'sm', onClick: importPicked, disabled: busy || !Array.isArray(candidates) || candidates.length === 0 },
                t('dialog.importPicked'),
              ),
              h(Button, { key: 'cancel', variant: 'outline', size: 'sm', onClick: props.onClose }, t('dialog.cancel')),
              h(Button, { key: 'save', variant: 'outline', size: 'sm', onClick: save, disabled: busy || loading }, t('dialog.save')),
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
              h(Button, { key: 'cancel', variant: 'outline', size: 'sm', onClick: () => setConfirmOpen(false) }, t('dialog.cancel')),
              h(
                Button,
                {
                  key: 'start',
                  variant: 'outline',
                  size: 'sm',
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
          title: t('dialog.title'),
          closeLabel: t('dialog.cancel'),
          description: t('dialog.hint'),
          footer,
        },
        Array.isArray(candidates) && candidates.length === 0
          ? children
          : [
              ...children,
              // "import" trigger sits above the list only before the list is loaded.
              Array.isArray(candidates)
                ? null
                : h(
                    'div',
                    { key: 'importRow', style: { marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' } },
                    h(Button, { variant: 'outline', size: 'sm', onClick: loadCandidates, disabled: busy || loading }, t('dialog.import')),
                    h(Button, { variant: 'outline', size: 'sm', onClick: () => { if (rules.trim() === '') { setNote(t('dialog.nothingToOptimize')); return } setConfirmOpen(true) }, disabled: busy || loading }, busy ? t('dialog.optimizing') : t('dialog.optimize')),
                  ),
            ].filter((item) => item !== null),
      )
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
        // `sessionId` is a standard prop for every row entry; only the row
        // owner's `useMenuOpenState` has to be contributed here.
        ctx.slots.inject(MENU_SLOT, () =>
          ctx.slots.register({
            name: MENU_SLOT,
            id: MENU_ID,
            order: 500,
            locale: NS,
            inject: (standard, hookContext) => ({
              hooks: {
                menuOpenState: () => (typeof hookContext === 'function' ? hookContext : () => [false, () => {}]),
              },
            }),
          }, MenuItem),
        )
        ctx.slots.inject(OVERLAY_SLOT, () =>
          ctx.slots.register({ name: OVERLAY_SLOT, id: DIALOG_ID, order: 100, locale: NS }, DialogHost),
        )
      },
    }
  },
})
