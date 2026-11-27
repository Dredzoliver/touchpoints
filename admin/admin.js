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
  let retItems = [], retFilter = 'ALL', retLoaded = false;

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
    session = null; navHist = []; store.del('adminSession'); clearInterval(timer); $('#fab').hidden = true; retItems = []; retLoaded = false; dash = null; apprItems = []; apprLoaded = false; DBC = {}; IDB.clear(); dbState.db = '';
    try { if (window.google && google.accounts) google.accounts.id.disableAutoSelect(); } catch (e) {}
    renderLogin(silent ? '' : 'You have signed out.');
  }
  $('#logoutBtn').onclick = () => { if (confirm('Sign out?')) logout(); };

  /* ---------- tabs ---------- */
  document.querySelectorAll('#tabs [data-tab]').forEach(b => b.onclick = () => goTab(b.dataset.tab));
  // On Process now tiles are counts only (not clickable) — Frederick, 25 Nov 2026
  /* Back to the previous screen (Frederick, 27 Nov 2026): every move between tabs / Admin tools is remembered, so the
     ‹ Back button and the browser's / phone's Back button return to the screen before (Dashboard if there is none). */
  let navHist = [];
  const TAB_NAMES = { dashboard: 'Dashboard', approvals: 'Approvals', returned: 'Returned', search: 'Search request', databases: 'Databases', tools: 'Admin tools' };
  function goTab(t, tool) {
    const same = tab === t && (t !== 'tools' || !tool || tool === toolsSection);
    if (!same) {
      navHist.push({ tab, tool: toolsSection });
      if (navHist.length > 50) navHist.shift();
      try { history.pushState({ tpAdmin: navHist.length }, ''); } catch (e) {}
    }
    tab = t; if (tool) toolsSection = tool; show(); scrollTo(0, 0);
  }
  function backTo() {
    const p = navHist[navHist.length - 1];
    if (!p) return 'Dashboard';
    return p.tab === 'tools' ? 'Admin tools · ' + ((TOOL_TABS.find(x => x[0] === p.tool) || [, ''])[1]) : TAB_NAMES[p.tab] || 'previous screen';
  }
  function goBack() {   // the ‹ Back button: use the browser history so both Back buttons stay in step
    if (navHist.length) { try { history.back(); return; } catch (e) {} }
    stepBack();
  }
  function stepBack() {
    const p = navHist.pop() || { tab: 'dashboard' };
    tab = p.tab; if (p.tool) toolsSection = p.tool; show(); scrollTo(0, 0);
  }
  window.addEventListener('popstate', () => { if (session && navHist.length) stepBack(); });
  const backBtn = () => tab === 'dashboard' && !navHist.length ? '' : `<button class="backbtn" id="navBack">‹ Back to ${esc(backTo())}</button>`;
  view.addEventListener('click', e => { if (e.target.closest('#navBack')) goBack(); });
  let dl = null;   // what the floating Download database button exports (Databases tab, list on screen)
  function show() {
    dl = null; drawFab();
    document.querySelectorAll('#tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    // already loaded → show instantly; fresh data comes from ↻ Refresh, the 5-minute timer, or after a decision
    if (tab === 'dashboard') { if (dash) drawDashboard(); else renderDashboard(); }
    else if (tab === 'databases') renderDatabases();
    else if (tab === 'tools') renderTools();
    else if (tab === 'returned') { if (retLoaded) drawReturned(); else renderReturned(); }
    else if (tab === 'search') renderSearch();
    else { if (apprLoaded) drawApprovals(); else renderApprovals(); }
  }
  function start() {
    $('#tabs').hidden = false; $('#logoutBtn').hidden = false;
    $('#who').textContent = (session.user.email || session.user.name) + ' · ' + session.user.role;
    $('#toolsTab').hidden = !['ADMIN', 'DEPT'].includes(session.user.role);   // Admin tools: ADMIN (all) and DEPT (purge + redirect)
    document.querySelector('#tabs [data-tab=approvals]').hidden = session.user.role === 'ADMIN';   // ADMIN monitors, never decides
    if (session.user.role === 'ADMIN' && tab === 'approvals') tab = 'dashboard';
    $('#retTab').hidden = false;   // ADMIN and DEPT follow up returned requests
    countReturned();
    show(); if (session.user.role !== 'ADMIN') countApprovals();
    clearInterval(timer);
    timer = setInterval(() => { if (document.visibilityState !== 'visible') return; if (session.user.role !== 'ADMIN') countApprovals(); countReturned(); if (tab === 'dashboard' && !$('.detail')) renderDashboard(true); else dash = null; }, 300000);   // every 5 minutes
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
    view.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { tab = 'approvals'; document.querySelectorAll('#tabs [data-tab]').forEach(x => x.classList.toggle('on', x.dataset.tab === 'approvals')); openApproval(b.dataset.open); });
    view.querySelectorAll('[data-view]').forEach(b => b.onclick = () => openApproval(b.dataset.view, 'dashboard'));   // monitor: read-only
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
    return `<section class="block"><h3>${title}</h3>
      <div class="scroll"><table class="data"><thead><tr><th>Status (by date requested)</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>
        ${rows.map(([k, l]) => `<tr><td><span class="dot ${k}"></span>${l}</td>${cols.map(c => `<td>${fmtN(P[c[0]][k])}</td>`).join('')}</tr>`).join('')}
        <tr class="total"><td>Total requested</td>${cols.map(c => `<td>${fmtN(P[c[0]].total)}</td>`).join('')}</tr>
      </tbody></table></div>
      <h3 style="margin:18px 0 0">On Process now</h3>
      <div class="where">${where.map(([w, l, s]) => `<div class="tile ${W[w].length ? '' : 'zero'}">
          <b>${fmtN(W[w].length)}</b><span>${l}</span><small>${s}</small></div>`).join('')}</div>
    </section>`;
  }

  /* ---------- APPROVALS (what is waiting for this login, e.g. DEPT) ---------- */
  async function countApprovals() {
    try { apprItems = (await api('portalInbox', { token: session.portalToken }, 45000)).items; apprLoaded = true;
      if (tab === 'approvals' && $('#apprRefresh')) drawApprovals();
      const c = $('#apprCount'); c.textContent = apprItems.length; c.hidden = !apprItems.length; drawFab(); } catch (e) {}
  }
  async function renderApprovals() {
    view.innerHTML = `<p class="hint"><span class="spinner"></span>Loading requests waiting for you…</p>`;
    try { apprItems = (await api('portalInbox', { token: session.portalToken }, 45000)).items; apprLoaded = true; }
    catch (e) { view.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    if (tab !== 'approvals') return;
    const c = $('#apprCount'); c.textContent = apprItems.length; c.hidden = !apprItems.length;
    drawApprovals(); drawFab();
  }
  function drawApprovals() {
    const n = k => apprItems.filter(i => k === 'ALL' || i.kind === k).length;
    const list = apprItems.filter(i => apprFilter === 'ALL' || i.kind === apprFilter);
    view.innerHTML = `${backBtn()}<div class="bar"><h2>Waiting for ${esc(session.user.name)}</h2><button class="refresh" id="apprRefresh">↻ Refresh</button></div>
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
  async function openApproval(id, from) {
    view.innerHTML = `<p class="hint"><span class="spinner"></span>Opening ${esc(id)}…</p>`;
    let r;
    try { r = await api('portalRequest', { token: session.portalToken, id }, 60000); }
    catch (e) { if (from === 'search') { renderSearch(); const m = $('#findMsg'); if (m) m.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
      toast(e.message, 4000); return from === 'dashboard' ? drawDashboard() : from === 'returned' ? drawReturned() : renderApprovals(); }
    if (from === 'search') rememberSearch(r.id);
    const rows = r.rows.map(x => `<tr><td>${esc(x.label)}</td><td class="${x.red ? 'red' : ''}">${x.html ? x.value : esc(x.value).replace(/\n/g, '<br>')}</td></tr>`).join('');
    view.innerHTML = `<div class="card detail">
      <div class="bar"><button class="refresh" id="apprBack">‹ Back</button><h2 style="font-size:16px">${esc(r.id)}</h2>
        ${r.waiting ? '<button class="btn mini dark" id="toDecide">Decide ↓</button>' : ''}</div>
      <h2>${esc(r.title)}</h2>
      ${r.info ? statusCard(r.info) : ''}
      <p class="hint" style="margin-top:0">${r.waiting ? (r.finalStep ? 'Final approval' : 'Approval step ' + esc(r.step)) + ' · ' + esc(r.approver) : 'View only · status ' + esc(r.status) + (r.status === 'FOR APPROVAL' && r.approver ? ' · waiting for ' + esc(r.approver) : '')}</p>
      ${r.photo ? `<img class="photo" src="${r.photo}" alt="Store photo" id="apprPhoto">` : ''}
      ${r.lat ? `<p style="margin:4px 0 10px"><a href="https://www.google.com/maps?q=${esc(r.lat)},${esc(r.lng)}" target="_blank" rel="noopener">📍 Open location in Google Maps</a></p>` : ''}
      <table class="sum">${rows}</table>
      ${r.proofs.length ? `<h3>📎 Attached Proof (${r.proofs.length})</h3><div class="proof">${r.proofs.map(p => p.src ? `<img src="${p.src}" alt="${esc(p.name)}" class="zoomable">`
          : `<button class="btn ghost" data-pdf="${p.i}" style="margin:6px 0;max-width:520px">📄 Open ${p.type === 'application/pdf' ? 'PDF' : /word/.test(p.type) ? 'Word file' : /sheet|excel/.test(p.type) ? 'Excel file' : 'file'}: ${esc(p.name)}</button>`).join('')}</div>` : ''}
      <h3>History</h3>
      <ul class="hist">${r.history.map(h => `<li>${new Date(h.at).toLocaleString()} — ${esc(h.who)}: <b>${esc(h.what)}</b>${h.remarks ? ' — “' + esc(h.remarks) + '”' : ''}</li>`).join('')}</ul>
      ${r.waiting ? `<div class="decide">
        <label for="apprRemarks" style="margin-top:0">Remarks <span class="hint" style="display:inline">(required to Return or Reject)</span></label>
        <textarea id="apprRemarks" rows="3" placeholder="What should be corrected, or why it is rejected"></textarea>
        <div class="btns"><button class="btn approve" data-d="APPROVE">✓ Approve${r.finalStep ? ' (final)' : ''}</button>
          <button class="btn return" data-d="RETURN">↩ Return for correction</button><button class="btn reject" data-d="REJECT">✕ Reject</button></div></div>` : ''}</div>`;
    $('#apprBack').onclick = () => from === 'search' ? renderSearch() : from === 'dashboard' ? drawDashboard() : from === 'returned' ? drawReturned() : renderApprovals();
    const td = $('#toDecide'); if (td) td.onclick = () => $('.decide').scrollIntoView({ behavior: 'smooth' });
    view.querySelectorAll('#apprPhoto, .zoomable').forEach(img => img.onclick = () => { const z = document.createElement('div'); z.className = 'zoom'; z.innerHTML = `<img src="${img.src}" alt="">`; z.onclick = () => z.remove(); document.body.appendChild(z); });
    view.querySelectorAll('[data-pdf]').forEach(b => b.onclick = async () => {
      const w = window.open('', '_blank');
      try { const f = await api('portalFile', { token: session.portalToken, id: r.id, i: Number(b.dataset.pdf) }, 90000);
        const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(f.data), c => c.charCodeAt(0))], { type: f.type }));
        if (f.type === 'application/pdf') { if (w) w.location.href = url; else location.href = url; }
        else { if (w) w.close(); const a = document.createElement('a'); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); } }   // Word / Excel: download
      catch (e) { if (w) w.close(); toast(e.message, 4000); }
    });
    view.querySelectorAll('[data-d]').forEach(b => b.onclick = () => decide(r, b.dataset.d));
    scrollTo(0, 0);
  }
  /* ---------- Search a request (Frederick, 26 Nov 2026) — ADMIN and DEPT ---------- */
  // "TPR-2026-00021", "2026-21" or just "21" (this year)
  function normRequestId(v) {
    v = String(v || '').trim().toUpperCase().replace(/\s+/g, '');
    let m = v.match(/^(?:TPR-?)?(\d{4})-?(\d{1,5})$/); if (m && v.length > 5) return `TPR-${m[1]}-${m[2].padStart(5, '0')}`;
    m = v.match(/^(?:TPR-?)?(\d{1,5})$/); if (m) return `TPR-${new Date().getFullYear()}-${m[1].padStart(5, '0')}`;
    return v;
  }
  const recentKey = 'tpAdminRecent';
  function recentSearches() { try { return JSON.parse(localStorage.getItem(recentKey) || '[]'); } catch (e) { return []; } }
  function rememberSearch(id) { try { localStorage.setItem(recentKey, JSON.stringify([id].concat(recentSearches().filter(x => x !== id)).slice(0, 8))); } catch (e) {} }
  function renderSearch(val) {
    const rec = recentSearches();
    view.innerHTML = `${backBtn()}<div class="card find-card"><h2>Search a request</h2>
      <p class="hint" style="margin-top:0">Type the request reference number to see all its details, the approval flow and where it is now.</p>
      <form id="findForm" class="find-row" autocomplete="off">
        <input type="text" id="findId" placeholder="e.g. TPR-2026-00021 or 21" value="${esc(val || '')}" autocapitalize="characters" spellcheck="false">
        <button class="btn" type="submit">🔍 Search</button></form>
      <div id="findMsg"></div>
      ${rec.length ? `<p class="hint">Recent: ${rec.map(id => `<button class="chip" data-find="${esc(id)}">${esc(id)}</button>`).join(' ')}</p>` : ''}</div>`;
    const go = id => { id = normRequestId(id); if (!id) { $('#findId').focus(); return; } openApproval(id, 'search'); };
    $('#findForm').onsubmit = e => { e.preventDefault(); go($('#findId').value); };
    view.querySelectorAll('[data-find]').forEach(b => b.onclick = () => go(b.dataset.find));
    setTimeout(() => { const i = $('#findId'); if (i) i.focus(); }, 50);
  }
  // where the request is now — on process / returned / rejected / approved / cancelled
  function statusCard(s) {
    const line = (k, v) => v ? `<div class="st-line"><span>${k}</span><b>${esc(v)}</b></div>` : '';
    const ago = d => d == null ? '' : d === 0 ? 'today' : d === 1 ? '1 day' : d + ' days';
    const head = { PROCESS: ['🕒', 'On process'], RETURNED: ['↩', 'Returned to requestor'], REJECTED: ['⛔', 'Rejected'],
      APPROVED: ['✅', 'Approved'], ACTION: ['⚠', 'Approved — action needed'], CANCELLED: ['✕', 'Cancelled'] }[s.state] || ['•', s.status];
    let body = '';
    if (s.state === 'PROCESS') body = line('Waiting for', s.who) + line('Approval step', s.step + (s.final ? ' (final approval)' : '')) +
      line('Email', s.email) + line('Waiting since', s.since + (s.days != null ? ' · ' + ago(s.days) : ''));
    else if (s.state === 'RETURNED') body = line('Returned by', s.who) + line('When', s.when) + line('Reason', s.why || '—') +
      line('Now with', s.requestor + ' (to correct and resend)') + line('Waiting', ago(s.days));
    else if (s.state === 'REJECTED') body = line('Rejected by', s.who) + line('When', s.when) + line('Reason', s.why || '—');
    else if (s.state === 'CANCELLED') body = line('Cancelled by', s.who) + line('When', s.when) + line('Reason', s.why);
    else if (s.state === 'APPROVED' || s.state === 'ACTION') body = line('Approved on', s.when) + line('Final approval by', s.who) +
      (s.code ? `<div class="st-code"><span>Sales Code</span><b>${esc(s.code)}</b></div>` : '') + line('Problem', s.problem);
    return `<div class="st-card st-${(s.state || '').toLowerCase()}"><div class="st-head"><span class="ic">${head[0]}</span>${esc(head[1])}</div>
      ${body}${line('Requested by', s.requestor + (s.submitted ? ' · ' + s.submitted : ''))}</div>`;
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
      $('#apprNext').onclick = () => renderApprovals(); countApprovals(); countReturned();
      dash = null;   // counts changed — the dashboard reloads next time it is opened
    } catch (e) {
      toast(e.message, 5000);
      view.querySelectorAll('[data-d]').forEach(b => { b.disabled = false; });
      btn.innerHTML = { APPROVE: '✓ Approve', RETURN: '↩ Return for correction', REJECT: '✕ Reject' }[d];
    }
  }

  /* ---------- DATABASES (DTH / Loading / OTT · Active & Purged · filters · Excel) ---------- */
  let DBC = {};                                        // loaded databases, kept in memory
  const dbState = { db: '', status: 'ACTIVE', f: { region: '', partner: '', province: '', month: '', cls: '' }, q: '', page: 0 };
  const PAGE = 100;
  const DB_TABS = [['DTH', 'DTH Acquisition'], ['LOADING', 'Loading'], ['OTT', 'OTT Acquisition']];
  const FILTERS = [['region', 'Region'], ['partner', 'Partner'], ['province', 'Province'], ['month', ''], ['cls', 'Classification']];

  /* Speed: (1) only the Active OR Purged list is fetched, (2) every list is saved on this computer (IndexedDB) and shown
     instantly next time while a fresh copy loads in the background, (3) only the database you choose is loaded. */
  const dbKey = () => dbState.db + ':' + dbState.status;
  const IDB = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => { const r = indexedDB.open('touchpoints-admin', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('lists');
        r.onsuccess = () => { this.db = r.result; res(this.db); }; r.onerror = () => rej(r.error); });
    },
    async run(mode, fn) { const d = await this.open(); return new Promise((res, rej) => { const tx = d.transaction('lists', mode); const q = fn(tx.objectStore('lists')); tx.oncomplete = () => res(q && q.result); tx.onerror = () => rej(tx.error); }); },
    get(k) { return this.run('readonly', s => s.get(k)).catch(() => null); },
    put(k, v) { return this.run('readwrite', s => s.put(v, k)).catch(() => {}); },
    clear() { return this.run('readwrite', s => s.clear()).catch(() => {}); }
  };
  const loading = {};   // key → promise (so the same list is never fetched twice at once)
  function fetchList(db, status) {
    const k = db + ':' + status;
    if (!loading[k]) loading[k] = api('adminDatabase', { token: session.portalToken, db, status }, 120000)
      .then(d => { d.savedAt = Date.now(); DBC[k] = d; IDB.put(k, d); return d; })
      .finally(() => { delete loading[k]; });
    return loading[k];
  }
  function renderDbChooser() {
    dl = null; drawFab();
    const tp = dash && dash.touchpoints;
    view.innerHTML = `${backBtn()}<div class="head"><h2>Databases</h2></div>
      <p class="hint" style="margin:-6px 0 14px">Choose which database to open. Only that one is loaded.</p>
      <div class="choose">${DB_TABS.map(([k, l]) => `<button data-pick="${k}" class="pick ${k.toLowerCase()}"><span>${l}</span>
          ${tp && tp[k] ? `<b>${fmtN(tp[k].active)}</b><small>active · ${fmtN(tp[k].purged)} purged</small>` : '<small>Active and Purged lists</small>'}</button>`).join('')}</div>`;
    view.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
      dbState.db = b.dataset.pick; dbState.status = 'ACTIVE'; dbState.f = { region: '', partner: '', province: '', month: '', cls: '' }; dbState.q = ''; dbState.page = 0;
      renderDatabases();
    });
  }
  async function renderDatabases(force) {
    if (!dbState.db) return renderDbChooser();
    if (dl && dl.D !== DBC[dbKey()]) { dl = null; drawFab(); }
    const k = dbKey(), [db, status] = k.split(':');
    if (!DBC[k]) { const saved = await IDB.get(k); if (saved && !DBC[k]) { DBC[k] = saved; DBC[k].stale = true; } }
    if (tab !== 'databases' || dbKey() !== k) return;
    if (DBC[k] && !force) {
      drawDatabase();
      if (DBC[k].stale || Date.now() - (DBC[k].savedAt || 0) > 600000) refreshQuietly(k);   // older than 10 min → update in background
      return;
    }
    if (DBC[k] && force) { DBC[k].stale = true; drawDatabase(); return refreshQuietly(k); }
    view.innerHTML = dbHead() + `<p class="hint"><span class="spinner"></span>Loading ${esc(DB_TABS.find(t => t[0] === db)[1])} · ${status === 'ACTIVE' ? 'Active' : 'Purged'}… (only the first time — next time it opens instantly)</p>`;
    bindDbHead();
    try { await fetchList(db, status); }
    catch (e) { if (tab === 'databases' && dbKey() === k) { view.innerHTML = dbHead() + `<div class="notice bad">${esc(e.message)}</div>`; bindDbHead(); } return; }
    if (tab === 'databases' && dbKey() === k) drawDatabase();
  }
  async function refreshQuietly(k) {
    const [db, status] = k.split(':');
    try { await fetchList(db, status); } catch (e) { toast('Could not update the list: ' + e.message, 4000); return; }
    if (tab === 'databases' && dbKey() === k) drawDatabase(true);
  }
  function dbHead() {
    const D = DBC[dbKey()];
    return `<div class="head"><button class="refresh" id="dbBack">‹ Databases</button><h2>${esc((DB_TABS.find(t => t[0] === dbState.db) || [, ''])[1])}</h2>${D ? `<span class="asof">${D.stale || loading[dbKey()] ? '<span class="spinner"></span>updating… · saved copy from ' + esc(new Date(D.savedAt).toLocaleString()) : 'updated ' + esc(D.asOf)}</span>` : ''}
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
    const bk = $('#dbBack'); if (bk) bk.onclick = () => { dbState.db = ''; renderDbChooser(); };
  }
  const statusOf = (D, r) => D.map.status < 0 ? 'ACTIVE' : (String(r[D.map.status]).trim().toUpperCase() || 'ACTIVE');
  const valOf = (D, r, k) => {
    if (k === 'month') { const v = D.map.date < 0 ? '' : r[D.map.date]; return /^\d{4}-\d{2}/.test(v) ? v.slice(0, 7) : ''; }
    const i = D.map[k]; return i < 0 ? '' : String(r[i] || '').trim();
  };
  function filtered(D, except) {
    const q = dbState.q.trim().toUpperCase();
    return D.rows.filter(r => {
      if (D.status === 'ALL' && statusOf(D, r) !== dbState.status) return false;
      for (const [k] of FILTERS) { if (k !== except && dbState.f[k] && valOf(D, r, k).toUpperCase() !== dbState.f[k].toUpperCase()) return false; }
      if (q && !r.some(c => String(c).toUpperCase().includes(q))) return false;
      return true;
    });
  }
  const monthName2 = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString([], { month: 'short', year: 'numeric' }); };
  function drawDatabase(keepFocus) {
    const D = DBC[dbKey()]; if (!D) return;
    const hadFocus = keepFocus && document.activeElement && document.activeElement.id === 'dbQ';
    const counts = D.counts || { ACTIVE: 0, PURGED: 0 };
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
      </div>
      <div class="tablewrap"><table class="data db"><thead><tr>${D.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${show.map(r => `<tr>${D.columns.map((c, i) => `<td>${esc(r[i])}</td>`).join('')}</tr>`).join('') ||
          `<tr><td colspan="${D.columns.length}" class="muted" style="text-align:left;padding:20px">No records match these filters.</td></tr>`}</tbody></table></div>
      ${pages > 1 ? `<div class="pager"><button class="refresh" id="pgPrev" ${dbState.page ? '' : 'disabled'}>‹ Previous</button>
        <span>Page ${dbState.page + 1} of ${fmtN(pages)}</span><button class="refresh" id="pgNext" ${dbState.page < pages - 1 ? '' : 'disabled'}>Next ›</button></div>` : ''}`;
    bindDbHead();
    view.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { if (dbState.status === b.dataset.st) return; dbState.status = b.dataset.st; dbState.f = { region: '', partner: '', province: '', month: '', cls: '' }; dbState.page = 0; renderDatabases(); });
    if (hadFocus) { const n = $('#dbQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    view.querySelectorAll('[data-f]').forEach(s2 => s2.onchange = () => { dbState.f[s2.dataset.f] = s2.value; dbState.page = 0; drawDatabase(); });
    const q = $('#dbQ'); let qt; q.oninput = () => { clearTimeout(qt); qt = setTimeout(() => { dbState.q = q.value; dbState.page = 0; drawDatabase(); const n = $('#dbQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 350); };
    const c = $('#dbClear'); if (c) c.onclick = () => { dbState.f = { region: '', partner: '', province: '', month: '', cls: '' }; dbState.q = ''; dbState.page = 0; drawDatabase(); };
    const p1 = $('#pgPrev'); if (p1) p1.onclick = () => { dbState.page--; drawDatabase(); scrollTo(0, 0); };
    const p2 = $('#pgNext'); if (p2) p2.onclick = () => { dbState.page++; drawDatabase(); scrollTo(0, 0); };
    dl = { D, list, filtered: !!hasFilter }; drawFab();   // floating "Download database" = exactly this list
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

  /* ======================= ADMIN TOOLS (ADMIN only) ======================= */
  let toolsSection = 'purge';
  const TOOL_TABS = [['purge', 'Bulk purge', true], ['restore', 'Restore purged', true], ['redirect', 'Redirect a request', true], ['tables', 'Edit tables'], ['status', 'System status']];   // true = DEPT may use
  function renderTools() {
    const mine = TOOL_TABS.filter(t => session.user.role === 'ADMIN' || t[2]);   // DEPT: only the tools marked for DEPT
    if (!mine.some(t => t[0] === toolsSection)) toolsSection = mine[0][0];
    view.innerHTML = `${backBtn()}<div class="head"><h2>Admin tools</h2></div>
      <div class="seg">${mine.map(([k, l]) => `<button data-tool="${k}" class="${toolsSection === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div id="toolBody"></div>`;
    view.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => goTab('tools', b.dataset.tool));
    ({ purge: toolPurge, restore: toolRestore, redirect: toolRedirect, tables: toolTables, status: toolStatus })[toolsSection]();
  }
  const body = () => $('#toolBody');

  /* ---------- Bulk purge (Frederick, 26 Nov 2026) ----------
     Choose a database → upload ANY file (Excel/CSV/ODS, Word, PowerPoint, PDF, text…) or paste → the system finds the Sales Codes,
     matches them with that database and says how many will be purged → confirm → PURGED. Then it offers the SAME list for the
     next database (with how many each would purge) until the user ends or all three databases are done. */
  const purge = { db: '', codes: [], src: '', loose: false, how: '', preview: null, previews: {}, done: {}, stage: 'start' };
  const PURGE_MAX = 20000;
  function purgeReset() { Object.assign(purge, { db: '', codes: [], src: '', loose: false, how: '', preview: null, previews: {}, done: {}, stage: 'start' }); }
  const dbLabel = k => (DB_TABS.find(t => t[0] === k) || [, k])[1];

  // SECURITY (Frederick, 26 Nov 2026): a file is used only if it has a column headed SALESCODE (any case; "Sales Code" also OK,
  // PRIMARY SALESCODE is not). Only that column is read. No such column → the file is rejected.
  const isCodeHeader = h => ['SALESCODE', 'SALESCODES'].includes(String(h || '').toUpperCase().replace(/[^A-Z]/g, ''));
  function codesFromTable(aoa) {   // rows → values under every SALESCODE column (header within the first 15 rows)
    for (let r = 0; r < Math.min(15, aoa.length); r++) {
      const cols = (aoa[r] || []).map((h, i) => isCodeHeader(h) ? i : -1).filter(i => i >= 0);
      if (cols.length) { const out = []; aoa.slice(r + 1).forEach(row => cols.forEach(c => { const v = String((row || [])[c] || '').trim(); if (v) out.push(v); })); return out; }
    }
    return null;
  }
  function wordTables(buf) {   // .docx: tables only (a column needs a table)
    const z = XLSX.CFB.read(new Uint8Array(buf), { type: 'array' }); const tables = [];
    z.FullPaths.forEach((p, i) => {
      if (!/word\/document\.xml$/i.test(p)) return;
      const xml = new TextDecoder().decode(z.FileIndex[i].content);
      (xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []).forEach(t => tables.push((t.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || [])
        .map(r => (r.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) || []).map(c => c.replace(/<\/w:p>/g, ' ').replace(/<[^>]+>/g, '').trim()))));
    });
    return tables;
  }
  async function readCodesFromFile(f) {
    const ext = (f.name.split('.').pop() || '').toLowerCase(), buf = await f.arrayBuffer();
    const noCol = `No column with the header SALESCODE was found in "${f.name}", so the file was not used. Add a column headed SALESCODE with the codes under it, then upload again.`;
    if (/^image\//.test(f.type) || ['jpg', 'jpeg', 'png', 'gif', 'heic', 'heif', 'webp', 'bmp', 'tif', 'tiff', 'pdf'].includes(ext))
      throw new Error(`"${f.name}" can't be used — pictures, scans and PDFs have no columns. Use an Excel, CSV or Word file with a SALESCODE column.`);
    await loadXlsx();
    let found = null, how = '';
    if (['docx', 'docm', 'dotx'].includes(ext)) {
      for (const t of wordTables(buf)) { const c = codesFromTable(t); if (c) { found = (found || []).concat(c); how = 'SALESCODE column, Word table'; } }
    } else {
      let wb = null; try { wb = XLSX.read(buf, { type: 'array' }); } catch (e) {}   // Excel, CSV, ODS, text tables, web tables…
      if (wb) wb.SheetNames.forEach(n => { const c = codesFromTable(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }));
        if (c) { found = (found || []).concat(c); how = 'SALESCODE column'; } });
    }
    if (!found) throw new Error(noCol);
    return { codes: found, loose: false, how };
  }
  const uniqCodes = a => { const s = new Set(); return a.map(x => String(x).toUpperCase().replace(/\s+/g, '')).filter(x => x && !s.has(x) && s.add(x)); };

  function purgeSteps() {   // progress across the three databases
    return `<div class="psteps">${DB_TABS.map(([k, l]) => { const d = purge.done[k];
      return `<span class="pstep ${d ? 'done' : purge.db === k && purge.stage !== 'next' && purge.stage !== 'end' ? 'now' : ''}">${esc(l)}${d ? ` · ${d.skipped ? 'skipped' : '✓ ' + fmtN(d.n) + ' purged'}` : ''}</span>`; }).join('')}</div>`;
  }
  function toolPurge() {
    const p = purge;
    if (p.stage === 'next' || p.stage === 'end') return drawPurgeNext();
    const fresh = !Object.keys(p.done).length;
    body().innerHTML = fresh ? `<section class="block"><h3>1 · Which database?</h3>
        <div class="seg">${DB_TABS.map(([k, l]) => `<button data-pdb="${k}" class="${p.db === k ? 'on' : ''}">${l}</button>`).join('')}</div></section>
      <section class="block" ${p.db ? '' : 'hidden'}><h3>2 · List of Sales Codes to purge</h3>
        <p class="hint" style="margin-top:0">Upload an Excel, CSV or Word file. 🔒 <b>The file must have a column headed SALESCODE</b> (capital or small letters) —
          only that column is read; a file without it is rejected. You can also paste the codes.</p>
        <input type="file" id="pFile" accept=".xlsx,.xlsm,.xlsb,.xls,.ods,.csv,.tsv,.txt,.docx,.docm,.dotx"><div id="pErr"></div>
        ${p.src ? `<div class="hint ok">✓ ${esc(p.src)} — ${fmtN(p.codes.length)} Sales Code${p.codes.length === 1 ? '' : 's'} read from the ${esc(p.how)}</div>` : ''}
        <label for="pPaste">…or paste codes</label><textarea id="pPaste" rows="4" placeholder="ABC1234526&#10;XYZ0001226">${p.src ? '' : esc(p.codes.join('\n'))}</textarea>
        <button class="btn dark" id="pPrev" style="max-width:300px;margin-top:12px">Match with ${esc(dbLabel(p.db))}</button></section>
      <div id="pResult"></div>`
      : `${purgeSteps()}<div class="notice">Same list: <b>${esc(p.src || 'pasted codes')}</b> · ${fmtN(p.codes.length)} code(s)</div><div id="pResult"></div>`;
    view.querySelectorAll('[data-pdb]').forEach(b => b.onclick = () => { p.db = b.dataset.pdb; p.preview = null; toolPurge(); });
    if (p.preview) return drawPurgePreview();
    if (!p.db || !fresh) return;
    $('#pFile').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      const box = $('#pFile'); box.disabled = true; toast('Reading ' + f.name + '…', 2500);
      try {
        const r = await readCodesFromFile(f), codes = uniqCodes(r.codes);
        if (!codes.length) throw new Error('No Sales Codes were found in this file.');
        if (codes.length > PURGE_MAX) throw new Error(`The file has ${fmtN(codes.length)} possible codes — the limit is ${fmtN(PURGE_MAX)}. Split the file, or use a SALESCODE column.`);
        Object.assign(p, { codes, src: f.name, loose: r.loose, how: r.how, preview: null, previews: {} }); toolPurge();
      } catch (err) { Object.assign(p, { codes: [], src: '', how: '', preview: null, previews: {} }); toolPurge(); $('#pErr').innerHTML = `<div class="notice bad"><b>File rejected</b>${esc(err.message)}</div>`; }
    };
    $('#pPaste').oninput = e => { Object.assign(p, { src: '', loose: false, how: 'pasted', preview: null, previews: {} }); p.codes = uniqCodes(e.target.value.split(/[\s,;]+/)); };
    $('#pPrev').onclick = () => { if (!p.codes.length) return toast('Add the Sales Codes first.'); purgeCheck($('#pPrev')); };
  }
  async function purgeCheck(btn) {
    const p = purge, label = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Matching…'; }
    try { p.preview = p.previews[p.db] || await api('adminPurgePreview', { token: session.portalToken, db: p.db, codes: p.codes }, 120000); p.stage = 'confirm'; drawPurgePreview(); }
    catch (e) { toast(e.message, 5000); if (btn) { btn.disabled = false; btn.innerHTML = label; } }
  }
  function drawPurgePreview() {
    const p = purge, r = p.preview, n = r.purge.length;
    const nf = r.notFound.length;
    $('#pResult').innerHTML = `<section class="block"><h3>${Object.keys(p.done).length ? '' : '3 · '}Matched with ${esc(r.label)}</h3>
      <div class="pbig ${n ? '' : 'none'}"><b>${fmtN(n)}</b> ${esc(r.label)} record${n === 1 ? '' : 's'} will be tagged <b>PURGED</b></div>
      <div class="stats">
        <div class="stat"><div class="lbl">Already purged</div><div class="num">${fmtN(r.already.length)}</div><div class="sub">no change</div></div>
        ${p.loose ? `<div class="stat"><div class="lbl">Other words in the file</div><div class="num">${fmtN(nf)}</div><div class="sub">not Sales Codes of ${esc(r.label)} · ignored</div></div>`
                  : `<div class="stat"><div class="lbl">Not in ${esc(r.label)}</div><div class="num">${fmtN(nf)}</div><div class="sub">may be in another database</div></div>`}
      </div>
      ${!p.loose && nf ? `<p class="hint" style="margin-top:12px">Not in ${esc(r.label)}: ${r.notFound.slice(0, 60).map(esc).join(', ')}${nf > 60 ? ' …' : ''}</p>` : ''}
      ${n ? `<div class="expand scroll" style="max-height:340px"><table class="data"><thead><tr><th>Sales Code</th><th>Partner</th><th>Name</th><th>Status now</th></tr></thead><tbody>
          ${r.purge.slice(0, 500).map(x => `<tr><td><b>${esc(x.code)}</b></td><td>${esc(x.partner)}</td><td>${esc(x.name)}</td><td>${esc(x.status)}</td></tr>`).join('')}</tbody></table></div>
        ${n > 500 ? `<p class="hint">Showing the first 500 of ${fmtN(n)}.</p>` : ''}
        <p class="hint">Please check the list above before you continue.</p>` : `<div class="notice warn" style="margin-top:12px">None of the codes are active in ${esc(r.label)} — nothing to purge here.</div>`}
      <div class="pact">
        ${n ? `<button class="btn" id="pApply">Proceed — tag ${fmtN(n)} as PURGED</button>` : ''}
        <button class="btn ghost" id="pSkip">${n ? 'Don\'t purge ' + esc(r.label) : 'Next'}</button>
        ${Object.keys(p.done).length ? '' : '<button class="linkish" id="pBack">‹ Change the list</button>'}</div>
    </section>`;
    const back = $('#pBack'); if (back) back.onclick = () => { p.preview = null; p.previews = {}; p.stage = 'start'; toolPurge(); };
    $('#pSkip').onclick = () => { p.done[p.db] = { n: 0, skipped: !!n }; p.preview = null; p.stage = 'next'; toolPurge(); };
    const a = $('#pApply'); if (a) a.onclick = async () => {
      if (!confirm(`Tag ${n} ${r.label} record(s) as PURGED with today's date?\n\nThis is recorded in the ADMIN LOG.`)) return;
      a.disabled = true; a.innerHTML = '<span class="spinner"></span>Purging…'; $('#pSkip').disabled = true;
      try {
        const res = await api('adminPurgeApply', { token: session.portalToken, db: p.db, codes: p.codes }, 300000);
        ['ACTIVE', 'PURGED'].forEach(s2 => { delete DBC[p.db + ':' + s2]; IDB.put(p.db + ':' + s2, null); });
        dash = null;
        p.done[p.db] = { n: res.purged, msg: res.message }; p.preview = null; p.stage = 'next'; toolPurge();
      } catch (e) { toast(e.message, 6000); a.disabled = false; $('#pSkip').disabled = false; a.innerHTML = `Proceed — tag ${fmtN(n)} as PURGED`; }
    };
  }
  // after each database: continue with the same list on another one, or end
  async function drawPurgeNext() {
    const p = purge, left = DB_TABS.filter(([k]) => !p.done[k]);
    const last = p.done[p.db];
    const lastMsg = last ? (last.msg ? `<div class="notice ok"><b>Done</b>${esc(last.msg)}</div>` : `<div class="notice">${esc(dbLabel(p.db))}: ${last.skipped ? 'not purged' : 'nothing to purge'}.</div>`) : '';
    const summary = `<section class="block"><h3>Purge finished</h3>${purgeSteps()}
        <p class="hint">Total tagged PURGED: <b>${fmtN(Object.values(p.done).reduce((a, d) => a + d.n, 0))}</b>. Everything is recorded in the ADMIN LOG.</p>
        <button class="btn dark" id="pNew" style="max-width:260px">Purge another list</button></section>`;
    if (p.stage === 'end' || !left.length) {
      body().innerHTML = lastMsg + (left.length ? '' : '<div class="notice">All three databases were checked with this list.</div>') + summary;
      $('#pNew').onclick = () => { purgeReset(); toolPurge(); }; return;
    }
    body().innerHTML = `${lastMsg}${purgeSteps()}<section class="block"><h3>Continue with the same list?</h3>
      <p class="hint" style="margin-top:0">Use <b>${esc(p.src || 'the pasted codes')}</b> (${fmtN(p.codes.length)} code${p.codes.length === 1 ? '' : 's'}) on another database, or end here.</p>
      <div class="pnext">${left.map(([k, l]) => `<button class="pick" data-next="${k}"><span>${esc(l)}</span><small id="pn-${k}"><i class="spinner"></i>matching…</small></button>`).join('')}
        <button class="pick end" id="pEnd"><span>End</span><small>I'm done purging</small></button></div></section>`;
    $('#pEnd').onclick = () => { p.stage = 'end'; toolPurge(); };
    view.querySelectorAll('[data-next]').forEach(b => b.onclick = () => { p.db = b.dataset.next; p.stage = 'confirm'; p.preview = null; toolPurge(); purgeCheck(); });
    // show how many each remaining database would purge (same list)
    left.forEach(async ([k]) => {
      try { const r = p.previews[k] || (p.previews[k] = await api('adminPurgePreview', { token: session.portalToken, db: k, codes: p.codes }, 120000));
        const el = $('#pn-' + k); if (el) el.innerHTML = r.purge.length ? `<strong>${fmtN(r.purge.length)}</strong> will be purged` : 'nothing to purge';
      } catch (e) { const el = $('#pn-' + k); if (el) el.textContent = e.message; }
    });
  }

  /* ---------- Restore purged touchpoints to ACTIVE (Frederick, 27 Nov 2026; ADMIN and DEPT) ----------
     Choose a database → type/paste the Sales Codes or upload a file with a SALESCODE column → see which PURGED records will be
     restored → reason → Restore. Codes that already have an ACTIVE record are skipped. Recorded in the ADMIN LOG. */
  const rest = { db: '', codes: [], src: '', how: '', preview: null, result: null, matched: false };
  function restoreReset() { Object.assign(rest, { db: '', codes: [], src: '', how: '', preview: null, result: null, matched: false }); }
  function toolRestore() {
    const p = rest;
    if (p.result) {
      body().innerHTML = `<div class="notice ${p.matched ? 'ok' : 'warn'}"><b>${p.matched ? 'Done' : 'Restored — UPDATE TABLES pending'}</b>${esc(p.result)}</div>
        <p class="hint">Recorded in the ADMIN LOG.</p>
        <button class="btn dark" id="rNew" style="max-width:260px">Restore another list</button>`;
      $('#rNew').onclick = () => { restoreReset(); toolRestore(); }; return;
    }
    body().innerHTML = `<section class="block"><h3>1 · Which database?</h3>
        <div class="seg">${DB_TABS.map(([k, l]) => `<button data-rdb="${k}" class="${p.db === k ? 'on' : ''}">${l}</button>`).join('')}</div></section>
      <section class="block" ${p.db ? '' : 'hidden'}><h3>2 · Sales Codes to restore to ACTIVE</h3>
        <p class="hint" style="margin-top:0">Type or paste one or more Sales Codes, or upload an Excel, CSV or Word file. 🔒 A file must have a column headed <b>SALESCODE</b> — only that column is read.</p>
        <label for="rPaste">Sales Code(s)</label><textarea id="rPaste" rows="3" placeholder="ABC1234526&#10;XYZ0001226">${p.src ? '' : esc(p.codes.join('\n'))}</textarea>
        <label for="rFile">…or upload a list</label><input type="file" id="rFile" accept=".xlsx,.xlsm,.xlsb,.xls,.ods,.csv,.tsv,.txt,.docx,.docm,.dotx"><div id="rErr"></div>
        ${p.src ? `<div class="hint ok">✓ ${esc(p.src)} — ${fmtN(p.codes.length)} Sales Code${p.codes.length === 1 ? '' : 's'} read from the ${esc(p.how)}</div>` : ''}
        <button class="btn dark" id="rPrev" style="max-width:300px;margin-top:12px">Find in ${esc(dbLabel(p.db))} · Purged</button></section>
      <div id="rResult"></div>`;
    view.querySelectorAll('[data-rdb]').forEach(b => b.onclick = () => { p.db = b.dataset.rdb; p.preview = null; toolRestore(); });
    if (!p.db) return;
    if (p.preview) drawRestorePreview();
    $('#rFile').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      $('#rFile').disabled = true; toast('Reading ' + f.name + '…', 2500);
      try {
        const r = await readCodesFromFile(f), codes = uniqCodes(r.codes);
        if (!codes.length) throw new Error('No Sales Codes were found in this file.');
        if (codes.length > PURGE_MAX) throw new Error(`The file has ${fmtN(codes.length)} codes — the limit is ${fmtN(PURGE_MAX)}.`);
        Object.assign(p, { codes, src: f.name, how: r.how, preview: null }); toolRestore();
      } catch (err) { Object.assign(p, { codes: [], src: '', how: '', preview: null }); toolRestore(); $('#rErr').innerHTML = `<div class="notice bad"><b>File rejected</b>${esc(err.message)}</div>`; }
    };
    $('#rPaste').oninput = e => { Object.assign(p, { src: '', how: 'pasted', preview: null }); p.codes = uniqCodes(e.target.value.split(/[\s,;]+/)); $('#rResult').innerHTML = ''; };
    $('#rPrev').onclick = async () => {
      if (!p.codes.length) return toast('Type or upload the Sales Codes first.');
      const btn = $('#rPrev'), label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Finding…';
      try { p.preview = await api('adminRestorePreview', { token: session.portalToken, db: p.db, codes: p.codes }, 120000); drawRestorePreview(); }
      catch (e) { toast(e.message, 5000); }
      btn.disabled = false; btn.innerHTML = label;
    };
  }
  function drawRestorePreview() {
    const p = rest, r = p.preview, n = r.restore.length, nf = r.notFound.length;
    $('#rResult').innerHTML = `<section class="block"><h3>3 · Found in ${esc(r.label)}</h3>
      <div class="pbig ${n ? '' : 'none'}"><b>${fmtN(n)}</b> purged ${esc(r.label)} record${n === 1 ? '' : 's'} will be restored to <b>ACTIVE</b></div>
      ${n ? `<p class="hint" style="margin-top:0">The matching record in UPDATE TABLES is restored too (taken off the PURGED tab and put back in the active tab).</p>` : ''}
      <div class="stats">
        <div class="stat"><div class="lbl">Already active</div><div class="num">${fmtN(r.active.length)}</div><div class="sub">no change</div></div>
        <div class="stat"><div class="lbl">Not in ${esc(r.label)}</div><div class="num">${fmtN(nf)}</div><div class="sub">may be in another database</div></div>
      </div>
      ${r.active.length ? `<p class="hint" style="margin-top:12px">Already active: ${r.active.slice(0, 60).map(x => esc(x.code)).join(', ')}${r.active.length > 60 ? ' …' : ''}</p>` : ''}
      ${nf ? `<p class="hint">Not in ${esc(r.label)}: ${r.notFound.slice(0, 60).map(esc).join(', ')}${nf > 60 ? ' …' : ''}</p>` : ''}
      ${n ? `<div class="expand scroll" style="max-height:340px"><table class="data"><thead><tr><th>Sales Code</th><th>Partner</th><th>Name</th><th>Purged on</th></tr></thead><tbody>
          ${r.restore.slice(0, 500).map(x => `<tr><td><b>${esc(x.code)}</b></td><td>${esc(x.partner)}</td><td>${esc(x.name)}</td><td>${esc(x.purged || '—')}</td></tr>`).join('')}</tbody></table></div>
        ${n > 500 ? `<p class="hint">Showing the first 500 of ${fmtN(n)}.</p>` : ''}
        <label for="rWhy">Reason for restoring <span class="req">REQUIRED</span></label>
        <textarea id="rWhy" rows="2" maxlength="300" placeholder="e.g. Purged by mistake / partner reactivated the store"></textarea>
        <div class="pact"><button class="btn" id="rApply">Restore ${fmtN(n)} to ACTIVE</button></div>`
      : `<div class="notice warn" style="margin-top:12px">None of these codes are purged in ${esc(r.label)} — nothing to restore.</div>`}
    </section>`;
    const a = $('#rApply'); if (!a) return;
    a.onclick = async () => {
      const why = $('#rWhy').value.trim();
      if (why.length < 5) { $('#rWhy').classList.add('missing'); $('#rWhy').focus(); return toast('Please give the reason for restoring.'); }
      if (!confirm(`Restore ${n} ${r.label} record(s) to ACTIVE?\n\nThe purge date is cleared, and the matching record in UPDATE TABLES is restored too. This is recorded in the ADMIN LOG.`)) return;
      a.disabled = true; a.innerHTML = '<span class="spinner"></span>Restoring here and in UPDATE TABLES…';
      try {
        const res = await api('adminRestoreApply', { token: session.portalToken, db: p.db, codes: r.restore.map(x => x.code), reason: why }, 300000);
        ['ACTIVE', 'PURGED'].forEach(s2 => { delete DBC[p.db + ':' + s2]; IDB.put(p.db + ':' + s2, null); });
        dash = null; p.result = res.message; p.matched = !!res.matched; toolRestore();
      } catch (e) { toast(e.message, 6000); a.disabled = false; a.innerHTML = `Restore ${fmtN(n)} to ACTIVE`; }
    };
  }

  /* ---------- Redirect a request ---------- */
  let people = null;
  async function toolRedirect() {
    body().innerHTML = `<p class="hint"><span class="spinner"></span>Loading requests waiting for approval…</p>`;
    let items;
    try {
      const [a, b] = await Promise.all([api('adminPending', { token: session.portalToken }, 60000), people ? { people } : api('adminApprovers', { token: session.portalToken }, 60000)]);
      items = a.items; people = b.people;
    } catch (e) { body().innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    if (tab !== 'tools' || toolsSection !== 'redirect') return;
    body().innerHTML = `<section class="block"><h3>Requests waiting for an approver</h3>
      <p class="hint" style="margin-top:0">Use this when the approver can't act (e.g. on leave) and the user asked you by call, text or email. The new approver gets the email; the old link stops working.</p>
      ${items.length ? `<div class="expand scroll"><table class="data"><thead><tr><th>Request</th><th>Partner · Requestor</th><th>Now with</th><th>Waiting</th><th></th></tr></thead><tbody>
        ${items.map((i, n) => `<tr><td><b>${esc(i.trade || i.salescode)}</b><small>${esc(i.id)} · ${esc(i.action)}</small></td>
          <td>${esc(i.partner)}<small>${esc(i.requestor)}</small></td>
          <td>${esc(i.approver)} <span class="muted">(${esc(i.role)})</span><small>${esc(i.email)} · step ${esc(i.step)}${i.redirected ? ' · redirected before' : ''}</small></td>
          <td class="${i.waitingDays >= 3 ? 'late' : ''}">${days(i.waitingDays)}</td>
          <td><button class="refresh" data-rd="${n}">Redirect…</button></td></tr>
          <tr class="rdform" id="rd${n}" hidden><td colspan="5"></td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty"><div class="big">✓</div><b>No requests are waiting for an approver.</b></div>'}</section>`;
    view.querySelectorAll('[data-rd]').forEach(b => b.onclick = () => openRedirect(items[Number(b.dataset.rd)], Number(b.dataset.rd)));
  }
  function openRedirect(i, n) {
    view.querySelectorAll('.rdform').forEach(r => { r.hidden = true; r.firstElementChild.innerHTML = ''; });
    const row = $('#rd' + n); row.hidden = false;
    row.firstElementChild.innerHTML = `<div class="rdbox">
      <b>Redirect ${esc(i.id)}</b> — now with ${esc(i.approver)} (${esc(i.role)})
      <div class="filters-row" style="margin:10px 0 0">
        <label class="f grow"><span>New approver</span><select id="rdWho"><option value="">— choose —</option>
          ${people.filter(p2 => p2.name.toUpperCase() !== i.approver.toUpperCase()).map((p2, k) => `<option value="${k}">${esc(p2.name)} · ${esc(p2.position)} · ${esc(p2.email)}</option>`).join('')}
          <option value="other">Someone else (type name and email)…</option></select></label>
        <label class="f" id="rdNameL" hidden><span>Name</span><input id="rdName" type="text"></label>
        <label class="f" id="rdEmailL" hidden><span>Office email</span><input id="rdEmail" type="email"></label>
      </div>
      <label for="rdWhy">Reason <span class="req">*</span></label>
      <textarea id="rdWhy" rows="2" placeholder="e.g. RSM on leave until Dec 5 — requested by Juan (TSM) via call"></textarea>
      <div class="row-btns" style="max-width:520px"><button class="btn ghost" id="rdCancel">Cancel</button><button class="btn" id="rdGo">Redirect</button></div></div>`;
    const list = people.filter(p2 => p2.name.toUpperCase() !== i.approver.toUpperCase());
    $('#rdWho').onchange = e => { const o = e.target.value === 'other'; $('#rdNameL').hidden = !o; $('#rdEmailL').hidden = !o; };
    $('#rdCancel').onclick = () => { row.hidden = true; };
    $('#rdGo').onclick = async () => {
      const w = $('#rdWho').value, reason = $('#rdWhy').value.trim();
      const to = w === 'other' ? { name: $('#rdName').value.trim(), email: $('#rdEmail').value.trim() } : w !== '' ? list[Number(w)] : null;
      if (!to || !to.name || !to.email) return toast('Choose the new approver.');
      if (!reason) return toast('Please write the reason.');
      if (!confirm(`Redirect ${i.id} from ${i.approver} to ${to.name}?`)) return;
      const b = $('#rdGo'); b.disabled = true; b.innerHTML = '<span class="spinner"></span>Redirecting…';
      try { const r = await api('adminRedirect', { token: session.portalToken, id: i.id, s: i.s, v: i.v, toName: to.name, toEmail: to.email, reason }, 90000);
        toast(r.message, 5000); dash = null; toolRedirect(); }
      catch (e) { toast(e.message, 6000); b.disabled = false; b.innerHTML = 'Redirect'; }
    };
  }

  /* ---------- Edit tables ---------- */
  const ed = { table: '', data: null, edits: {}, adds: [], dels: new Set() };
  const TABLES = [['ROUTING MATRIX', 'Routing Matrix'], ['CODE MATRIX', 'Code Matrix'], ['CLASS MAP', 'Class Map']];
  const colLetter = i => { let s2 = ''; i++; while (i) { const m = (i - 1) % 26; s2 = String.fromCharCode(65 + m) + s2; i = Math.floor((i - 1) / 26); } return s2; };
  const pending = () => Object.keys(ed.edits).length + ed.adds.filter(r => r.some(Boolean)).length + ed.dels.size;
  async function toolTables(reload) {
    if (!ed.table) {
      body().innerHTML = `<section class="block"><h3>Which table?</h3><div class="seg">${TABLES.map(([k, l]) => `<button data-tb="${k}">${l}</button>`).join('')}</div>
        <p class="hint">Changes are saved straight to the sheet and written to the ADMIN LOG.</p></section>`;
      view.querySelectorAll('[data-tb]').forEach(b => b.onclick = () => { ed.table = b.dataset.tb; ed.data = null; toolTables(); });
      return;
    }
    if (!ed.data || reload) {
      body().innerHTML = `<p class="hint"><span class="spinner"></span>Loading ${esc(ed.table)}…</p>`;
      try { ed.data = await api('adminTableGet', { token: session.portalToken, table: ed.table }, 60000); ed.edits = {}; ed.adds = []; ed.dels = new Set(); }
      catch (e) { body().innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    }
    drawTable();
  }
  function drawTable() {
    const d = ed.data, w = d.header.length;
    const cell = (r, c, v) => `<td><input data-r="${r}" data-c="${c}" value="${esc(ed.edits[r + ':' + c] != null ? ed.edits[r + ':' + c] : v)}" class="${ed.edits[r + ':' + c] != null ? 'chg' : ''}"></td>`;
    body().innerHTML = `<section class="block">
      <div class="bar"><button class="refresh" id="tbBack">‹ Tables</button><h2 style="font-size:18px">${esc(d.table)}</h2>
        <input type="search" id="tbQ" placeholder="Find…" style="max-width:220px;min-height:40px;padding:8px 10px;font-size:14px"></div>
      <p class="hint" style="margin-top:0">${esc(d.note)}</p>
      <div class="tablewrap" style="max-height:62vh"><table class="data db grid-edit"><thead><tr><th>#</th>${d.header.map((h, c) => `<th>${colLetter(c)} · ${esc(h || '(blank)')}</th>`).join('')}${d.rowDelete ? '<th></th>' : ''}</tr></thead><tbody>
        ${d.rows.map((r, i) => `<tr data-row="${i}" class="${ed.dels.has(i) ? 'del' : ''}"><td class="muted">${i + 2}</td>${Array.from({ length: w }, (_, c) => cell(i, c, r[c] || '')).join('')}
          ${d.rowDelete ? `<td><button class="x" data-del="${i}" title="Delete row">${ed.dels.has(i) ? '↺' : '✕'}</button></td>` : ''}</tr>`).join('')}
        ${ed.adds.map((r, k) => `<tr class="add"><td class="muted">new</td>${Array.from({ length: w }, (_, c) => `<td><input data-a="${k}" data-c="${c}" value="${esc(r[c] || '')}" class="chg"></td>`).join('')}${d.rowDelete ? `<td><button class="x" data-rmadd="${k}">✕</button></td>` : ''}</tr>`).join('')}
      </tbody></table></div>
      <div class="listbar" style="margin-top:12px"><button class="refresh" id="tbAdd">+ Add row</button><span style="flex:1"></span>
        <span id="tbCount" class="muted">${pending() ? pending() + ' unsaved change(s)' : 'No changes'}</span>
        <button class="refresh" id="tbUndo" ${pending() ? '' : 'disabled'}>Discard</button>
        <button class="btn mini" id="tbSave" ${pending() ? '' : 'disabled'}>Save changes</button></div></section>`;
    const upd = () => { const n = pending(); $('#tbCount').textContent = n ? n + ' unsaved change(s)' : 'No changes'; $('#tbSave').disabled = !n; $('#tbUndo').disabled = !n; };
    body().querySelectorAll('input[data-r]').forEach(inp => inp.oninput = () => {
      const r = Number(inp.dataset.r), c = Number(inp.dataset.c), k = r + ':' + c, orig = d.rows[r][c] || '';
      if (inp.value === orig) { delete ed.edits[k]; inp.classList.remove('chg'); } else { ed.edits[k] = inp.value; inp.classList.add('chg'); }
      upd();
    });
    body().querySelectorAll('input[data-a]').forEach(inp => inp.oninput = () => { ed.adds[Number(inp.dataset.a)][Number(inp.dataset.c)] = inp.value; upd(); });
    body().querySelectorAll('[data-del]').forEach(b => b.onclick = () => { const i = Number(b.dataset.del); ed.dels.has(i) ? ed.dels.delete(i) : ed.dels.add(i); drawTable(); });
    body().querySelectorAll('[data-rmadd]').forEach(b => b.onclick = () => { ed.adds.splice(Number(b.dataset.rmadd), 1); drawTable(); });
    $('#tbAdd').onclick = () => { ed.adds.push(new Array(w).fill('')); drawTable(); const last = body().querySelector('tr.add:last-child input'); if (last) last.focus(); };
    $('#tbBack').onclick = () => { if (pending() && !confirm('Discard your unsaved changes?')) return; ed.table = ''; ed.data = null; toolTables(); };
    $('#tbUndo').onclick = () => { if (confirm('Discard all unsaved changes?')) { ed.edits = {}; ed.adds = []; ed.dels = new Set(); drawTable(); } };
    $('#tbQ').oninput = e => { const q = e.target.value.trim().toUpperCase();
      body().querySelectorAll('tr[data-row]').forEach(tr => { tr.hidden = q && ![...tr.querySelectorAll('input')].some(x => x.value.toUpperCase().includes(q)); }); };
    $('#tbSave').onclick = async () => {
      const edits = Object.entries(ed.edits).map(([k, v]) => { const [r, c] = k.split(':').map(Number); return { r, c, v }; });
      const adds = ed.adds.filter(r => r.some(Boolean)), deletes = [...ed.dels];
      if (!confirm(`Save to ${d.table}?\n\n${edits.length} cell(s) changed · ${adds.length} row(s) added · ${deletes.length} row(s) deleted`)) return;
      const b = $('#tbSave'); b.disabled = true; b.innerHTML = '<span class="spinner"></span>Saving…';
      try { const r = await api('adminTableSave', { token: session.portalToken, table: d.table, sig: d.sig, edits, adds, deletes }, 120000); toast(r.message, 5000); toolTables(true); }
      catch (e) { toast(e.message, 7000); b.disabled = false; b.innerHTML = 'Save changes'; }
    };
  }

  /* ---------- System status ---------- */
  async function toolStatus(data) {
    if (!data) {
      body().innerHTML = `<p class="hint"><span class="spinner"></span>Checking…</p>`;
      try { data = await api('adminStatus', { token: session.portalToken }, 60000); }
      catch (e) { body().innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
      if (tab !== 'tools' || toolsSection !== 'status') return;
    }
    const o = data.outbox;
    body().innerHTML = `<section class="block"><h3>Email</h3>
        <div class="stats">
          <div class="stat ${data.emailsLeft <= 15 ? 'dth' : ''}"><div class="lbl">Emails left today</div><div class="num">${fmtN(data.emailsLeft)}</div><div class="sub">${data.reserve} kept for alerts</div></div>
          <div class="stat"><div class="lbl">On hold (waiting to send)</div><div class="num">${fmtN(o.pending)}</div><div class="sub">resent every hour automatically</div></div>
          <div class="stat"><div class="lbl">Failed</div><div class="num">${fmtN(o.failed)}</div><div class="sub">gave up after 12 tries</div></div>
          <div class="stat"><div class="lbl">Sent from hold today</div><div class="num">${fmtN(o.sentToday)}</div><div class="sub">&nbsp;</div></div>
        </div>
        ${o.items.length ? `<div class="expand scroll" style="max-height:300px"><table class="data"><thead><tr><th>Held since</th><th>Request</th><th>To</th><th>Status</th><th>Last error</th></tr></thead><tbody>
          ${o.items.map(x => `<tr><td>${x.at ? new Date(x.at).toLocaleString() : ''}</td><td>${esc(x.id)}<small>${esc(x.subject)}</small></td><td>${esc(x.to)}</td><td>${esc(x.status)} <span class="muted">(${esc(x.attempts)} tries)</span></td><td><small>${esc(x.error)}</small></td></tr>`).join('')}
          </tbody></table></div>` : '<p class="hint">No emails on hold. ✓</p>'}
        <button class="refresh" id="stRetry" style="margin-top:10px" ${o.pending ? '' : 'disabled'}>Send held emails now</button>
        <p class="hint">Hourly timers: resend held emails ${data.triggers.retryEmails ? '✓' : '✗ <b>missing — run setup()</b>'} · move requests when a partner changes TSM ${data.triggers.syncAssignments ? '✓' : '✗ <b>missing — run setup()</b>'}</p>
      </section>
      <section class="block"><h3>Partners with no TSM (${fmtN(data.noTsm.length)})</h3>
        <p class="hint" style="margin-top:0">In GRID but with no user (or a TBH) in HANDLES. Their requests can't be transferred automatically.</p>
        ${data.noTsm.length ? `<div class="expand scroll" style="max-height:300px"><table class="data"><thead><tr><th>Partner</th><th>HANDLES</th></tr></thead><tbody>
          ${data.noTsm.map(x => `<tr><td>${esc(x.partner)}</td><td>${esc(x.handles)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="hint">Every partner has a TSM. ✓</p>'}
      </section>
      <button class="refresh" id="stReload">↻ Refresh</button>`;
    $('#stReload').onclick = () => toolStatus();
    const r = $('#stRetry'); if (r) r.onclick = async () => { r.disabled = true; r.innerHTML = '<span class="spinner"></span>Sending…';
      try { toolStatus(await api('adminRetryEmails', { token: session.portalToken }, 300000)); toast('Done.'); } catch (e) { toast(e.message, 5000); r.disabled = false; r.innerHTML = 'Send held emails now'; } };
  }

  /* ---------- RETURNED (sent back to the requestor) — for follow-up ---------- */
  async function countReturned() {
    try { retItems = (await api('adminReturned', { token: session.portalToken }, 45000)).items; retLoaded = true;
      const c = $('#retCount'); c.textContent = retItems.length; c.hidden = !retItems.length;
      if (tab === 'returned' && $('#retList')) drawReturned();
      drawFab(); } catch (e) {}
  }
  async function renderReturned() {
    view.innerHTML = `<p class="hint"><span class="spinner"></span>Loading returned requests…</p>`;
    await countReturned();
    if (tab === 'returned') drawReturned();
  }
  function drawReturned() {
    const n = k => retItems.filter(i => k === 'ALL' || i.kind === k).length;
    const list = retItems.filter(i => retFilter === 'ALL' || i.kind === retFilter);
    view.innerHTML = `${backBtn()}<div class="bar"><h2>Returned to requestor</h2><button class="refresh" id="retRefresh">↻ Refresh</button></div>
      <p class="hint" style="margin:-6px 0 12px">Requests sent back for correction and not yet resent. Longest waiting first — follow up with the TSM.</p>
      <div class="chips">${[['ALL', 'All'], ['NEW', 'New touchpoints'], ['AMEND', 'Amendments']].map(([k, l]) =>
        `<button class="chip ${retFilter === k ? 'on' : ''}" data-rf="${k}">${l}<b class="${n(k) ? '' : 'zero'}">${n(k)}</b></button>`).join('')}</div>
      <div id="retList">${list.length ? `<div class="expand scroll"><table class="data"><thead><tr><th>Request</th><th>Requestor</th><th>Returned by</th><th>What to correct</th><th>Waiting</th><th></th></tr></thead><tbody>
        ${list.map(i => `<tr><td><b>${esc(i.trade || i.salescode)}</b><small>${esc(i.id)} · ${esc(i.action)}</small><small>${esc(i.partner)}</small></td>
          <td>${esc(i.requestor)}${i.requestorEmail ? `<small><a href="mailto:${esc(i.requestorEmail)}?subject=${encodeURIComponent('Follow-up: ' + i.id + ' returned for correction')}">${esc(i.requestorEmail)}</a></small>` : ''}</td>
          <td>${esc(i.returnedBy)}<small>${i.returnedAt ? new Date(i.returnedAt).toLocaleString() : ''}</small></td>
          <td style="max-width:320px;white-space:normal">${esc(i.reason)}</td>
          <td class="${i.days >= 3 ? 'late' : ''}">${days(i.days)}</td>
          <td><button class="refresh" data-rview="${esc(i.id)}">View</button></td></tr>`).join('')}</tbody></table></div>`
        : `<div class="empty"><div class="big">✓</div><b>No returned requests waiting.</b></div>`}</div>`;
    view.querySelectorAll('[data-rf]').forEach(b => b.onclick = () => { retFilter = b.dataset.rf; drawReturned(); });
    view.querySelectorAll('[data-rview]').forEach(b => b.onclick = () => openApproval(b.dataset.rview, 'returned'));
    $('#retRefresh').onclick = () => renderReturned();
  }

  /* ---------- Floating buttons (Channel Dev / DEPT only) ---------- */
  function drawFab() {
    const f = $('#fab');
    const dept = !!session && session.user.role === 'DEPT';
    const dlOn = !!session && tab === 'databases' && !!dl;
    document.body.classList.toggle('dept-fab', dept);
    document.body.classList.toggle('has-fab', dept || dlOn);
    if (!dept && !dlOn) { f.hidden = true; f.innerHTML = ''; return; }
    const cnt = (arr, k) => arr.filter(i => i.kind === k).length;
    const btns = dept ? [
      ['refresh', '↻', 'Refresh', null, 'Refresh counts and this page'],
      ['apprNEW', 'New', 'New requests for approval', cnt(apprItems, 'NEW'), 'New touchpoint requests waiting for CHANNEL DEV DIST'],
      ['retNEW', 'New ↩', 'New requests returned', cnt(retItems, 'NEW'), 'New touchpoint requests returned to the requestor'],
      ['apprAMEND', 'Amend', 'Amendments for approval', cnt(apprItems, 'AMEND'), 'Amendments waiting for CHANNEL DEV DIST'],
      ['retAMEND', 'Amend ↩', 'Amendments returned to sender', cnt(retItems, 'AMEND'), 'Amendments returned to the requestor']] : [];
    let html = btns.map(([k, short, long, n, tip]) => `<button class="fb fb-${k} ${n === 0 ? 'zero' : ''}" data-fab="${k}" title="${esc(tip)}">
        ${n == null ? `<span class="ic">${short}</span>` : `<b class="n ${n ? 'ring' : ''}">${fmtN(n)}</b>`}<span class="lb">${long}</span></button>`).join('');
    if (dlOn) {
      const n = dl.list.length, what = `${dl.D.label} · ${dbState.status === 'ACTIVE' ? 'Active' : 'Purged'}${dl.filtered ? ' · filtered' : ''}`;
      html += `<button class="fb fb-xlsx" id="dbXlsx" ${n ? '' : 'disabled'} title="Downloads exactly the list shown on screen: ${esc(what)} — ${fmtN(n)} row(s), all columns">
        <span class="ic xl" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 2.5h8l5 5v14H6z" fill="#fff" stroke="#107C41" stroke-width="1.4" stroke-linejoin="round"/>
          <path d="M14 2.5v5h5" fill="none" stroke="#107C41" stroke-width="1.4" stroke-linejoin="round"/>
          <path d="M8.5 11h8M8.5 14h8M8.5 17h8M12 11v6.5" stroke="#107C41" stroke-width="1.3"/></svg></span>
        <span class="lb"><span class="t">Download database</span><small>${esc(what)} · ${fmtN(n)} row${n === 1 ? '' : 's'} as shown</small></span></button>`;
    }
    f.innerHTML = html; f.hidden = false;
    const x = $('#dbXlsx'); if (x) x.onclick = () => downloadXlsx(dl.D, dl.list);
    f.querySelectorAll('[data-fab]').forEach(b => b.onclick = async () => {
      const k = b.dataset.fab;
      if (k === 'refresh') {
        b.disabled = true; b.querySelector('.ic').innerHTML = '<span class="spinner"></span>';
        await Promise.all([countApprovals(), countReturned()]);
        if (tab === 'dashboard') renderDashboard(true); else if (tab === 'databases') renderDatabases(true);
        else if (tab === 'approvals' && !$('.detail')) drawApprovals(); else if (tab === 'returned' && !$('.detail')) drawReturned();
        toast('Updated ✓', 1500); return;
      }
      if (k.startsWith('appr')) { apprFilter = k.slice(4); goTab('approvals'); }
      else { retFilter = k.slice(3); goTab('returned'); }
    });
  }

  if (!CFG.API_URL) view.innerHTML = '<div class="notice bad">API_URL is not set in config.js.</div>';
  else if (session && session.portalToken) start(); else renderLogin();
})();
