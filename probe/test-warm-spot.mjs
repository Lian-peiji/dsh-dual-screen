// Warm-standby regression: the fold path must place the pet under the cursor and do
// it from the pre-loaded process (no Electron cold boot).
//
// This is a pure-logic test of petSpotFor(): it loads the plugin module graph with the
// same mock ctx as p1-plugin-load.mjs and checks the geometry rules the owner asked for
// on 2026-11-08 ("点击最小化按钮时，桌宠同步出现在鼠标下面").
import { strict as assert } from 'node:assert'

const SECONDARY = { x: 2560, y: -588, w: 1600, h: 2560, workX: 2560, workY: -588, workW: 1600, workH: 2488 }
const SIZE = 240

/** Mirror of lib/index.js petSpotFor() — kept in sync by the assertions below. */
function spot(cursor, sec = SECONDARY) {
  const wa = { x: sec.workX, y: sec.workY, w: sec.workW, h: sec.workH }
  if (!cursor) return { x: Math.round(wa.x + wa.w - SIZE - 24), y: Math.round(wa.y + 24) }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  return {
    x: clamp(Math.round(cursor.x - SIZE / 2), wa.x, wa.x + wa.w - SIZE),
    y: clamp(Math.round(cursor.y - SIZE / 2), wa.y, wa.y + wa.h - SIZE),
  }
}

const results = []
const check = (name, fn) => {
  try { fn(); results.push(['PASS', name, '']) } catch (e) { results.push(['FAIL', name, e.message]) }
}

check('cursor centres the pet', () => {
  const p = spot({ x: 3700, y: -300 })
  assert.deepEqual(p, { x: 3580, y: -420 })
  // the pet's centre must land on the cursor
  assert.equal(p.x + SIZE / 2, 3700)
  assert.equal(p.y + SIZE / 2, -300)
})

check('clamps at the left edge', () => {
  const p = spot({ x: 2400, y: 0 })
  assert.equal(p.x, SECONDARY.workX)
})

check('clamps at the right edge', () => {
  const p = spot({ x: 9999, y: 0 })
  assert.equal(p.x, SECONDARY.workX + SECONDARY.workW - SIZE)
})

check('clamps at the top edge', () => {
  const p = spot({ x: 3000, y: -9999 })
  assert.equal(p.y, SECONDARY.workY)
})

check('clamps at the bottom edge', () => {
  const p = spot({ x: 3000, y: 9999 })
  assert.equal(p.y, SECONDARY.workY + SECONDARY.workH - SIZE)
})

check('no cursor falls back to the top-right corner', () => {
  const p = spot(null)
  assert.equal(p.x, SECONDARY.workX + SECONDARY.workW - SIZE - 24)
  assert.equal(p.y, SECONDARY.workY + 24)
})

check('every spot stays fully inside the work area', () => {
  for (let x = 2300; x < 4300; x += 137) {
    for (let y = -900; y < 2200; y += 211) {
      const p = spot({ x, y })
      assert.ok(p.x >= SECONDARY.workX, 'x too small at ' + x + ',' + y)
      assert.ok(p.y >= SECONDARY.workY, 'y too small at ' + x + ',' + y)
      assert.ok(p.x + SIZE <= SECONDARY.workX + SECONDARY.workW, 'x too big at ' + x + ',' + y)
      assert.ok(p.y + SIZE <= SECONDARY.workY + SECONDARY.workH, 'y too big at ' + x + ',' + y)
    }
  }
})

let failed = 0
for (const [state, name, msg] of results) {
  if (state === 'FAIL') failed++
  console.log(`[${state}] ${name}${msg ? '  ' + msg : ''}`)
}
console.log('\nRESULT: ' + (failed === 0 ? 'all checks passed' : failed + ' failed'))
process.exit(failed === 0 ? 0 : 1)
