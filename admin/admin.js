/* Touchpoints Admin (head office) — Phase 4B: Dashboard + Approvals (DEPT inbox)
   Sign in with Google: only sales.mis.team@gmail.com (ADMIN) and cig.channeldev@gmail.com (DEPT · CHANNEL DEV DIST),
   or the accounts in Script Property ADMIN_ACCOUNTS. Both see everything.
   Same backend as the sales app (API_URL in ../config.js). */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const $ = s => document.querySelector(s);
  const view = $('#view');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  let session = store.get('adminSession');   // { portalToken, user:{name, role} }
  let tab = 'dashboard', dash = null, open = { NEW: '', AMEND: '' }, timer = null;
  let apprItems = [], apprFilter = 'ALL', apprLoaded = false;

  function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast._t); toast._t = setTimeout(() => { t.style.display = 'none'; }, ms || 3500); }
  async function api(action, data, timeout) {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), timeout || 60000);
    let res;
    try {
      res = await fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action }, data)), signal: ctl.signal });
    } catch (e) { throw new Error(navigator.onLine ? 'Could not reach the server. Please try again.' : 'No internet connection.'); }
    finally { clearTimeout(to); }
    const j = await res.json();
    if (!j.ok) { if (j.code === 'AUTH' && action !== 'adminGoogleLogin') { logout(true); } throw new Error(j.error || 'Something went wrong.'); }
    return j;
  }
  const net = () => { const n = $('#net'); n.textContent = navigator.onLine ? '● Online' : '● Offline'; n.className = 'net' + (navigator.onLine ? '' : ' off'); };
  addEventListener('online', net); addEventListener('offline', net); net();
  const when = iso => iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const days = n => n == null ? '—' : n === 0 ? 'today' : n === 1 ? '1 day' : n + ' days';
  const fmtN = n => Number(n || 0).toLocaleString();

  /* ---------- Sign in with Google (only the allowed head-office accounts) ---------- */
  let gisReady = null;
  function loadGis() {
    if (gisReady) return gisReady;
    gisReady = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = res; s.onerror = () => rej(new Error('Could not load Google sign-in. Check your internet.'));
      document.head.appendChild(s);
    });
    return gisReady;
  }
  async function renderLogin(msg) {
    $('#tabs').hidden = true; $('#logoutBtn').hidden = true; $('#who').textContent = '';
    view.innerHTML = `<div class="card" style="max-width:460px;margin:40px auto;text-align:center">
      <h2>Touchpoints Admin</h2>
      <p class="hint" style="margin-top:0">For Sales MIS and Channel Dev only. Sign in with the Google account you use for work.</p>
      ${msg ? `<div class="notice bad" style="text-align:left">${esc(msg)}</div>` : ''}
      <div id="gbtn" style="display:flex;justify-content:center;margin:18px 0 6px"><span class="hint"><span class="spinner"></span>Loading Google sign-in…</span></div>
      <p class="hint">Next time it signs you in automatically on this browser.</p></div>`;
    let clientId;
    try { clientId = (await api('adminConfig', {})).clientId; await loadGis(); }
    catch (e) { $('#gbtn').innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    if (!clientId) { $('#gbtn').innerHTML = '<div class="notice warn" style="text-align:left">Google sign-in is not set up yet. Ask the admin to add GOOGLE_CLIENT_ID in the script\'s Script Properties.</div>'; return; }
    google.accounts.id.initialize({ client_id: clientId, callback: onGoogle, auto_select: !msg, cancel_on_tap_outside: false, use_fedcm_for_prompt: true });
    $('#gbtn').innerHTML = '';
    google.accounts.id.renderButton($('#gbtn'), { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', width: 280 });
    if (!msg) google.accounts.id.prompt();   // One Tap: signs in automatically if this browser already used an allowed account
  }
  async function onGoogle(resp) {
    $('#gbtn').innerHTML = '<span class="hint"><span class="spinner"></span>Checking your account…</span>';
    try {
      const r = await api('adminGoogleLogin', { credential: resp.credential });
      session = { portalToken: r.token, user: r.user }; store.set('adminSession', session); start();
    } catch (e) {
      try { google.accounts.id.disableAutoSelect(); } catch (x) {}
      renderLogin(e.message);
    }
  }
  function logout(silent) {
    session = null; store.del('adminSession'); clearInterval(timer); dash = null; apprItems = []; apprLoaded = false; DBC = {};
    try { if (window.google && google.accounts) google.accounts.id.disableAutoSelect(); } catch (e) {}
    renderLogin(silent ? '' : 'You have signed out.');
  }
  $('#logoutBtn').onclick = () => { if (confirm('Sign out?')) logout(); };

  /* ---------- tabs ---------- */
  document.querySelectorAll('#tabs [data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; show(); });
  function show() {
    document.querySelectorAll('#tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    // already loaded → show instantly; fresh data comes from ↻ Refresh, the 5-minute timer, or after a decision
    if (tab === 'dashboard') { if (dash) drawDashboard(); else renderDashboard(); }
    else if (tab === 'databases') renderDatabases();
    else { if (apprLoaded) drawApprovals(); else renderApprovals(); }
  }
  function start() {
    $('#tabs').hidden = false; $('#logoutBtn').hidden = false;
    $('#who').textContent = (session.user.email || session.user.name) + ' · ' + session.user.role;
    show(); countApprovals();
    clearInterval(timer);
    timer = setInterval(() => { if (document.visibilityState !== 'visible') return; countApprovals(); if (tab === 'dashboard' && !$('.detail')) renderDashboard(true); else dash = null; }, 300000);   // every 5 minutes
  }

  /* ---------- DASHBOARD ---------- */
  async function renderDashboard(quiet) {
    if (!quiet || !dash) view.innerHTML = `<p class="hint"><span class="spinner"></span>Loading dashboard…</p>`;
    try { dash = await api('adminDashboard', { token: session.portalToken }, 90000); }
    catch (e) { if (tab === 'dashboard') view.innerHTML = `<div class="notice bad">${esc(e.message)}</div><button class="btn dark" id="retry" style="max-width:240px">Try again</button>`; const r = $('#retry'); if (r) r.onclick = () => renderDashboard(); return; }
    if (tab !== 'dashboard') return;
    drawDashboard();
  }
  function drawDashboard() {
    const d = dash, tp = d.touchpoints;
    const totA = Object.values(tp).reduce((a, x) => a + x.active, 0), totP = Object.values(tp).reduce((a, x) => a + x.purged, 0);
    view.innerHTML = `
      <div class="head"><h2>Dashboard</h2>
        <span class="asof">${d.scope === 'all' ? 'All regions' : 'Your area'} · as of ${esc(d.asOf)}</span>
        <button class="refresh" id="dashRefresh">↻ Refresh</button></div>
      <section class="block"><h3>Registered touchpoints</h3>
        <div class="stats">
          <div class="stat"><div class="lbl">All touchpoints · Active</div><div class="num">${fmtN(totA)}</div><div class="sub">${fmtN(totP)} purged</div></div>
          ${[['DTH', 'dth'], ['LOADING', 'loading'], ['OTT', 'ott']].map(([k, c]) => `<div class="stat ${c}"><div class="lbl">${esc(tp[k].label)} · Active</div>
            <div class="num">${fmtN(tp[k].active)}</div><div class="sub">${fmtN(tp[k].purged)} purged${tp[k].other ? ' · ' + fmtN(tp[k].other) + ' other status' : ''}</div></div>`).join('')}
        </div></section>
      ${reqBlock('NEW', '➕ New touchpoint requests')}
      ${reqBlock('AMEND', '✏️ Amendment requests')}`;
    $('#dashRefresh').onclick = () => renderDashboard();
    view.querySelectorAll('[data-where]').forEach(b => b.onclick = () => {
      const [kind, w] = b.dataset.where.split(':');
      open[kind] = open[kind] === w ? '' : w; drawDashboard();
      const ex = $('#ex-' + kind); if (ex) ex.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    view.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { tab = 'approvals'; document.querySelectorAll('#tabs [data-tab]').forEach(x => x.classList.toggle('on', x.dataset.tab === 'approvals')); openApproval(b.dataset.open); });
  }
  function reqBlock(kind, title) {
    const R = dash.requests[kind], P = R.periods;
    const cols = [['today', 'Today'], ['week', 'Last 7 days'], ['month', 'This month'], ['ytd', 'Year to date']];
    const rows = [['process', 'On Process'], ['approved', 'Approved'], ['declined', 'Declined'], ['cancelled', 'Cancelled']];
    const W = R.process;
    const where = [
      ['dept', 'With DEPT', 'Waiting for final approval'],
      ['prior', 'With prior level', kind === 'AMEND' ? 'RSM / RH / CH (amendments go to DEPT only)' : 'RSM / RH / CH'],
      ['returned', 'Returned to requestor', 'Waiting for the TSM to correct and resend']];
    const sel = open[kind];
    return `<section class="block"><h3>${title}</h3>
      <div class="scroll"><table class="data"><thead><tr><th>Status (by date requested)</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>
        ${rows.map(([k, l]) => `<tr><td><span class="dot ${k}"></span>${l}</td>${cols.map(c => `<td>${fmtN(P[c[0]][k])}</td>`).join('')}</tr>`).join('')}
        <tr class="total"><td>Total requested</td>${cols.map(c => `<td>${fmtN(P[c[0]].total)}</td>`).join('')}</tr>
      </tbody></table></div>
      <h3 style="margin:18px 0 0">On Process now</h3>
      <div class="where">${where.map(([w, l, s]) => `<button data-where="${kind}:${w}" class="${sel === w ? 'on' : ''}" ${W[w].length ? '' : 'disabled'}>
          <b>${fmtN(W[w].length)}</b><span>${l} ${W[w].length ? (sel === w ? '▴' : '▾') : ''}</span><small>${s}</small></button>`).join('')}</div>
      ${sel && W[sel].length ? `<div class="expand scroll" id="ex-${kind}"><table class="data"><thead><tr><th>Request</th><th>Partner · Requestor</th><th>Now with</th><th>Waiting</th><th></th></tr></thead><tbody>
        ${W[sel].map(i => `<tr><td><b>${esc(i.trade || i.salescode)}</b><small>${esc(i.id)} · ${esc(i.action)}</small><small>${esc(i.type)} · sent ${when(i.submitted)}</small></td>
          <td>${esc(i.partner)}<small>${esc(i.requestor)}</small></td><td>${esc(i.with)}</td>
          <td class="${i.waitingDays >= 3 ? 'late' : ''}">${days(i.waitingDays)}</td>
          <td>${i.mine ? `<button class="decide-link" data-open="${esc(i.id)}" style="border:0;cursor:pointer">Decide</button>`
               : i.link ? `<a class="decide-link" href="${esc(i.link)}" target="_blank" rel="noopener">Review &amp; Decide ↗</a>` : '<span class="muted">—</span>'}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
    </section>`;
  }

  /* ---------- APPROVALS (what is waiting for this login, e.g. DEPT) ---------- */
  async function countApprovals() {
    try { apprItems = (await api('portalInbox', { token: session.portalToken }, 45000)).items; apprLoaded = true;
      if (tab === 'approvals' && $('#apprRefresh')) drawApprovals();
      const c = $('#apprCount'); c.textContent = apprItems.length; c.hidden = !apprItems.length; } catch (e) {}
  }
  async function renderApprovals() {
    view.innerHTML = `<p class="hint"><span class="spinner"></span>Loading requests waiting for you…</p>`;
    try { apprItems = (await api('portalInbox', { token: session.portalToken }, 45000)).items; apprLoaded = true; }
    catch (e) { view.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    if (tab !== 'approvals') return;
    const c = $('#apprCount'); c.textContent = apprItems.length; c.hidden = !apprItems.length;
    drawApprovals();
  }
  function drawApprovals() {
    const n = k => apprItems.filter(i => k === 'ALL' || i.kind === k).length;
    const list = apprItems.filter(i => apprFilter === 'ALL' || i.kind === apprFilter);
    view.innerHTML = `<div class="bar"><h2>Waiting for ${esc(session.user.name)}</h2><button class="refresh" id="apprRefresh">↻ Refresh</button></div>
      <div class="chips">${[['ALL', 'All'], ['NEW', 'New touchpoints'], ['AMEND', 'Amendments']].map(([k, l]) =>
        `<button class="chip ${apprFilter === k ? 'on' : ''}" data-f="${k}">${l}<b class="${n(k) ? '' : 'zero'}">${n(k)}</b></button>`).join('')}</div>
      ${list.length ? `<div class="list">${list.map(i => `<button class="item ${i.kind === 'AMEND' ? 'amend' : ''}" data-id="${esc(i.id)}">
          <div class="t">${esc(i.trade || i.salescode)}</div>
          <div class="m">${esc(i.action)} · ${esc(i.type)}<br>${esc(i.partner)}${i.muni ? ' · ' + esc(i.muni) + ', ' + esc(i.prov) : ''}<br>From ${esc(i.requestor)} · ${esc(i.id)} · sent ${when(i.submitted)}</div>
          <div class="tags"><span class="tag ${i.waitingDays >= 3 ? 'late' : ''}">⏱ waiting ${days(i.waitingDays)}</span>
            <span class="tag ${i.finalStep ? 'final' : ''}">${i.finalStep ? 'Final approval' : 'Step ' + esc(i.step)}</span>
            ${i.resent ? '<span class="tag y">Corrected &amp; resent</span>' : ''}${i.transferredFrom ? `<span class="tag y">↪ from ${esc(i.transferredFrom)}</span>` : ''}</div></button>`).join('')}</div>`
        : `<div class="empty"><div class="big">✓</div><b>Nothing waiting for you.</b></div>`}`;
    view.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { apprFilter = b.dataset.f; drawApprovals(); });
    view.querySelectorAll('.item[data-id]').forEach(b => b.onclick = () => openApproval(b.dataset.id));
    $('#apprRefresh').onclick = () => renderApprovals();
  }
  async function openApproval(id) {
    view.innerHTML = `<p class="hint"><span class="spinner"></span>Opening ${esc(id)}…</p>`;
    let r;
    try { r = await api('portalRequest', { token: session.portalToken, id }, 60000); }
    catch (e) { toast(e.message, 4000); return renderApprovals(); }
    const rows = r.rows.map(x => `<tr><td>${esc(x.label)}</td><td class="${x.red ? 'red' : ''}">${x.html ? x.value : esc(x.value).replace(/\n/g, '<br>')}</td></tr>`).join('');
    view.innerHTML = `<div class="card detail">
      <div class="bar"><button class="refresh" id="apprBack">‹ Back</button><h2 style="font-size:16px">${esc(r.id)}</h2>
        ${r.waiting ? '<button class="btn mini dark" id="toDecide">Decide ↓</button>' : ''}</div>
      <h2>${esc(r.title)}</h2>
      <p class="hint" style="margin-top:0">${r.waiting ? (r.finalStep ? 'Final approval' : 'Approval step ' + esc(r.step)) + ' · ' + esc(r.approver) : 'Status: ' + esc(r.status) + ' (view only)'}</p>
      ${r.photo ? `<img class="photo" src="${r.photo}" alt="Store photo" id="apprPhoto">` : ''}
      ${r.lat ? `<p style="margin:4px 0 10px"><a href="https://www.google.com/maps?q=${esc(r.lat)},${esc(r.lng)}" target="_blank" rel="noopener">📍 Open location in Google Maps</a></p>` : ''}
      <table class="sum">${rows}</table>
      ${r.proofs.length ? `<h3>📎 Proof</h3><div class="proof">${r.proofs.map(p => p.src ? `<img src="${p.src}" alt="${esc(p.name)}" class="zoomable">`
          : `<button class="btn ghost" data-pdf="${p.i}" style="margin:6px 0;max-width:520px">📄 Open PDF: ${esc(p.name)}</button>`).join('')}</div>` : ''}
      <h3>History</h3>
      <ul class="hist">${r.history.map(h => `<li>${new Date(h.at).toLocaleString()} — ${esc(h.who)}: <b>${esc(h.what)}</b>${h.remarks ? ' — “' + esc(h.remarks) + '”' : ''}</li>`).join('')}</ul>
      ${r.waiting ? `<div class="decide">
        <label for="apprRemarks" style="margin-top:0">Remarks <span class="hint" style="display:inline">(required to Return or Reject)</span></label>
        <textarea id="apprRemarks" rows="3" placeholder="What should be corrected, or why it is rejected"></textarea>
        <div class="btns"><button class="btn approve" data-d="APPROVE">✓ Approve${r.finalStep ? ' (final)' : ''}</button>
          <button class="btn return" data-d="RETURN">↩ Return for correction</button><button class="btn reject" data-d="REJECT">✕ Reject</button></div></div>` : ''}</div>`;
    $('#apprBack').onclick = () => renderApprovals();
    const td = $('#toDecide'); if (td) td.onclick = () => $('.decide').scrollIntoView({ behavior: 'smooth' });
    view.querySelectorAll('#apprPhoto, .zoomable').forEach(img => img.onclick = () => { const z = document.createElement('div'); z.className = 'zoom'; z.innerHTML = `<img src="${img.src}" alt="">`; z.onclick = () => z.remove(); document.body.appendChild(z); });
    view.querySelectorAll('[data-pdf]').forEach(b => b.onclick = async () => {
      const w = window.open('', '_blank');
      try { const f = await api('portalFile', { token: session.portalToken, id: r.id, i: Number(b.dataset.pdf) }, 90000);
        const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(f.data), c => c.charCodeAt(0))], { type: f.type }));
        if (w) w.location.href = url; else location.href = url; }
      catch (e) { if (w) w.close(); toast(e.message, 4000); }
    });
    view.querySelectorAll('[data-d]').forEach(b => b.onclick = () => decide(r, b.dataset.d));
    scrollTo(0, 0);
  }
  async function decide(r, d) {
    const remarks = $('#apprRemarks').value.trim();
    if (d !== 'APPROVE' && !remarks) { toast('Please write your remarks first.'); $('#apprRemarks').focus(); return; }
    const q = { APPROVE: r.finalStep ? 'Approve this request (final)?' : 'Approve and send to the next approver?',
                RETURN: 'Return this request to the requestor for correction?', REJECT: 'Reject this request? This ends the request.' }[d];
    if (!confirm(q)) return;
    view.querySelectorAll('[data-d]').forEach(b => { b.disabled = true; });
    const btn = view.querySelector(`[data-d="${d}"]`); btn.innerHTML = '<span class="spinner"></span>Saving…';
    try {
      const res = await api('portalDecide', { token: session.portalToken, id: r.id, s: r.s, v: r.v, decision: d, remarks }, 90000);
      view.innerHTML = `<div class="card center" style="max-width:520px;margin:30px auto"><div class="done-mark">${d === 'APPROVE' ? '✅' : d === 'RETURN' ? '↩️' : '⛔'}</div>
        <h2>${esc(r.id)}</h2><p>${esc(res.message)}</p><button class="btn" id="apprNext">Back to Approvals</button></div>`;
      $('#apprNext').onclick = () => renderApprovals(); countApprovals();
      dash = null;   // counts changed — the dashboard reloads next time it is opened
    } catch (e) {
      toast(e.message, 5000);
      view.querySelectorAll('[data-d]').forEach(b => { b.disabled = false; });
      btn.innerHTML = { APPROVE: '✓ Approve', RETURN: '↩ Return for correction', REJECT: '✕ Reject' }[d];
    }
  }

  /* ---------- DATABASES (DTH / Loading / OTT · Active & Purged · filters · Excel) ---------- */
  let DBC = {};                                        // loaded databases, kept in memory
  const dbState = { db: 'DTH', status: 'ACTIVE', f: { region: '', partner: '', province: '', month: '', cls: '' }, q: '', page: 0 };
  const PAGE = 100;
  const DB_TABS = [['DTH', 'DTH Acquisition'], ['LOADING', 'Loading'], ['OTT', 'OTT Acquisition']];
  const FILTERS = [['region', 'Region'], ['partner', 'Partner'], ['province', 'Province'], ['month', ''], ['cls', 'Classification']];

  async function renderDatabases(force) {
    const db = dbState.db;
    if (!DBC[db] || force) {
      view.innerHTML = dbHead() + `<p class="hint"><span class="spinner"></span>Loading ${esc(DB_TABS.find(t => t[0] === db)[1])} records…</p>`;
      bindDbHead();
      try { DBC[db] = await api('adminDatabase', { token: session.portalToken, db }, 120000); }
      catch (e) { if (tab === 'databases') view.innerHTML = dbHead() + `<div class="notice bad">${esc(e.message)}</div>`; bindDbHead(); return; }
      if (tab !== 'databases' || dbState.db !== db) return;
    }
    drawDatabase();
  }
  function dbHead() {
    return `<div class="head"><h2>Databases</h2>${DBC[dbState.db] ? `<span class="asof">loaded ${esc(DBC[dbState.db].asOf)}</span>` : ''}
        <button class="refresh" id="dbRefresh">↻ Refresh</button></div>
      <div class="seg">${DB_TABS.map(([k, l]) => `<button data-db="${k}" class="${dbState.db === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  }
  function bindDbHead() {
    view.querySelectorAll('[data-db]').forEach(b => b.onclick = () => {
      if (dbState.db === b.dataset.db) return;
      dbState.db = b.dataset.db; dbState.status = 'ACTIVE'; dbState.f = { region: '', partner: '', province: '', month: '', cls: '' }; dbState.q = ''; dbState.page = 0;
      renderDatabases();
    });
    const r = $('#dbRefresh'); if (r) r.onclick = () => renderDatabases(true);
  }
  const statusOf = (D, r) => D.map.status < 0 ? 'ACTIVE' : (String(r[D.map.status]).trim().toUpperCase() || 'ACTIVE');
  const valOf = (D, r, k) => {
    if (k === 'month') { const v = D.map.date < 0 ? '' : r[D.map.date]; return /^\d{4}-\d{2}/.test(v) ? v.slice(0, 7) : ''; }
    const i = D.map[k]; return i < 0 ? '' : String(r[i] || '').trim();
  };
  function filtered(D, except) {
    const q = dbState.q.trim().toUpperCase();
    return D.rows.filter(r => {
      if (statusOf(D, r) !== dbState.status) return false;
      for (const [k] of FILTERS) { if (k !== except && dbState.f[k] && valOf(D, r, k).toUpperCase() !== dbState.f[k].toUpperCase()) return false; }
      if (q && !r.some(c => String(c).toUpperCase().includes(q))) return false;
      return true;
    });
  }
  const monthName2 = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString([], { month: 'short', year: 'numeric' }); };
  function drawDatabase() {
    const D = DBC[dbState.db]; if (!D) return;
    const counts = { ACTIVE: 0, PURGED: 0 };
    D.rows.forEach(r => { const s = statusOf(D, r); if (s in counts) counts[s]++; });
    const list = filtered(D);
    const pages = Math.max(1, Math.ceil(list.length / PAGE)); if (dbState.page >= pages) dbState.page = pages - 1;
    const from = dbState.page * PAGE, show = list.slice(from, from + PAGE);
    // each filter lists the values available given the other filters (so choices never lead to an empty list)
    const opts = k => {
      const set = new Map(); filtered(D, k).forEach(r => { const v = valOf(D, r, k); if (v) set.set(v.toUpperCase(), v); });
      const arr = [...set.values()];
      return k === 'month' ? arr.sort().reverse() : arr.sort((a, b) => a.localeCompare(b));
    };
    const hasFilter = Object.values(dbState.f).some(Boolean) || dbState.q;
    view.innerHTML = dbHead() + `
      <div class="seg small">${[['ACTIVE', 'Active'], ['PURGED', 'Purged']].map(([k, l]) => `<button data-st="${k}" class="${dbState.status === k ? 'on' : ''}">${l} <b>${fmtN(counts[k])}</b></button>`).join('')}</div>
      <div class="filters-row">
        ${FILTERS.map(([k, l]) => (k !== 'month' && D.map[k] < 0) || (k === 'month' && D.map.date < 0) ? '' : `<label class="f"><span>${k === 'month' ? esc(D.dateLabel) : l}</span>
          <select data-f="${k}"><option value="">All</option>${opts(k).map(v => `<option value="${esc(v)}" ${v.toUpperCase() === dbState.f[k].toUpperCase() ? 'selected' : ''}>${esc(k === 'month' ? monthName2(v) : v)}</option>`).join('')}</select></label>`).join('')}
        <label class="f grow"><span>Search</span><input type="search" id="dbQ" placeholder="Sales Code, name, town…" value="${esc(dbState.q)}"></label>
      </div>
      <div class="listbar">
        <span><b>${fmtN(list.length)}</b> ${dbState.status === 'ACTIVE' ? 'active' : 'purged'} record${list.length === 1 ? '' : 's'}${hasFilter ? ' (filtered)' : ''}${list.length > PAGE ? ` · showing ${fmtN(from + 1)}–${fmtN(from + show.length)}` : ''}</span>
        ${hasFilter ? '<button class="linkish" id="dbClear" style="padding:0">Clear filters</button>' : ''}
        <span style="flex:1"></span>
        <button class="btn mini" id="dbXlsx" ${list.length ? '' : 'disabled'}>⬇ Download Excel (${fmtN(list.length)})</button>
      </div>
      <div class="tablewrap"><table class="data db"><thead><tr>${D.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${show.map(r => `<tr>${D.columns.map((c, i) => `<td>${esc(r[i])}</td>`).join('')}</tr>`).join('') ||
          `<tr><td colspan="${D.columns.length}" class="muted" style="text-align:left;padding:20px">No records match these filters.</td></tr>`}</tbody></table></div>
      ${pages > 1 ? `<div class="pager"><button class="refresh" id="pgPrev" ${dbState.page ? '' : 'disabled'}>‹ Previous</button>
        <span>Page ${dbState.page + 1} of ${fmtN(pages)}</span><button class="refresh" id="pgNext" ${dbState.page < pages - 1 ? '' : 'disabled'}>Next ›</button></div>` : ''}`;
    bindDbHead();
    view.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { dbState.status = b.dataset.st; dbState.f = { region: '', partner: '', province: '', month: '', cls: '' }; dbState.page = 0; drawDatabase(); });
    view.querySelectorAll('[data-f]').forEach(s2 => s2.onchange = () => { dbState.f[s2.dataset.f] = s2.value; dbState.page = 0; drawDatabase(); });
    const q = $('#dbQ'); let qt; q.oninput = () => { clearTimeout(qt); qt = setTimeout(() => { dbState.q = q.value; dbState.page = 0; drawDatabase(); const n = $('#dbQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 350); };
    const c = $('#dbClear'); if (c) c.onclick = () => { dbState.f = { region: '', partner: '', province: '', month: '', cls: '' }; dbState.q = ''; dbState.page = 0; drawDatabase(); };
    const p1 = $('#pgPrev'); if (p1) p1.onclick = () => { dbState.page--; drawDatabase(); scrollTo(0, 0); };
    const p2 = $('#pgNext'); if (p2) p2.onclick = () => { dbState.page++; drawDatabase(); scrollTo(0, 0); };
    $('#dbXlsx').onclick = () => downloadXlsx(D, list);
  }

  // Excel download of exactly what the filters show (SheetJS, loaded only when needed)
  let xlsxReady = null;
  function loadXlsx() {
    if (xlsxReady) return xlsxReady;
    xlsxReady = new Promise((res, rej) => { const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = res; s.onerror = () => { xlsxReady = null; rej(new Error('Could not load the Excel tool. Check your internet.')); };
      document.head.appendChild(s); });
    return xlsxReady;
  }
  async function downloadXlsx(D, list) {
    const b = $('#dbXlsx'); const label = b.innerHTML; b.disabled = true; b.innerHTML = '<span class="spinner"></span>Preparing…';
    try {
      await loadXlsx();
      const dateCols = new Set(D.columns.map((c, i) => /DATE|CREATION|RECRUITED/i.test(c) ? i : -1).filter(i => i >= 0));
      const aoa = [D.columns].concat(list.map(r => r.map((v, i) => {
        if (dateCols.has(i) && /^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); }
        return v;   // everything else stays text (keeps leading zeros of mobile numbers and codes)
      })));
      const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: 'yyyy-mm-dd' });
      ws['!cols'] = D.columns.map((c, i) => ({ wch: Math.min(40, Math.max(c.length, ...list.slice(0, 300).map(r => String(r[i] || '').length)) + 2) }));
      ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: list.length, c: D.columns.length - 1 } }) };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, (D.label + ' ' + (dbState.status === 'ACTIVE' ? 'Active' : 'Purged')).slice(0, 31));
      const parts = Object.entries(dbState.f).filter(([, v]) => v).map(([, v]) => v).concat(dbState.q ? ['search ' + dbState.q] : []);
      const day = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `${D.label} - ${dbState.status === 'ACTIVE' ? 'Active' : 'Purged'}${parts.length ? ' - ' + parts.join(', ') : ''} - ${day}.xlsx`.replace(/[\\/:*?"<>|]/g, '-'));
    } catch (e) { toast(e.message, 5000); }
    finally { b.disabled = false; b.innerHTML = label; }
  }

  if (!CFG.API_URL) view.innerHTML = '<div class="notice bad">API_URL is not set in config.js.</div>';
  else if (session && session.portalToken) start(); else renderLogin();
})();
