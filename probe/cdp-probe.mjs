/**
 * probe/cdp-probe.mjs —— 用 CDP 直接问 Edge 面板窗：页面到底渲染了什么
 *
 * 用法：node probe/cdp-probe.mjs <debugPort> [urlFilter]
 * 输出：每个 page target 的 url / title / body.innerText 片段 / body 背景色
 */
const port = process.argv[2] || '9333'
const filter = process.argv[3] || ''

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${port}/json`)
  return await res.json()
}

function evalIn(ws, expr, id) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('eval timeout')), 5000)
    const onMsg = (ev) => {
      let msg
      try { msg = JSON.parse(ev.data) } catch { return }
      if (msg.id !== id) return
      clearTimeout(timer)
      ws.removeEventListener('message', onMsg)
      if (msg.error) return reject(new Error(JSON.stringify(msg.error)))
      resolve(msg.result && msg.result.result ? msg.result.result.value : undefined)
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: false } }))
  })
}

const targets = await listTargets()
const pages = targets.filter((t) => t.type === 'page' && (!filter || String(t.url).includes(filter)))
console.log(`targets: ${targets.length}, pages matching: ${pages.length}`)

let id = 1
for (const t of pages) {
  console.log('--- target:', t.url)
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  try {
    console.log('  title   :', await evalIn(ws, 'document.title', id++))
    console.log('  ready   :', await evalIn(ws, 'document.readyState', id++))
    console.log('  bodyBg  :', await evalIn(ws, 'getComputedStyle(document.body).backgroundColor', id++))
    console.log('  appClass:', await evalIn(ws, 'document.getElementById("app") ? document.getElementById("app").className : "(no #app)"', id++))
    console.log('  text    :', JSON.stringify(await evalIn(ws, 'document.body.innerText.slice(0, 200)', id++)))
    console.log('  cssHrefs:', JSON.stringify(await evalIn(ws, 'Array.from(document.styleSheets).map(s => s.href)', id++)))
    console.log('  jsError :', JSON.stringify(await evalIn(ws, 'window.__dshPanelError || null', id++)))
  } finally {
    ws.close()
  }
}