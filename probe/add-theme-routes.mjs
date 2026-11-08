// add-theme-routes.mjs -- serve the pet theme folders over HTTP.
//
// Why HTTP and not file://: the player fetches theme.json, and Chromium refuses
// cross-origin fetches from file:// URLs (opaque origin). Serving the page and the
// clips from the plugin's own origin also means the page can poll pet.json for mood.
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/lib/index.js'
let s = readFileSync(p, 'utf8')

const anchor = "  route('/dsh-dual-screen/panel', async (_req, res) => {"
if (!s.includes(anchor)) throw new Error('panel route anchor missing')

const block = String.raw`  // ---- 桌宠主题（V2 可插拔）----
  // A theme is a folder under panel/pets/<id>/ with theme.json + clips. Discovery
  // is by directory listing, so adding a character later needs no code change.
  const PETS_DIR = join(PANEL_DIR, 'pets')

  function listPetThemes() {
    const out = []
    try {
      for (const e of readdirSync(PETS_DIR, { withFileTypes: true })) {
        if (!e.isDirectory()) continue
        const dir = join(PETS_DIR, e.name)
        let meta = null
        try { meta = JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf8')) } catch { meta = null }
        if (!meta) continue      // 没有 theme.json 的目录不是主题，跳过而不是报错
        out.push({
          id: e.name,
          name: meta.name || e.name,
          description: meta.description || '',
          clips: Object.keys(meta.clips || {}).length,
        })
      }
    } catch { /* 没有 pets 目录也不能让插件崩 */ }
    return out
  }

  route('/dsh-dual-screen/pets.json', async (_req, res) => {
    const themes = listPetThemes()
    const picked = (loadConfig().pet && loadConfig().pet.theme) || (themes[0] && themes[0].id) || ''
    json(res, { ok: true, themes, current: picked })
  })

  // 桌宠页面本体
  route('/dsh-dual-screen/pet-page', async (_req, res) => {
    if (!serveFile(res, 'pet.html', 'text/html; charset=utf-8')) { res.writeHead(404); res.end('pet page not found') }
  })

  // 主题素材：/dsh-dual-screen/pets/<id>/<relative...>
  // Path traversal is rejected by resolving and checking the prefix -- a theme is
  // data from disk, but the URL is not trusted.
  route('/dsh-dual-screen/pets/', async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const rest = decodeURIComponent(url.pathname.replace(/^\/dsh-dual-screen\/pets\//, ''))
      const full = resolve(PETS_DIR, rest)
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

` + anchor

s = s.replace(anchor, block)

// make sure the needed fs/path helpers are imported
const importAnchor = "const PANEL_DIR = join(dirname(HERE), 'panel')"
if (!s.includes(importAnchor)) throw new Error('PANEL_DIR anchor missing')
const need = ['readdirSync', 'resolve']
const importLine = s.match(/import \{([^}]*)\} from 'node:fs'/)
if (importLine) {
  const have = importLine[1].split(',').map((x) => x.trim()).filter(Boolean)
  if (!have.includes('readdirSync')) have.push('readdirSync')
  s = s.replace(importLine[0], "import { " + have.join(', ') + " } from 'node:fs'")
}
const pathImport = s.match(/import \{([^}]*)\} from 'node:path'/)
if (pathImport) {
  const have = pathImport[1].split(',').map((x) => x.trim()).filter(Boolean)
  if (!have.includes('resolve')) have.push('resolve')
  s = s.replace(pathImport[0], "import { " + have.join(', ') + " } from 'node:path'")
}

writeFileSync(p, s, 'utf8')
console.log('theme routes added; readdirSync:', s.includes('readdirSync'), 'resolve:', /import \{[^}]*resolve[^}]*\} from 'node:path'/.test(s))