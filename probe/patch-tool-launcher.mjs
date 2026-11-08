// patch-tool-launcher.mjs —— 把「起可见窗口走副屏」做成**工具**，不靠记忆。
// 主人 2026-11-06：「这是个以后别的对话都要使用的插件，要考虑这些事情哦」
// → 别的 agent 不会记得 bin/run-on-secondary.cmd，但看得见工具列表。
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const P = 'J:/大肥鱼游乐场/dsh-dual-screen/lib/index.js'
let s = readFileSync(P, 'utf8')
if (s.includes('run_on_secondary')) { console.log('already patched'); process.exit(0) }

// 1) 需要 execFile（发起 launcher）与 tools 服务
if (!s.includes('execFile')) {
  s = s.replace(/(import {[^}]+} from 'node:path'
)/, "$1import { execFile } from 'node:child_process'
")
}
if (!s.includes('execFile')) throw new Error('could not ensure execFile import')
if (!s.includes("execFile")) throw new Error('could not ensure execFile import')
s = s.replace("export const inject = ['webServer']", "export const inject = ['webServer', 'tools']")

const TOOL = `
  // ── 工具 run_on_secondary：把「无感起窗」变成可发现的能力 ────────────────
  // 为什么做成工具：这个插件会给**别的会话**用，那些 agent 不会记得某个 .cmd 的
  // 路径，但会读工具列表。工具描述里写明「要给主人看的窗口一律用它」。
  ;(async () => {
    let defineTool = null
    try { defineTool = (await import('@deepseek-ai/dsh-tools')).defineTool } catch (e) { log('dsh-tools unavailable, run_on_secondary disabled: ' + String((e && e.message) || e)) }
    if (typeof defineTool !== 'function') return
    const tools = ctx.get('tools')
    if (!tools || typeof tools.register !== 'function') return
    const launcher = join(PANEL_DIR, '..', 'bin', 'run-on-secondary.ps1')
    const shell = join(process.env.SystemRoot || 'C:\\\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const spec = defineTool({
      name: 'run_on_secondary',
      description: '在副屏打开一个可见窗口（控制台/程序）：窗口出生就在副屏、默认最小化且不抢焦点。'
        + '需要给主人看的窗口一律用它，不要直接在主屏起控制台（会闪一下并抢走输入焦点）。',
      parameters: {
        command: { type: 'string', description: '要启动的程序，默认 cmd.exe' },
        args: { type: 'string', description: '传给程序的参数，默认 /k' },
        show: { type: 'boolean', description: 'true = 直接显示在副屏（仍不抢焦点）；默认 false = 最小化，点任务栏展开' },
      },
      async execute(args) {
        const a = args || {}
        const argv = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher,
          '-Command', String(a.command || 'cmd.exe'), '-Args', String(a.args || '/k')]
        if (a.show === true) argv.push('-Show')
        const out = await new Promise((resolve) => {
          execFile(shell, argv, { timeout: 20000, windowsHide: true }, (err, stdout, stderr) => {
            resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || (err && err.message) || '') })
          })
        })
        if (!out.ok) return { ok: false, message: '启动失败：' + (out.stderr || 'unknown') }
        let parsed = null
        try { parsed = JSON.parse((out.stdout || '').trim().split(/\\r?\\n/).pop() || '') } catch { }
        if (!parsed) return { ok: true, report: '已在副屏启动：' + out.stdout.trim() }
        return {
          ok: true,
          report: '已在副屏启动 pid=' + parsed.pid + ' rect=' + JSON.stringify(parsed.rect)
            + (parsed.show === 7 ? '（最小化；点任务栏展开）' : '（已显示，未抢焦点）'),
          pid: parsed.pid, rect: parsed.rect, showMode: parsed.show,
        }
      },
    })
    try {
      ctx.effect(() => tools.register(spec))
      log('tool run_on_secondary registered')
    } catch (e) { log('register run_on_secondary failed: ' + String((e && e.message) || e)) }
  })()

`
const anchor = '  const route = (path, handler) =>'
if (!s.includes(anchor)) throw new Error('route anchor not found')
s = s.replace(anchor, TOOL + anchor)

writeFileSync(P, s, 'utf8')
const ok = s.includes('run_on_secondary') && s.includes("inject = ['webServer', 'tools']") && s.includes('execFile')
console.log('tool patch:', ok)
if (ok) for (const d of ['E:/dsh/profiles/desktop/local-plugins/dsh-dual-screen', 'E:/dsh/profiles/desktop/node_modules/dsh-dual-screen']) copyFileSync(P, `${d}/lib/index.js`)
console.log(ok ? 'synced' : 'NOT synced')