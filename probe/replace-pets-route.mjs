// replace-pets-route.mjs -- serve theme assets through ONE exact route with a query
// parameter instead of a prefix route.
//
// Why: the prefix route registered without error but never matched (404 for every
// path under /dsh-dual-screen/pets/). Rather than fight the matching semantics, the
// asset handler becomes an exact endpoint: /dsh-dual-screen/pet-asset?f=<relpath>.
// Path traversal is still rejected by a resolve+prefix check.
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/lib/index.js'
let s = readFileSync(p, 'utf8')

const start = s.indexOf("  // 主题素材：/dsh-dual-screen/pets/<id>/<relative...>")
const endMark = "  }, 'prefix')"
const end = s.indexOf(endMark)
if (start < 0 || end < 0) throw new Error('pets route block not found')

const block = String.raw`  // 主题素材：/dsh-dual-screen/pet-asset?f=<主题id>/<相对路径>
  // 单条 exact 路由 + 查询参数。**不要改成 prefix 路由**：实测（2026-11-06）
  // kind='prefix' 注册不报错、但任何子路径都 404，白折腾一轮。
  route('/dsh-dual-screen/pet-asset', async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const rel = decodeURIComponent(url.searchParams.get('f') || '')
      if (!rel) { res.writeHead(400); res.end('missing f'); return }
      const full = resolve(PETS_DIR, rel)
      const root = resolve(PETS_DIR)
      if (!full.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return }
      const ext = full.slice(full.lastIndexOf('.')).toLowerCase()
      const mime = {
        '.json': 'application/json; charset=utf-8',
        '.webm': 'video/webm',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
      }[ext] || 'application/octet-stream'
      const buf = readFileSync(full)
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' })
      res.end(buf)
    } catch {
      res.writeHead(404); res.end('not found')
    }
  })
`

s = s.slice(0, start) + block + s.slice(end + endMark.length)
writeFileSync(p, s, 'utf8')
console.log('pets route replaced with exact + query')