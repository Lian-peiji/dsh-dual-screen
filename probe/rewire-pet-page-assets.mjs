// rewire-pet-page-assets.mjs -- point the page at the exact asset endpoint.
//
// The page used to resolve clips relative to itself (../pets/<id>/webm/x.webm),
// which required a prefix route. Prefix routes did not match (404), so assets now
// come from /dsh-dual-screen/pet-asset?f=<id>/webm/<name>.webm.
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/panel/pet.html'
let s = readFileSync(p, 'utf8')

const anchor = `function clipUrl(base, name) {
  return base + '/' + encodeURIComponent(name) + '.webm';
}`
if (!s.includes(anchor)) throw new Error('clipUrl anchor missing')

s = s.replace(anchor, `/* Assets come from ONE exact endpoint with a query parameter.
   A prefix route would be tidier but did not match in this host (404 on every
   subpath, measured 2026-11-06), so the path travels in ?f= instead. */
function assetUrl(rel) {
  return API_BASE + '/dsh-dual-screen/pet-asset?f=' + encodeURIComponent(rel);
}
function clipUrl(clipDir, name) {
  return assetUrl(clipDir + '/' + name + '.webm');
}`)

// Theme base becomes a plain relative dir (no leading ../), resolved via assetUrl.
const oldBase = `  const themeDir = '../pets/' + encodeURIComponent(THEME_ID);
  theme = { id: THEME_ID, clips: {}, random: [], timing: {}, baseUrl: themeDir + '/webm' };`
if (!s.includes(oldBase)) throw new Error('themeDir anchor missing')
s = s.replace(oldBase, `  const themeRel = THEME_ID;                       // relative to panel/pets/
  theme = { id: THEME_ID, clips: {}, random: [], timing: {}, clipDir: themeRel + '/webm' };`)

// fetch(theme.json) via the asset endpoint
const oldFetch = `    const r = await fetch(themeDir + '/theme.json', { cache: 'no-store' });`
if (!s.includes(oldFetch)) throw new Error('theme fetch anchor missing')
s = s.replace(oldFetch, `    const r = await fetch(assetUrl(themeRel + '/theme.json'), { cache: 'no-store' });`)

const oldAssign = `      theme = Object.assign(theme, m);
      // A theme may relocate its clips; default is <theme>/webm.
      theme.baseUrl = themeDir + '/' + (m.clipDir || 'webm');
      if (m.poster) theme.posterUrl = themeDir + '/' + m.poster;
      else theme.posterUrl = themeDir + '/poster.png';`
if (!s.includes(oldAssign)) throw new Error('theme assign anchor missing')
s = s.replace(oldAssign, `      theme = Object.assign(theme, m);
      // A theme may relocate its clips; default is <theme>/webm.
      theme.clipDir = themeRel + '/' + (m.clipDir || 'webm');
      theme.posterUrl = assetUrl(themeRel + '/' + (m.poster || 'poster.png'));`)

// play() used theme.baseUrl; it now passes theme.clipDir
const oldPlay = `  back.src = clipUrl(theme.baseUrl, name);`
if (!s.includes(oldPlay)) throw new Error('play clipUrl anchor missing')
s = s.replace(oldPlay, `  back.src = clipUrl(theme.clipDir, name);`)

writeFileSync(p, s, 'utf8')
console.log('page rewired:', s.includes('pet-asset?f='), !s.includes('theme.baseUrl'))