/**
 * probe/p1-plugin-load.mjs —— 不重启宿主的前提下，先把「插件能不能加载」验掉。
 *
 * 用假 ctx 调 apply()，检查：导出形状对、4 个路由注册上了、屏幕探针通了、
 * 投送器被拉起并 hello、路由返回体正常、dispose 能把投送器收走。
 *
 * 这验证的是「加载与集成」，P1 的 Win32 行为由 probe/p1-acceptance.ps1 负责。
 *
 * 跑法（DSH 内置 node）：
 *   node probe/p1-plugin-load.mjs
 */
const registered = []
const cleanups = []
const logs = []
const tools = []          // P5-1：run_on_secondary 注册进来的工具定义

const ctx = {
  logger: { info: (m) => logs.push(String(m)), warn: (m) => logs.push('WARN ' + m), error: (m) => logs.push('ERR ' + m) },
  effect(fn) {
    const off = fn()
    cleanups.push(off)
    return () => { try { off && off() } catch {} }
  },
  // tools 服务：真宿主由 `inject: ['tools']` 保证存在。mock 不给它的话，
  // 「工具没注册」和「mock 没实现」在离线测试里长得一模一样（2026-11-06 的教训）。
  tools: {
    register(def) {
      tools.push(def)
      return () => { const i = tools.indexOf(def); if (i >= 0) tools.splice(i, 1) }
    },
  },
  // Event subscription: the real Cordis context has on(); this mock must too, or a
  // plugin that subscribes looks broken offline while working in production (and
  // worse: the reverse happens when the mock is too generous). Keep them in sync.
  handlers: {},
  on(event, fn) {
    ;(ctx.handlers[event] ||= []).push(fn)
    return () => {
      const arr = ctx.handlers[event] || []
      const i = arr.indexOf(fn)
      if (i >= 0) arr.splice(i, 1)
    }
  },
  webServer: {
    register(route) {
      registered.push(route)
      return () => { const i = registered.indexOf(route); if (i >= 0) registered.splice(i, 1) }
    },
  },
  get: () => null,
  emit: () => {},
}

const mod = await import('../lib/index.js')
const problems = []
function check(name, ok, detail = '') {
  if (!ok) problems.push(name + (detail ? ' :: ' + detail : ''))
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? '  ' + detail : ''}`)
}

check('module exports name/inject/apply', Boolean(mod.name && mod.inject && typeof mod.apply === 'function'), `name=${mod.name} inject=${JSON.stringify(mod.inject)}`)
check('inject declares webServer', Array.isArray(mod.inject) && mod.inject.includes('webServer'))

mod.apply(ctx)
await new Promise((r) => setTimeout(r, 3500))

const paths = registered.map((r) => r.path).sort()
console.log('routes:', JSON.stringify(paths))
for (const p of [
  '/dsh-dual-screen/health.json',
  '/dsh-dual-screen/displays.json',
  '/dsh-dual-screen/config',
  '/dsh-dual-screen/bridge.json',
  '/dsh-dual-screen/bridge/restart',
  '/dsh-dual-screen/layout-preview.json',
]) {
  check('route ' + p, paths.includes(p))
}

async function call(path, method = 'GET', body = null) {
  const route = registered.find((r) => r.path === path)
  if (!route) throw new Error('route not registered: ' + path)
  const chunks = []
  const res = {
    status: 200,
    headers: null,
    writeHead(s, h) { this.status = s; this.headers = h; return this },
    end(chunk) { if (chunk) chunks.push(String(chunk)); },
  }
  const req = { method, [Symbol.asyncIterator]: async function* () { if (body) yield Buffer.from(JSON.stringify(body)) } }
  await route.handler(req, res)
  return { status: res.status, body: chunks.join('') }
}

const health = await call('/dsh-dual-screen/health.json')
const h = JSON.parse(health.body)
check('health.json answers 200', health.status === 200)
check('health sees two monitors', h.monitors === 2, 'monitors=' + h.monitors)
check('health hasSecondary true', h.hasSecondary === true)
check('health dpi-aware per-monitor', h.dpiAwareAfter === 2, 'dpiAwareAfter=' + h.dpiAwareAfter)

// ── P5-1：run_on_secondary 必须真的注册进 tools 服务，且 spec 是宿主方言 ──────
const runTool = tools.find((t) => t.name === 'run_on_secondary')
check('P5-1 run_on_secondary registered as a tool', Boolean(runTool))
check('P5-1 health reports the tool registered', h.tool && h.tool.registered === true,
  JSON.stringify(h.tool))
if (runTool) {
  check('P5-1 parameters compiled to object schema', runTool.parameters?.type === 'object',
    JSON.stringify(runTool.parameters).slice(0, 160))
  check('P5-1 `command` is required',
    Array.isArray(runTool.parameters?.required) && runTool.parameters.required.includes('command'))
  check('P5-1 output.schema present', Boolean(runTool.output && runTool.output.schema))
  const rendered = typeof runTool.output?.render === 'function'
    ? runTool.output.render({}, { ok: true, pid: 4242, screen: '\\\\.\\DISPLAY2', mode: 'minimized' })
    : null
  check('P5-1 render returns a text row', Array.isArray(rendered) && rendered[0]?.type === 'text',
    JSON.stringify(rendered))
}
console.log('tool notes:', JSON.stringify(h.tool?.notes || []))
console.log('tool hooks in mock:', tools.length)

const bridgeRes = await call('/dsh-dual-screen/bridge.json')
const b = JSON.parse(bridgeRes.body)
console.log('bridge:', JSON.stringify({ status: b.bridge.status, pid: b.bridge.pid, hookOk: b.bridge.hookOk, secondary: b.bridge.secondary }))
check('bridge controller started by plugin', b.bridge.status === 'running', 'status=' + b.bridge.status)
check('bridge hook installed', b.bridge.hookOk === true)

const layout = JSON.parse((await call('/dsh-dual-screen/layout-preview.json')).body)
console.log('layout:', JSON.stringify(layout))
check('panel lands on secondary right', layout.panel && layout.panel.x > 2560, JSON.stringify(layout.panel))
check('tool window lands on secondary left', layout.toolWindow && layout.toolWindow.x >= 2560, JSON.stringify(layout.toolWindow))

const cfg = JSON.parse((await call('/dsh-dual-screen/config')).body)
// Not "equals the default": once the owner drags the panel edge the saved config
// legitimately differs. What matters is that a usable width/height comes back.
const cfgWidth = cfg.config && cfg.config.panel && cfg.config.panel.width
const cfgHeight = cfg.config && cfg.config.panel && cfg.config.panel.height
check('config returns a usable panel size',
  Number(cfgWidth) >= 320 && Number(cfgWidth) <= 480 && Number(cfgHeight) >= 300,
  `panel=${cfgWidth}x${cfgHeight}`)

// ── P5-1 execute 真打一次：隐藏窗口起一个立刻退出的 powershell（无视觉干扰）──
if (runTool && typeof runTool.execute === 'function') {
  const launched = await runTool.execute({ command: 'powershell.exe', args: '-NoProfile -Command exit', mode: 'hidden' })
  console.log('launch:', JSON.stringify(launched))
  check('P5-1 execute spawns on the secondary (hidden)', launched.ok === true && Number(launched.pid) > 0, JSON.stringify(launched))
  check('P5-1 execute reports a real screen', typeof launched.screen === 'string' && launched.screen.length > 0)
  const bad = await runTool.execute({ command: '' })
  check('P5-1 empty command rejected without throwing', bad.ok === false && Boolean(bad.message), JSON.stringify(bad))
}

// dispose -> the bridge must be collected
const bridgePid = b.bridge.pid
for (const off of cleanups.reverse()) { try { off() } catch {} }
await new Promise((r) => setTimeout(r, 1800))
function alive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}
console.log('after dispose, bridge pid', bridgePid, 'alive:', alive(bridgePid))
check('dispose stops the bridge process', alive(bridgePid) === false, 'pid=' + bridgePid)

console.log('')
console.log(problems.length === 0 ? 'RESULT: all checks passed' : 'RESULT: ' + problems.length + ' problem(s):\n  ' + problems.join('\n  '))
process.exit(problems.length === 0 ? 0 : 1)