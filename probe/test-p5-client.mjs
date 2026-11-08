/**
 * probe/test-p5-client.mjs —— 离线验客户端半边（侧栏按钮 + 设置页）。
 *
 * 为什么值得单独测：客户端 bundle 是裸 IIFE，加载失败**不会**报在服务端；
 * 上次手写 bundle 把 DSH 启动搞崩过（HANDOFF §3 / PLAN §14.5）。
 * 这里用最小 React 桩把 factory 跑起来，检查：
 *   1) 注册 id 等于包名、两种 slot 都注册、各注册一次；
 *   2) 组件工厂（注册时传的 thunk）调得动、不抛；
 *   3) apply() 在 slots 拿不到 / register 抛错时**不掀桌子**（降级）。
 *
 * 跑法：node probe/test-p5-client.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const problems = []
const check = (name, ok, detail = '') => {
  if (!ok) problems.push(name + (detail ? ' :: ' + detail : ''))
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? '  ' + detail : ''}`)
}

// ── 最小 React 桩：只实现组件里用到的那几个 hook ──────────────────────────
const React = {
  createElement(type, props, ...children) {
    if (typeof type === 'function') return { type, props, children }   // 不真的渲染
    return { type, props, children }
  },
  useState(init) {
    const v = typeof init === 'function' ? init() : init
    return [v, () => {}]
  },
  useCallback(fn) { return fn },
  useEffect() {},
  useRef(v) { return { current: v } },
}

// ── 加载 bundle：它调 window.__ModuleLoader__.load({...}) ─────────────────
let loaded = null
globalThis.window = {
  __ModuleLoader__: {
    load(def) { loaded = def },
  },
}
const bundlePath = join(ROOT, 'lib', 'client.js')
await import(pathToFileURL(bundlePath).href)
check('bundle calls ModuleLoader.load', Boolean(loaded))
check('client bundle registers package id', loaded && loaded.id === 'dsh-dual-screen', loaded && loaded.id)

const mod = loaded.factory((name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
})
check('factory exports apply + inject', typeof mod.apply === 'function' && Array.isArray(mod.inject))

const registrations = []
function makeCtx(failRegister = false) {
  return {
    get(name) {
      if (name !== 'slots') return null
      return {
        inject(slotName, fn) { fn() },
        register(meta, compFactory) {
          if (failRegister) throw new Error('register exploded')
          registrations.push({ meta, compFactory })
        },
      }
    },
  }
}

mod.apply(makeCtx())
const slots = registrations.map((r) => r.meta.name).sort()
console.log('slots:', JSON.stringify(slots))
check('registers sidebar.footer.action', slots.includes('sidebar.footer.action'))
check('registers settings.section', slots.includes('settings.section'))
check('each slot exactly once', registrations.length === 2, 'count=' + registrations.length)

const setting = registrations.find((r) => r.meta.name === 'settings.section')
check('settings section id is dual-screen', setting && setting.meta.id === 'dual-screen', setting && setting.meta.id)
check('settings section has a label', Boolean(setting && setting.meta.label), setting && setting.meta.label)

// 组件工厂只有在真正渲染时才会被调用；这里至少把它调通（不渲染）
let rendered = null
try { rendered = setting.compFactory() } catch (e) { rendered = e }
check('settings component factory returns an element', rendered && !(rendered instanceof Error), String(rendered && rendered.message || ''))

// ── 降级：slots 缺席 / register 抛错都不许把宿主带走 ──────────────────────
let threw = null
try { mod.apply({ get: () => null }) } catch (e) { threw = e }
check('apply survives a missing slots service', !threw, String(threw && threw.message))

threw = null
try { mod.apply(makeCtx(true)) } catch (e) { threw = e }
check('apply survives register throwing', !threw, String(threw && threw.message))

// 重复 apply（热重载会出现）：不许抛、注册数按新 ctx 走
registrations.length = 0
threw = null
try { mod.apply(makeCtx()) } catch (e) { threw = e }
check('apply is re-entrant', !threw && registrations.length === 2, 'count=' + registrations.length)

// bundle 必须自带设置页文案（防止误提交一个空壳）
const src = readFileSync(bundlePath, 'utf8')
check('bundle contains the settings copy', src.includes('副屏管家') && src.includes('run_on_secondary'))

console.log('')
console.log(problems.length === 0 ? 'RESULT: all client checks passed' : 'RESULT: ' + problems.length + ' problem(s):\n  ' + problems.join('\n  '))
process.exit(problems.length === 0 ? 0 : 1)
