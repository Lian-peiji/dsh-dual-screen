// cost-report.mjs -- turn DSH's usage ledger into numbers we can act on (read-only).
//
// File shape (2026-11-06): { date, lastBalance, todayUsage, history{}, accounting{},
// dayStart, events[], settings }. `events` is the per-call log we summarise here.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const home = String.raw`E:\dsh`
const raw = JSON.parse(readFileSync(join(home, '.dshw-usage.json'), 'utf8'))
const recs = Array.isArray(raw.events) ? raw.events : []

const fmt = (n) => (n >= 1e8 ? (n / 1e8).toFixed(2) + '亿' : n >= 1e4 ? (n / 1e4).toFixed(1) + '万' : String(n))

let tokens = 0
let cost = 0
const byDay = new Map()
const byModel = new Map()
for (const r of recs) {
  const t = Number(r.tokens || 0)
  const c = Number(r.cost || 0)
  tokens += t
  cost += c
  const d = String(r.day || '?')
  const day = byDay.get(d) || { tokens: 0, cost: 0, calls: 0 }
  day.tokens += t
  day.cost += c
  day.calls += 1
  byDay.set(d, day)
  const m = String(r.model || '?')
  const mm = byModel.get(m) || { tokens: 0, cost: 0, calls: 0 }
  mm.tokens += t
  mm.cost += c
  mm.calls += 1
  byModel.set(m, mm)
}

console.log('== 总计（DSH 全量账本，不是单个插件）==')
console.log('记账调用: ' + recs.length)
console.log('累计 tokens: ' + tokens + '  (' + fmt(tokens) + ')')
console.log('累计花费: ¥' + cost.toFixed(2))
console.log('单次平均: ' + Math.round(tokens / Math.max(1, recs.length)) + ' tokens / ¥' + (cost / Math.max(1, recs.length)).toFixed(3))
console.log('今日(todayUsage): ' + fmt(Number(raw.todayUsage || 0)))

console.log('\n== 按天（最近 8 天）==')
for (const [d, v] of [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 8)) {
  console.log('  ' + d + '  tokens=' + fmt(v.tokens).padStart(8) + '  ¥' + v.cost.toFixed(2).padStart(8) + '  调用=' + v.calls)
}

console.log('\n== 按模型 ==')
for (const [m, v] of [...byModel.entries()].sort((a, b) => b[1].tokens - a[1].tokens)) {
  console.log('  ' + m.padEnd(30) + ' tokens=' + fmt(v.tokens).padStart(8) + '  ¥' + v.cost.toFixed(2).padStart(8) + '  调用=' + v.calls)
}

console.log('\n== 最贵的 8 次 ==')
for (const r of recs.slice().sort((a, b) => Number(b.tokens) - Number(a.tokens)).slice(0, 8)) {
  const d = new Date(Number(r.ts)).toISOString().slice(5, 16).replace('T', ' ')
  console.log('  ' + d + '  ' + String(r.model).padEnd(26) + ' tokens=' + fmt(Number(r.tokens)).padStart(8) + '  ¥' + Number(r.cost).toFixed(3))
}

// history 里通常还有按天的长期汇总，比 events 覆盖面更全
try {
  const h = raw.history
  const entries = Array.isArray(h) ? h : Object.entries(h || {}).map(([k, v]) => ({ day: k, ...(typeof v === 'number' ? { tokens: v } : v) }))
  if (entries.length) {
    let ht = 0
    for (const e of entries) ht += Number(e.tokens || e.total || 0)
    console.log('\n== history 汇总 ==')
    console.log('  条数: ' + entries.length + '  合计 tokens: ' + fmt(ht))
    const last = entries.slice(-5)
    for (const e of last) console.log('  ' + JSON.stringify(e).slice(0, 140))
  }
} catch (e) {
  console.log('\nhistory 解析失败: ' + e.message)
}
