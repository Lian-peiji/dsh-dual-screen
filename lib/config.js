/**
 * config.js —— 配置读写（PLAN §6.1 + §7.7 决策表）
 *
 * 数据根：E:\dsh\dual-screen\
 *   config.json      用户配置（只写用户改过的键也存全量，便于人肉看）
 *   logs\            投送器/面板日志
 *   edge-profile\    面板用的 Edge 独立 profile（绝不复用主人的 Edge profile）
 *
 * 约定：读不到/写坏了都不抛异常，永远回落默认值 —— 配置坏掉不能把插件拖死。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'

export const DATA_DIR = 'E:\\dsh\\dual-screen'
export const CONFIG_PATH = join(DATA_DIR, 'config.json')
export const LOG_DIR = join(DATA_DIR, 'logs')
export const EDGE_PROFILE_DIR = join(DATA_DIR, 'edge-profile')

/** PLAN §6.1 + §7.7 的默认值。改这里等于改出厂默认。 */
export const DEFAULTS = Object.freeze({
  enabled: true,
  panel: {
    topmost: true,          // 置顶但不抢焦点
    marginPx: 24,           // 与副屏可用区边缘的留白（物理像素）
    rememberSize: true,     // 记忆宽高与位置
    // 形态 C：折叠 56px 头像气泡 <-> 展开面板（PLAN §7.7.1，已拍板）
    form: 'expanded',       // 'collapsed' | 'expanded'（形态 C）；v2 透明桌宠预留（P6）
    width: 400,             // 展开宽 DIP，可拖 320–480
    minWidth: 320,
    maxWidth: 480,
    height: 900,            // 展开高，默认上限 900
    minHeight: 300,
    maxHeight: 1707,        // ≤ 屏高（副屏逻辑高 1707）
    collapsedSize: 56,      // 折叠头像直径
    x: null,                // 上次位置（物理像素，null = 副屏右上角）
    y: null,
    collapsed: false,
    // 随 DSH 启动自动打开（主人 2026-11-06 选定）。手动关掉的面板不会被它弹回来，
    // 见 lib/index.js 的 panelClosedByUser。
    autoOpen: false,
  },
  moveWindows: {
    enabled: true,
    respectManualDrag: true, // 手动拖回主屏后不拉回
    dpiSettleMs: 250,        // 跨 DPI 移动的第二段补偿延时（P0 实测结论）
    onlyAfterStart: true,    // 只搬本轮启动之后新建的窗
  },
  // V2 桌宠（P6）。theme 指向 panel/pets/<id>/，加新角色只要丢一个文件夹进去，
  // 不用改代码（规范见 panel/pets/whale/theme.json 的注释）。
  pet: {
    enabled: true,           // 关掉 = 不显示桌宠按钮、不自动启动
    theme: 'whale',          // 当前主题 id；空 = 用发现到的第一个
    size: 240,               // 窗口边长（物理像素）
    autoStart: false,        // 随 DSH 启动（默认关：桌宠是锦上添花，先让主人自己叫）
    followActivity: true,    // 跟着会话忙闲换表情；关掉就只用 idle + 随机动作
    // 单屏静默（PLAN §19.7）：没有副屏就不启动、副屏拔掉就收。桌宠是副屏的陪伴物，
    // 掉到主屏上会挡主人干活（与 §7.5 #15「面板只隐藏不搬主屏」同一条原则）。
    onlyOnSecondary: true,
  },
  // 副屏问答镜像（PLAN §26）。铁律：**永远不许影响 DSH 本体**。
  //   enabled=false      完全不接管，问题全走主窗口
  //   mode='race'        默认：主窗口照常弹 + 副屏也有一份，谁先答算谁
  //   mode='panel-only'  只有副屏能答（主人明确要求"主屏别弹"时才用）
  ask: {
    enabled: true,
    mode: 'race',
  },
  rules: {
    browser: true,           // ego 浏览器（cmdline 带 ego profile 标记）
    console: true,           // 终端（cmd/powershell/wt）
    extraProcesses: [],      // 额外白名单进程名
  },
  notify: {
    mainScreenDot: true,     // 面板关着时主屏最小提示（默认开，可关）
    longTaskMinutes: 10,
  },
})

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base
  const out = Array.isArray(base) ? base.slice() : { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v)
    } else {
      out[k] = v
    }
  }
  return out
}

export function ensureDirs() {
  for (const d of [DATA_DIR, LOG_DIR, EDGE_PROFILE_DIR]) {
    try { if (!existsSync(d)) mkdirSync(d, { recursive: true }) } catch {}
  }
}

let cache = null

export function loadConfig() {
  if (cache) return cache
  ensureDirs()
  let raw = null
  try { raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) } catch {}
  cache = deepMerge(DEFAULTS, raw || {})
  return cache
}

/** 原子写：先写 .tmp 再 rename，避免面板/投送器读到半个 JSON。 */
export function saveConfig(patch) {
  const merged = deepMerge(loadConfig(), patch)
  cache = merged
  ensureDirs()
  const tmp = CONFIG_PATH + '.tmp'
  try {
    writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8')
    renameSync(tmp, CONFIG_PATH)
    return { ok: true, config: merged }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err), config: merged }
  }
}

export function resetConfigCache() { cache = null }