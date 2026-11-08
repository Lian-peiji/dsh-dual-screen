/**
 * lib/client.js —— 副屏管家「小肥鱼」的侧栏开关（Client 半边）
 * ============================================================================
 * 主人要的：左侧菜单栏一个按钮，点一下开/关副屏那块常驻面板（PLAN R3 / §5.5）。
 *
 * 为什么挂在 `sidebar.footer.action` 而不是 `sidebar.panellist`：
 *   panellist 的语义是「主栏里的一个面板」（点开会在主内容区开页），
 *   footer.action 才是「Settings 旁边的一个动作按钮」—— 我们要的是开关，不是页面。
 *
 * 三条硬约束（照抄 update-guard / dsh-im 踩出来的）：
 *   ① 注册 id 必须等于包名（dsh-dual-screen），否则 ModuleLoader 报
 *      "loaded without registering <name>"；
 *   ② `dsh.client.inject` 必须声明用到的客户端包（runtime / connection / ui-slots）；
 *   ③ 任何接口挂了只能让按钮变灰，**绝不能白屏**（上次手写 bundle 把 DSH 启动搞崩过）。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-dual-screen',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    const URL_STATE = '/dsh-dual-screen/panel-window.json'
    const URL_HEALTH = '/dsh-dual-screen/health.json'
    const URL_TOGGLE = '/dsh-dual-screen/toggle'

    function getJson(url) {
      return fetch(url, { credentials: 'same-origin' }).then((r) => r.json())
    }

    /** 鲸鱼轮廓：身体 + 尾鳍 + 眼睛 + 一小股水柱。用 currentColor，跟随主题。 */
    function WhaleIcon(props) {
      const size = Number(props && props.size) || 18
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false',
      },
        h('path', { d: 'M3.2 13.2c0-2.9 2.9-5.2 6.6-5.2s6.4 2.1 6.4 4.9c0 1.9-1.4 3.4-3.6 4.1-1 .3-2.1.4-3.2.4-3.6 0-6.2-1.7-6.2-4.2z' }),
        h('path', { d: 'M16.4 13.4l4.3-2.6v5.6l-4.3-2.6z' }),
        h('path', { d: 'M8.6 8.2c0-1.6.7-2.6 1.7-2.9' }),
        h('circle', { cx: '8.1', cy: '12.6', r: '0.85', fill: 'currentColor', stroke: 'none' }),
      )
    }

    function WhaleToggle(props) {
      // 侧栏有两态：wide（展开，56px 以上）与 rail（56px 窄条，只画图标）。
      // 窄条里塞文字会被裁掉看不到，所以 wide=false 时只画鲸鱼图标 + 状态点。
      const wide = !props || props.wide !== false
      const [state, setState] = React.useState({ loading: true, hasSecondary: false, open: false, busy: false, error: '' })

      const refresh = React.useCallback(() => {
        Promise.all([getJson(URL_HEALTH), getJson(URL_STATE)])
          .then(([health, panel]) => {
            setState((s) => ({
              ...s,
              loading: false,
              error: '',
              hasSecondary: Boolean(health && health.hasSecondary),
              open: Boolean(panel && panel.panel && panel.panel.status === 'open'),
            }))
          })
          .catch((e) => setState((s) => ({ ...s, loading: false, error: String((e && e.message) || e) })))
      }, [])

      React.useEffect(() => {
        refresh()
        const timer = setInterval(refresh, 4000)
        return () => { clearInterval(timer) }
      }, [refresh])

      const toggle = (ev) => {
        try { if (ev && ev.stopPropagation) ev.stopPropagation() } catch { /* ignore */ }
        if (state.busy || !state.hasSecondary) return
        setState((s) => ({ ...s, busy: true }))
        fetch(URL_TOGGLE, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: '{}',
        })
          .then((r) => r.json())
          .then((j) => setState((s) => ({ ...s, busy: false, open: Boolean(j && j.open), error: j && j.ok === false ? String(j.error || '开关失败') : '' })))
          .catch((e) => setState((s) => ({ ...s, busy: false, error: String((e && e.message) || e) })))
      }

      const disabled = !state.hasSecondary || state.busy
      // 收起态 = 桌宠（2026-11-06 主人定的交互：不再有折叠圆气泡）。
      const label = !state.hasSecondary ? '小肥鱼（没有副屏）' : state.open ? '小肥鱼：面板已开 · 点一下收成桌宠' : '小肥鱼：桌宠在等你 · 点一下展开面板'
      const dot = state.open ? '#3fa66a' : (state.hasSecondary ? '#9fb4c7' : '#6b7280')

      const dotEl = h('span', {
        style: {
          width: '7px', height: '7px', borderRadius: '50%',
          background: dot, display: 'inline-block', marginLeft: wide ? '1px' : '0',
        },
      })
      return h('span', {
        role: 'button',
        title: state.error ? (label + ' · ' + state.error) : (label + '（点一下开/关）'),
        onClick: toggle,
        style: {
          display: 'inline-flex', alignItems: 'center', gap: wide ? '7px' : '2px',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.55 : 1,
          padding: '3px 2px', position: 'relative', whiteSpace: 'nowrap',
        },
      },
        // 窄条(rail)模式下只画图标+状态点，文字会被裁掉；宽模式三件套都画。
        h(WhaleIcon, { size: wide ? 18 : 20 }),
        wide ? h('span', { style: { fontSize: '12.5px' } }, '小肥鱼') : null,
        dotEl,
      )
    }

    // ── 设置页（P5-2）───────────────────────────────────────────────────────
    // 挂在 `settings.section` 上，读写走服务端同源路由 /dsh-dual-screen/config。
    // 三条硬约束沿用侧栏按钮那套：同步注册、任何失败只让这一段变灰、绝不白屏。

    const URL_CONFIG = '/dsh-dual-screen/config'
    const URL_PETS = '/dsh-dual-screen/pets.json'

    function pick(obj, path) {
      return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
    }
    function put(obj, path, value) {
      const keys = path.split('.')
      const out = { ...obj }
      let cur = out
      for (let i = 0; i < keys.length - 1; i++) {
        cur[keys[i]] = { ...(cur[keys[i]] || {}) }
        cur = cur[keys[i]]
      }
      cur[keys[keys.length - 1]] = value
      return out
    }

    const S_HINT = { fontSize: '12px', opacity: 0.66, lineHeight: '1.55' }
    const S_ROW = { display: 'flex', alignItems: 'center', gap: '12px', padding: '7px 0' }
    const S_LABEL = { flex: '1 1 auto', fontSize: '13px' }
    const S_BTN = {
      padding: '6px 14px', borderRadius: '9px', cursor: 'pointer', fontSize: '13px',
      border: '1px solid rgba(127,127,127,.45)', background: 'transparent', color: 'inherit',
    }
    const S_SELECT = {
      padding: '4px 8px', borderRadius: '8px', fontSize: '12.5px',
      border: '1px solid rgba(127,127,127,.45)', background: 'transparent', color: 'inherit',
    }

    function CheckRow(props) {
      const { label, hint, checked, onChange } = props
      return h('label', { style: S_ROW },
        h('span', { style: S_LABEL },
          label,
          hint ? h('div', { style: S_HINT }, hint) : null,
        ),
        h('input', { type: 'checkbox', checked: !!checked, onChange: (e) => onChange(e.target.checked) }),
      )
    }

    function DualScreenSettings() {
      const [state, setState] = React.useState({
        loading: true, draft: null, pets: [], tool: null, saving: false, msg: '', bad: false, error: '',
      })
      // 草稿真值放 ref：save 是 useCallback([]) 里的闭包，直接读 state 会拿到首次渲染的旧值；
      // 放进 setState 的 updater 里再嵌套 setState 又会被 StrictMode 重放（=POST 两次）。
      const draftRef = React.useRef(null)

      const load = React.useCallback(() => {
        setState((s) => ({ ...s, loading: true, msg: '', error: '' }))
        Promise.all([
          getJson(URL_CONFIG).catch(() => ({ ok: false })),
          getJson(URL_PETS).catch(() => ({ ok: false })),
          getJson(URL_HEALTH).catch(() => ({ ok: false })),
        ]).then(([cfg, pets, health]) => {
          const config = cfg && cfg.ok !== false ? (cfg.config || {}) : null
          draftRef.current = config ? JSON.parse(JSON.stringify(config)) : null
          setState((s) => ({
            ...s, loading: false,
            draft: draftRef.current,
            pets: (pets && (pets.themes || pets.pets) || []).map((p) => ({ id: p.id, name: p.name || p.id })),
            tool: (health && health.tool) || null,
            error: config ? '' : '读配置失败（/dsh-dual-screen/config 没返回 ok）',
          }))
        })
      }, [])

      React.useEffect(() => { load() }, [load])

      const set = React.useCallback((path, value) => {
        if (!draftRef.current) return
        draftRef.current = put(draftRef.current, path, value)
        setState((s) => ({ ...s, draft: draftRef.current, msg: '' }))
      }, [])

      const save = React.useCallback(() => {
        const draft = draftRef.current
        if (!draft) return
        setState((x) => ({ ...x, saving: true, msg: '' }))
        fetch(URL_CONFIG, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ui: { sidebarButton: pick(draft, 'ui.sidebarButton') },
            panel: { autoOpen: pick(draft, 'panel.autoOpen'), topmost: pick(draft, 'panel.topmost') },
            moveWindows: {
              enabled: pick(draft, 'moveWindows.enabled'),
              onlyAfterStart: pick(draft, 'moveWindows.onlyAfterStart'),
              respectManualDrag: pick(draft, 'moveWindows.respectManualDrag'),
            },
            pet: {
              enabled: pick(draft, 'pet.enabled'),
              autoStart: pick(draft, 'pet.autoStart'),
              onlyOnSecondary: pick(draft, 'pet.onlyOnSecondary'),
              followActivity: pick(draft, 'pet.followActivity'),
              theme: pick(draft, 'pet.theme'),
            },
            ask: { enabled: pick(draft, 'ask.enabled'), mode: pick(draft, 'ask.mode') },
          }),
        })
          .then((r) => r.json())
          .then((out) => {
            const ok = out && out.ok !== false
            if (ok && out.config) draftRef.current = JSON.parse(JSON.stringify(out.config))
            setState((x) => ({
              ...x, saving: false,
              draft: draftRef.current,
              msg: ok ? '已保存（面板/桌宠下一次动作时按新配置走）' : ('保存失败：' + ((out && out.error) || '未知错误')),
              bad: !ok,
            }))
          })
          .catch((e) => setState((x) => ({ ...x, saving: false, msg: '保存失败：' + String(e && e.message || e), bad: true })))
      }, [])

      if (state.loading && !state.draft) return h('div', { style: S_HINT }, '读取配置中…')
      if (!state.draft) return h('div', { style: { ...S_HINT, opacity: 0.8 } }, state.error || '读不到配置')

      const d = state.draft
      const themes = state.pets.length ? state.pets : [{ id: pick(d, 'pet.theme') || 'whale', name: pick(d, 'pet.theme') || 'whale' }]

      return h('div', { style: { maxWidth: '560px' } },
        h('div', { style: S_HINT }, '副屏管家「小肥鱼」：把本鲸调工具打开的窗口投送到副屏，副屏常驻面板承载时间线与问答，另有一只透明桌宠。'),

        h('div', { style: { marginTop: '14px' } },
          h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '2px' } }, '界面'),
          h(CheckRow, {
            label: '侧栏按钮', hint: '左侧菜单栏底部的「小肥鱼」开关；关掉不影响面板本身',
            checked: pick(d, 'ui.sidebarButton') !== false,
            onChange: (v) => set('ui.sidebarButton', v),
          }),
          h(CheckRow, {
            label: '随 DSH 启动打开面板', hint: '手动关掉的面板不会被自动弹回来',
            checked: !!pick(d, 'panel.autoOpen'),
            onChange: (v) => set('panel.autoOpen', v),
          }),
          h(CheckRow, {
            label: '面板置顶但不抢焦点',
            checked: pick(d, 'panel.topmost') !== false,
            onChange: (v) => set('panel.topmost', v),
          }),
        ),

        h('div', { style: { marginTop: '14px' } },
          h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '2px' } }, '窗口投送'),
          h(CheckRow, {
            label: '把新窗口投送到副屏',
            checked: pick(d, 'moveWindows.enabled') !== false,
            onChange: (v) => set('moveWindows.enabled', v),
          }),
          h(CheckRow, {
            label: '只搬本机启动之后新建的窗口', hint: '关掉会连你本来就开着的窗口一起搬，容易烦',
            checked: pick(d, 'moveWindows.onlyAfterStart') !== false,
            onChange: (v) => set('moveWindows.onlyAfterStart', v),
          }),
          h(CheckRow, {
            label: '手动拖回主屏后不再拉回',
            checked: pick(d, 'moveWindows.respectManualDrag') !== false,
            onChange: (v) => set('moveWindows.respectManualDrag', v),
          }),
        ),

        h('div', { style: { marginTop: '14px' } },
          h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '2px' } }, '桌宠'),
          h(CheckRow, {
            label: '显示桌宠',
            checked: pick(d, 'pet.enabled') !== false,
            onChange: (v) => set('pet.enabled', v),
          }),
          h(CheckRow, {
            label: '面板收起时用桌宠代替', hint: '关掉就两个都不出现；开着时它既是收起态，也是把小窗叫回来的入口',
            checked: pick(d, 'pet.autoStart') !== false,
            onChange: (v) => set('pet.autoStart', v),
          }),
          h(CheckRow, {
            label: '只在副屏上出现', hint: '没有副屏就收起来，不挡主屏干活',
            checked: pick(d, 'pet.onlyOnSecondary') !== false,
            onChange: (v) => set('pet.onlyOnSecondary', v),
          }),
          h(CheckRow, {
            label: '跟着会话忙闲换表情',
            checked: pick(d, 'pet.followActivity') !== false,
            onChange: (v) => set('pet.followActivity', v),
          }),
          h('div', { style: S_ROW },
            h('span', { style: S_LABEL }, '桌宠形象'),
            h('select', {
              style: S_SELECT,
              value: pick(d, 'pet.theme') || '',
              onChange: (e) => set('pet.theme', e.target.value),
            }, themes.map((t) => h('option', { key: t.id, value: t.id }, t.name))),
          ),
        ),

        h('div', { style: { marginTop: '14px' } },
          h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '2px' } }, '副屏问答'),
          h(CheckRow, {
            label: '问答也在副屏镜像一份',
            checked: pick(d, 'ask.enabled') !== false,
            onChange: (v) => set('ask.enabled', v),
          }),
          h('div', { style: S_ROW },
            h('span', { style: S_LABEL },
              '谁先答算谁',
              h('div', { style: S_HINT }, 'race = 主窗口照常弹，副屏也有；panel-only = 只在副屏问（主屏不弹）'),
            ),
            h('select', {
              style: S_SELECT,
              value: pick(d, 'ask.mode') || 'race',
              onChange: (e) => set('ask.mode', e.target.value),
            },
              h('option', { value: 'race' }, '主屏 + 副屏（竞速）'),
              h('option', { value: 'panel-only' }, '只在副屏'),
            ),
          ),
        ),

        state.msg ? h('div', { style: { marginTop: '12px', fontSize: '12.5px', color: state.bad ? '#e5484d' : 'inherit', opacity: state.bad ? 1 : 0.75 } }, state.msg) : null,

        h('div', { style: { display: 'flex', gap: '8px', marginTop: '14px' } },
          h('button', { style: S_BTN, onClick: save, disabled: state.saving }, state.saving ? '保存中…' : '保存'),
          h('button', { style: S_BTN, onClick: load }, '重新读取'),
        ),

        h('div', { style: { ...S_HINT, marginTop: '14px' } },
          '配置文件：E:\\dsh\\dual-screen\\config.json · 工具 run_on_secondary：',
          state.tool ? (state.tool.registered ? '✅ 已注册（在副屏开一个不发光的终端窗口）' : '⚠️ 没注册：' + (state.tool.error || '未知原因')) : '读不到状态',
        ),
      )
    }

    const inject = ['slots']

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (!slots) return
      // 注册必须**同步**发生：slots.inject 的工厂在 apply 期间求值，放到 fetch().then()
      // 里会拿不到（2026-11-06 实测：配置 true 但按钮一直不出现）。
      // 所以：永远同步注册，是否显示交给组件内部按 config 决定（见 WhaleToggle.enabled）。
      try {
        slots.inject('sidebar.footer.action', () => slots.register(
          { name: 'sidebar.footer.action', id: 'dual-screen', order: 40, label: '小肥鱼' },
          () => React.createElement(WhaleToggle),
        ))
        try { console.info('[dsh-dual-screen] sidebar button registered (sync)') } catch { /* ignore */ }
      } catch (e) {
        try { console.warn('[dsh-dual-screen] footer action registration failed:', e) } catch { /* ignore */ }
      }
      // 设置页：同样必须同步注册，参数一处不对就只丢这一页，不动侧栏按钮。
      try {
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'dual-screen', order: 36, label: '副屏管家' },
          () => React.createElement(DualScreenSettings),
        ))
      } catch (e) {
        try { console.warn('[dsh-dual-screen] settings.section registration failed:', e) } catch { /* ignore */ }
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})