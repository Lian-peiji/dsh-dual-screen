/* 副屏管家 · 面板逻辑（P2）
 *
 * 分工：窗口几何归服务端（页面改不了自己的窗口大小）；这里只管内容与交互。
 *   - 每 2s 拉一次 /dsh-dual-screen/panel.json：在线状态、屏信息、事件、待答
 *   - 折叠/展开：POST /panel/form，由服务端改窗口尺寸
 *   - 关闭：POST /toggle（= 关面板，投送继续）
 *   - 断线：显示「与 DSH 失联…重连中」而不是白屏（PLAN §7.5 #9）
 */
(() => {
  const BASE = '/dsh-dual-screen';
  const $ = (id) => document.getElementById(id);
  const app = $('app'), badge = $('badge'), subtitle = $('subtitle'), dot = $('dot');
  const statusEl = $('status'), timelineEl = $('timeline'), asksEl = $('asks');
  let connected = false;
  let lastEvents = [];
  let form = 'expanded';

  async function api(path, opts) {
    const res = await fetch(BASE + path, Object.assign({ cache: 'no-store' }, opts || {}));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function setConnected(on) {
    connected = on;
    dot.className = 'dot ' + (on ? 'on' : 'off');
    if (!on) subtitle.textContent = '与 DSH 失联…重连中';
  }

  function renderState(s) {
    // 状态类只用我们自己定义的 is-collapsed / is-expanded。
    // 绝不能直接把 config 里的 'bubble' 当容器 class 用：.bubble 是那个 56px 头像按钮的
    // 样式（display:none），套到容器上会把整个面板藏掉 —— 2026-11-05 实测白屏。
    form = s.form === 'collapsed' ? 'collapsed' : 'expanded';
    app.className = 'app ' + (form === 'collapsed' ? 'is-collapsed' : 'is-expanded');
    const pend = Number(s.pendingAsks || 0);
    if (pend > 0) { badge.textContent = pend > 9 ? '9+' : String(pend); badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');

    const d = s.display;
    if (d && d.secondary) {
      const sec = d.secondary;
      statusEl.textContent = `主屏 ${d.primary ? d.primary.w + '×' + d.primary.h : '?'} · 副屏 ${sec.portrait ? '竖屏 ' : ''}${sec.w}×${sec.h} @${Math.round((sec.scale || 1) * 100)}%`;
      subtitle.textContent = s.bridge && s.bridge.status === 'running' ? '投送中 · 面板已开' : '面板已开 · 投送未运行';
    } else {
      statusEl.textContent = '只检测到一块屏 · 静默待命';
      subtitle.textContent = '单屏待机';
    }
  }

  function renderTimeline(events) {
    if (!events || events.length === 0) {
      timelineEl.innerHTML = '<li class="tl-empty">还没有事件</li>';
      return;
    }
    // 只取最近 20 条，新的在上
    const list = events.slice(-20).reverse();
    timelineEl.innerHTML = list.map((e) => {
      const t = new Date(e.ts || Date.now());
      const hh = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
      let kind = 'k-end', text = '';
      if (e.type === 'moved') { kind = 'k-moved'; text = `窗口已投到副屏 · ${e.proc || ''}`; }
      else if (e.type === 'move-failed') { kind = 'k-error'; text = `投送失败 · ${e.reason || ''}`; }
      else if (e.type === 'skip') { kind = ''; text = `${e.reason || '跳过'} · ${e.proc || ''}`; }
      else if (e.type === 'turn.end') { kind = 'k-end'; text = `任务完成 · ${e.title || ''}`; }
      else if (e.type === 'tool.error') { kind = 'k-error'; text = `工具报错 · ${e.title || ''}`; }
      else if (e.type === 'ask.pending') { kind = 'k-ask'; text = '有新的问题待回答'; }
      else { text = e.type || ''; }
      const esc = String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      return `<li><span class="tl-time">${hh}</span><span class="tl-kind ${kind}">·</span><span class="tl-text">${esc}</span></li>`;
    }).join('');
  }

  function renderAsks(asks) {
    if (!asks || asks.length === 0) {
      asksEl.innerHTML = '<div class="empty"><div class="whale">🐋</div><div class="empty-text">主屏安静，这里待命</div></div>';
      return;
    }
    asksEl.innerHTML = asks.map((a) => {
      const opts = (a.options || []).map((o, i) =>
        `<button class="opt${i === 0 ? ' primary' : ''}" data-call="${encodeURIComponent(a.callId || '')}" data-choice="${encodeURIComponent(String(o))}">${String(o).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</button>`).join('');
      return `<div class="ask-card"><div class="ask-q">${String(a.question || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</div><div class="ask-opts">${opts}</div></div>`;
    }).join('');
  }

  async function tick() {
    try {
      const s = await api('/panel.json');
      setConnected(true);
      renderState(s);
      renderAsks(s.asks || []);
      const ev = (s.events || []).filter((e) => e.type !== 'hello');
      if (JSON.stringify(ev) !== JSON.stringify(lastEvents)) { lastEvents = ev; renderTimeline(ev); }
    } catch (err) {
      setConnected(false);
    }
  }

  $('bubble').addEventListener('click', async () => {
    await api('/panel/form', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ form: 'expanded' }) });
    tick();
  });
  $('btn-collapse').addEventListener('click', async () => {
    await api('/panel/form', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ form: 'collapsed' }) });
    tick();
  });
  $('btn-close').addEventListener('click', async () => {
    await api('/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'close' }) });
  });
  document.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    // P4 才接真实动作；现在只做视觉反馈，不假装成功
    b.textContent = 'P4 接入';
    setTimeout(() => { b.textContent = { continue: '继续', stop: '停止', settings: '设置' }[b.dataset.action]; }, 1200);
  }));
  asksEl.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.opt');
    if (!btn) return;
    // P4 才接回填；现在明确提示，不假装答完了
    btn.textContent = 'P4 接入';
  });

  tick();
  setInterval(tick, 2000);
})();