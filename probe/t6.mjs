import { createPanelController } from 'file:///J:/%E5%A4%A7%E8%82%A5%E9%B1%BC%E6%B8%B8%E4%B9%90%E5%9C%BA/dsh-dual-screen/lib/panel.js'

const logs = []
const c = createPanelController({ log: (l) => { logs.push(l); console.log('[log]', l) } })

const rect = { x: 3536, y: -564, w: 600, h: 1350 }
const t0 = Date.now()
const st = await c.open(rect, { panel: { topmost: true } }, 1.5)
console.log('open took', Date.now() - t0, 'ms ->', JSON.stringify({ status: st.status, hwnd: st.hwnd, rect: st.rect, err: st.lastError }))

const moved = await c.resize({ x: 3536, y: -564, w: 480, h: 1000 }, 'collapsed')
console.log('resize ->', JSON.stringify(moved))

const closed = await c.close()
await new Promise((r) => setTimeout(r, 2000))
console.log('close ->', JSON.stringify(closed), 'status now:', c.status().status, 'running:', c.status().running)