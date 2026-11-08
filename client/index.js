/**
 * dsh-dual-screen — 客户端半边（P2）：左侧菜单栏「副屏」开关
 *
 * 以 dsh.client bundle 格式加载（window.__ModuleLoader__.load，同 dsh-meme / dsh-im 写法）：
 *   exports.inject = ['slots']
 *   exports.apply(ctx) 里 slots.inject('sidebar.panellist', () => slots.register(...))
 *
 * ⚠️ 两条硬口径（PLAN §5.5 / F11）：
 *   1. register 的 id 必须等于 loader entry 名 `dsh-dual-screen`，否则 ModuleLoader 报
 *      "loaded without registering dsh-dual-screen"
 *   2. sidebar.panellist 是 **list 槽**：只画方形图标，标题由宿主从 label 投影
 *      → 图标必须能自解释，label 写「副屏」
 *
 * 三态（PLAN §5.5）：无副屏（灰·禁用）/ 面板关（空心）/ 面板开（实心）
 */
window.__ModuleLoader__.load((() => {
  const module = { exports: {} }
  const exports = module.exports

  const API = '/dsh-dual-screen'

  async function getState() {
    try {
      const res = await fetch(API + '/panel.json', { cache: 'no-store' })
      if (!res.ok) return null
      return await res.json()
    } catch { return null }
  }

  async function toggle() {
    try {
      await fetch(API + '/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    } catch {}
  }

  /** 三态图标：state = 'unavailable' | 'closed' | 'open' */
  function makeIcon(getReact) {
    return function DualScreenIcon() {
      const React = getReact()
      const [state, setState] = React.useState('closed')

      React.useEffect(() => {
        let alive = true
        const tick = async () => {
          const s = await getState()
          if (!alive) return
          if (!s || !s.display || !s.display.hasSecondary) setState('unavailable')
          else if (s.panel && s.panel.status === 'open') setState('open')
          else setState('closed')
        }
        tick()
        const timer = setInterval(tick, 3000)
        return () => { alive = false; clearInterval(timer) }
      }, [])

      const color = state === 'unavailable' ? '#6b7d8f' : (state === 'open' ? '#4fb3ff' : '#9fb4c7')
      const fill = state === 'open' ? '#4fb3ff' : 'none'
      const title = state === 'unavailable'
        ? '副屏管家：只检测到一块屏，静默待命'
        : (state === 'open' ? '副屏管家：面板已开，点一下关闭' : '副屏管家：点一下在副屏打开面板')

      return React.createElement('button', {
        type: 'button',
        title,
        'aria-label': title,
        disabled: state === 'unavailable',
        onClick: (ev) => {
          ev.preventDefault()
          ev.stopPropagation()
          if (state === 'unavailable') return
          toggle()
          setState(state === 'open' ? 'closed' : 'open')
        },
        style: {
          width: 32, height: 32, padding: 0, border: 'none', background: 'transparent',
          cursor: state === 'unavailable' ? 'not-allowed' : 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          opacity: state === 'unavailable' ? 0.45 : 1,
        },
      }, React.createElement('svg', {
        width: 20, height: 20, viewBox: '0 0 20 20', fill: fill, stroke: color,
        strokeWidth: 1.6, strokeLinejoin: 'round', strokeLinecap: 'round',
      },
        // 两块屏：左小右大（竖屏），一眼看出「副屏」
        React.createElement('rect', { x: 2, y: 6, width: 7, height: 6, rx: 1 }),
        React.createElement('rect', { x: 11.5, y: 3, width: 6.5, height: 12, rx: 1 }),
        React.createElement('path', { d: 'M4.5 14.5h3' }),
      ))
    }
  }

  function apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const Icon = makeIcon(() => React)
    const stops = []
    stops.push(slots.inject('sidebar.panellist', () => slots.register({
      name: 'sidebar.panellist',
      id: 'dsh-dual-screen',
      order: 30,
      label: () => '副屏',
    }, () => React.createElement(Icon))))
    ctx.effect(() => () => { for (const stop of stops) { try { stop && stop() } catch {} } })
  }

  exports.apply = apply
  exports.inject = ['slots']
  return module.exports
})())