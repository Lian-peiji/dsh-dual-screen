import { createPanelController } from '../lib/panel.js'
const c = createPanelController({ log: (l) => console.log('[log]', l) })
const t0 = Date.now()
const opened = await c.open({ x: 3536, y: -564, w: 600, h: 1350 }, { panel: { topmost: true } }, 1.5)
console.log('open took', Date.now() - t0, 'ms ->', JSON.stringify({ status: opened.status, hwnd: opened.hwnd, rect: opened.rect, err: opened.lastError }))
await new Promise((r) => setTimeout(r, 800))
await c.close()
await new Promise((r) => setTimeout(r, 1500))
console.log('after close:', c.status().status, 'running:', c.status().running)
