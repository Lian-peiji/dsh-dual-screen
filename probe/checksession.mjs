// checksession.mjs -- verify a DSH session file decompresses cleanly.
//
// Why: the owner reports "改目录存在同名文件夹，请稍后再试" on every send. Before
// touching anything we need to know whether the session log itself is readable and
// whether a half-written zstd frame (the classic cause of that rename error) exists.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ZstdDecompress } from 'node:zlib'

const root = String.raw`E:\dsh\sessions\--J-~5927~80A5~9C7C~6E38~4E50~573A--`
const ids = [
  'session-cd3f42bb-53ff-4db8-b788-e51fbc02ac8b',
  'session-ef13119b-2343-4ce1-848b-54aee026798e',
]

for (const id of ids) {
  const f = join(root, id, 'session.v4.jsonl.zstd')
  try {
    const buf = readFileSync(f)
    const d = new ZstdDecompress()
    let total = 0
    let lines = 0
    let tail = ''
    d.on('data', (c) => {
      total += c.length
      const s = c.toString('utf8')
      lines += (s.match(/\n/g) || []).length
      tail = (tail + s).slice(-200)
    })
    const done = new Promise((res, rej) => { d.on('end', res); d.on('error', rej) })
    d.end(buf)
    await done
    console.log(id.slice(0, 16) + ' OK compressed=' + buf.length + ' raw=' + total + ' newlineCount=' + lines)
    console.log('   tail: ' + tail.replace(/\s+/g, ' ').slice(-120))
  } catch (e) {
    console.log(id.slice(0, 16) + ' FAIL: ' + (e && e.message))
  }
}
