// patch-p3-mood.mjs -- route mood updates through the module-level hook.
//
// Why a patch script: onSessionEvent lives at module top level while `activity`
// and `noteActivity` are locals inside apply(). Referencing them directly throws
// ReferenceError, which the handler's own catch swallows -- the symptom is
// "events silently do nothing". Anchor-asserted edits, per PLAN 14.5 rules.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const file = join(process.cwd(), 'lib', 'index.js')
let src = readFileSync(file, 'utf8')
const before = src

function replaceOnce(needle, replacement, label) {
  const at = src.indexOf(needle)
  if (at === -1) throw new Error('anchor missing: ' + label)
  const second = src.indexOf(needle, at + 1)
  if (second !== -1) throw new Error('anchor not unique: ' + label)
  src = src.slice(0, at) + replacement + src.slice(at + needle.length)
  console.log('patched: ' + label)
}

replaceOnce(
  `        // 新一轮刚开始 = 在"想"（还没动手）。90 秒兜底防止卡在这一档。
        activity.thinkingSince = Date.now()
        activity.happyUntil = 0
        noteActivity('start')
        return`,
  `        // 新一轮刚开始 = 在"想"（还没动手）。90 秒兜底防止卡在这一档。
        notifyMood('start')
        return`,
  'turn/start mood hook',
)

replaceOnce(
  `      case 'tool/call':
        // 一动工具就不再是"纯思考"，交给 work。
        activity.thinkingSince = 0
        return`,
  `      case 'tool/call':
        // 一动工具就不再是"纯思考"，交给 work。
        notifyMood('tool')
        return`,
  'tool/call mood hook',
)

replaceOnce(
  `        turnStartedAt.delete(key)
        activity.thinkingSince = 0
        const tookMs`,
  `        turnStartedAt.delete(key)
        const tookMs`,
  'turn/end clears thinking',
)

replaceOnce(
  `        if (kind === 'completed') {
          // 顺利收工 → 庆祝 6 秒（happy 池），然后自然落回 idle。
          activity.happyUntil = Date.now() + 6000
          noteActivity('stop')
          evtPush('turn-done', shortId(sid) + ' 这轮完成' + took, '')
        } else if (kind === 'error') {
          const msg = (r.error && (r.error.message || r.error.code)) || 'error'
          noteActivity('error')
          evtPush('turn-error', shortId(sid) + ' 这轮出错' + took, String(msg).slice(0, 80))
        } else if (kind === 'aborted') {
          noteActivity('stop')
          evtPush('turn-aborted', shortId(sid) + ' 这轮被停' + took, '')
        } else if (kind === 'max-tokens') {
          noteActivity('error')
          evtPush('turn-error', shortId(sid) + ' 撞了上下文上限', 'max-tokens')
        } else {
          noteActivity('stop')
          evtPush('turn-end', shortId(sid) + ' 这轮结束', kind)
        }`,
  `        if (kind === 'completed') {
          // 顺利收工 → 庆祝 6 秒（happy 池），然后自然落回 idle。
          notifyMood('done')
          evtPush('turn-done', shortId(sid) + ' 这轮完成' + took, '')
        } else if (kind === 'error') {
          const msg = (r.error && (r.error.message || r.error.code)) || 'error'
          notifyMood('error')
          evtPush('turn-error', shortId(sid) + ' 这轮出错' + took, String(msg).slice(0, 80))
        } else if (kind === 'aborted') {
          notifyMood('stop')
          evtPush('turn-aborted', shortId(sid) + ' 这轮被停' + took, '')
        } else if (kind === 'max-tokens') {
          notifyMood('error')
          evtPush('turn-error', shortId(sid) + ' 撞了上下文上限', 'max-tokens')
        } else {
          notifyMood('stop')
          evtPush('turn-end', shortId(sid) + ' 这轮结束', kind)
        }`,
  'turn/end mood hooks',
)

// Restore the temporary debug logging back to a silent catch.
src = src.split('  } catch (e) { console.log("onSessionEvent FAILED: " + (e && e.message)) }')
  .join('  } catch { }')

if (src === before) throw new Error('nothing changed')
writeFileSync(file, src, 'utf8')
console.log('done')
