// patch-p3-mood2.mjs -- fix the three real gaps the six-mood test caught.
//
// 1) tool/call alone fell back to idle: a mid-turn pet must stay "work", and the
//    only "am I inside a turn" signal we own is turn/start .. turn/end.
//    -> add activity.turnActive.
// 2) an aborted turn still read "sad": lastErrorAt from the previous error turn
//    was never cleared, so a user cancel inherited the previous failure's face.
//    -> a new turn/start clears lastErrorAt (new round = past the error).
// 3) same stale error made "running -> work" report sad.
//
// Anchor-asserted edits (PLAN 14.5: never blind sed on this file).
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const file = join(process.cwd(), 'lib', 'index.js')
let src = readFileSync(file, 'utf8')
const before = src

function replaceOnce(needle, replacement, label) {
  const at = src.indexOf(needle)
  if (at === -1) throw new Error('anchor missing: ' + label)
  if (src.indexOf(needle, at + 1) !== -1) throw new Error('anchor not unique: ' + label)
  src = src.slice(0, at) + replacement + src.slice(at + needle.length)
  console.log('patched: ' + label)
}

// --- state: remember we are inside a turn ---------------------------------
replaceOnce(
  `  // happy：一轮顺利收工后的一小段庆祝，然后自然回落。
  happyUntil: 0,
}`,
  `  // happy：一轮顺利收工后的一小段庆祝，然后自然回落。
  happyUntil: 0,
  // 当前是否在一轮里（turn/start .. turn/end）。没有它，"刚动了个工具但会话
  // 还没结束"会掉回 idle —— 六档测试抓到的（2026-11-06）。
  turnActive: false,
}`,
  'activity.turnActive',
)

// --- mood rules ------------------------------------------------------------
replaceOnce(
  `  if (activity.happyUntil && now < activity.happyUntil) return 'happy'
  if (activity.thinkingSince && now - activity.thinkingSince < 90000) return 'think'
  if (activity.running.size > 0) return 'work'`,
  `  if (activity.happyUntil && now < activity.happyUntil) return 'happy'
  if (activity.thinkingSince && now - activity.thinkingSince < 90000) return 'think'
  // 一轮还没结束但已经动过手：work。running 是宿主状态，turnActive 是事件状态，
  // 两者任一说"忙"就该是 work。
  if (activity.turnActive) return 'work'
  if (activity.running.size > 0) return 'work'`,
  'petMood turnActive -> work',
)

// --- hook: track the turn and clear stale errors ---------------------------
replaceOnce(
  `    if (kind === 'start') {
      activity.thinkingSince = Date.now()
      activity.happyUntil = 0
      noteActivity('start')
    } else if (kind === 'tool') {
      activity.thinkingSince = 0
      noteActivity('work')
    } else if (kind === 'done') {
      activity.thinkingSince = 0
      activity.happyUntil = Date.now() + 6000
      noteActivity('stop')
    } else if (kind === 'error') {
      activity.thinkingSince = 0
      noteActivity('error')
    } else if (kind === 'stop') {
      activity.thinkingSince = 0
      noteActivity('stop')
    }`,
  `    if (kind === 'start') {
      activity.turnActive = true
      activity.thinkingSince = Date.now()
      activity.happyUntil = 0
      // 新一轮开始 = 上一轮的报错翻篇，否则一次失败会让后面几轮都挂"难过"脸。
      activity.lastErrorAt = 0
      noteActivity('start')
    } else if (kind === 'tool') {
      activity.thinkingSince = 0
      noteActivity('work')
    } else if (kind === 'done') {
      activity.turnActive = false
      activity.thinkingSince = 0
      activity.happyUntil = Date.now() + 6000
      noteActivity('stop')
    } else if (kind === 'error') {
      activity.turnActive = false
      activity.thinkingSince = 0
      noteActivity('error')
    } else if (kind === 'stop') {
      activity.turnActive = false
      activity.thinkingSince = 0
      noteActivity('stop')
    }`,
  'moodNotify turn tracking',
)

if (src === before) throw new Error('nothing changed')
writeFileSync(file, src, 'utf8')
console.log('done')
