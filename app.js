/* Touchpoints Request — phone app (Phase 1: Register New Touchpoint) */
(() => {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const $ = s => document.querySelector(s);
  const view = $('#view');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const key = s => String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normCode = s => String(s || '').toUpperCase().replace(/\s+/g, '');
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = 'none', ms || 3200); }

  const DEVICE_ID = ls.get('deviceId') || (() => { const d = 'D-' + uid(); ls.set('deviceId', d); return d; })();
  let session = ls.get('session', null);   // {token, user:{name, position}}
  let boot = null;                          // reference data from the server (partners, classes, codes)
  let draft = null;                         // the request being filled in
  let syncing = false;

  /* ======================= SERVER CALLS ======================= */
  class ApiError extends Error { constructor(msg, code) { super(msg); this.code = code; } }
  const isNetErr = e => !(e instanceof ApiError);

  async function api(action, data, timeoutMs) {
    if (!CFG.API_URL || /PASTE_YOUR/.test(CFG.API_URL)) throw new ApiError('App not connected yet: the API_URL in config.js is empty.', 'SETUP');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs || 45000);
    let res;
    try {
      res = await fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify(Object.assign({ action }, data)),
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: ctl.signal });
    } finally { clearTimeout(t); }
    let j;
    try { j = await res.json(); } catch (e) { throw new Error('Bad response from server'); }
    if (!j.ok) {
      if (j.code === 'AUTH') { logout(true); }
      throw new ApiError(j.error || 'Request failed', j.code);
    }
    return j;
  }

  /* ======================= PHONE STORAGE (works offline) ======================= */
  const DB = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((resolve, reject) => {
        const r = indexedDB.open('touchpoints-request', 1);
        r.onupgradeneeded = () => { r.result.createObjectStore('queue', { keyPath: 'clientId' }); r.result.createObjectStore('draft'); };
        r.onsuccess = () => { this.db = r.result; resolve(this.db); };
        r.onerror = () => reject(r.error);
      });
    },
    async run(store, mode, fn) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode); const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Storage full'));
      });
    },
    put(store, v, k) { return this.run(store, 'readwrite', s => k === undefined ? s.put(v) : s.put(v, k)); },
    get(store, k) { return this.run(store, 'readonly', s => s.get(k)); },
    del(store, k) { return this.run(store, 'readwrite', s => s.delete(k)); },
    all(store) { return this.run(store, 'readonly', s => s.getAll()); }
  };
  const saveDraft = () => { if (draft) DB.put('draft', draft, 'current').catch(() => {}); };
  const clearDraft = () => DB.del('draft', 'current').catch(() => {});

  /* ======================= NETWORK PILL / MENU / INSTALL ======================= */
  function setNet() {
    const on = navigator.onLine;
    $('#net').textContent = on ? '● Online' : '● Offline';
    $('#net').className = 'net' + (on ? '' : ' off');
  }
  window.addEventListener('online', () => { setNet(); refreshBoot(); sync(); });
  window.addEventListener('offline', setNet);
  $('#menuBtn').onclick = e => { e.stopPropagation(); $('#menu').hidden = !$('#menu').hidden; };
  document.addEventListener('click', () => { $('#menu').hidden = true; });
  $('#logoutBtn').onclick = () => { if (confirm('Log out from this phone?')) logout(); };
  $('#refreshBtn').onclick = async () => { toast('Updating…'); await refreshBoot(true); };

  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#installBar').hidden = false; });
  $('#installBtn').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#installBar').hidden = true; };
  window.addEventListener('appinstalled', () => { $('#installBar').hidden = true; toast('Installed ✓ Open it from your home screen'); });

  // iPhone/iPad: Safari has no install button, so show how to add it to the home screen.
  (function iosInstallHint() {
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const installed = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    if (!isIOS || installed) return;
    const until = ls.get('iosHintHiddenUntil', 0);
    if (until && Date.now() < until) return;
    const inApp = /FBAN|FBAV|Instagram|Line\/|Viber|Messenger|MicroMessenger|GSA\//i.test(ua);
    const bar = $('#installBar');
    bar.querySelector('span').innerHTML = inApp
      ? '<b>To install:</b> open this page in <b>Safari</b> first (tap ••• → Open in Safari).'
      : '<b>To install:</b> tap <b>•••</b> (or <b>Share ⬆</b>) → <b>Share</b> → <b>Add to Home Screen</b> → <b>Add</b>.';
    $('#installBtn').hidden = true;
    const x = document.createElement('button');
    x.textContent = '✕'; x.setAttribute('aria-label', 'Hide');
    x.style.cssText = 'margin-left:auto;background:none;color:#4A4A4A;border:0;font-size:18px;padding:4px 8px';
    x.onclick = () => { bar.hidden = true; ls.set('iosHintHiddenUntil', Date.now() + 7 * 864e5); };
    bar.appendChild(x);
    bar.hidden = false;
  })();

  /* ======================= GPS ======================= */
  let gps = null, gpsErr = null, watching = false;
  function startGps() {
    if (watching || !navigator.geolocation) { if (!navigator.geolocation) gpsErr = { code: 2 }; return; }
    watching = true;
    navigator.geolocation.watchPosition(p => {
      gps = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy), at: Date.now() };
      gpsErr = null;
      if (draft && draft.image && draft.lat == null) { lockGps(); }
      refreshGpsBox();
    }, err => { gpsErr = err; refreshGpsBox(); }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 60000 });
  }
  function lockGps() { draft.lat = gps.lat; draft.lng = gps.lng; draft.acc = gps.acc; saveDraft(); if (stepName() === 'photo') render(); }

  function gpsBoxHtml() {
    if (gpsErr && gpsErr.code === 1) return `<div class="notice bad"><b>Location is blocked for this app</b>
      Payagan ang Location: i-tap ang 🔒 o ⓘ sa taas ng screen → Permissions → Location → <b>Allow</b>. Then reopen the app.</div>`;
    if (gpsErr && !gps) return `<div class="notice bad"><b>Location is OFF</b>
      <ol><li>I-swipe pababa mula sa taas ng screen.</li><li>I-tap ang <b>Location</b> para i-ON.</li><li>Lumabas sa bukas na lugar at maghintay ng ilang segundo.</li></ol></div>`;
    if (!gps) return `<div class="notice warn"><span class="spinner"></span>Getting your location… Stay in an open area.</div>`;
    const good = gps.acc <= 50;
    return `<div class="notice ${good ? 'ok' : 'warn'}">${good ? '✓' : '⚠'} Location ready ±${gps.acc} m${good ? '' : ' — weak GPS, step outside if you can'}</div>`;
  }
  function refreshGpsBox() { const b = $('#gpsBox'); if (b) b.innerHTML = gpsBoxHtml(); }

  /* ======================= AUTH / REFERENCE DATA ======================= */
  function logout(expired) {
    session = null; boot = null; myReqs = null; ls.del('session'); ls.del('recent'); ls.del('myReqs');
    $('#menuBtn').hidden = true; $('#who').textContent = '';
    if (expired) toast('Please log in again.');
    renderLogin();
  }

  async function refreshBoot(manual) {
    if (!session || !navigator.onLine) { if (manual) toast('No signal — using the data saved on this phone.'); return; }
    try {
      const b = await api('bootstrap', { token: session.token }, 60000);
      boot = b; ls.set('boot:' + key(session.user.name), b);
      if (manual) toast('Data updated ✓');
      if (stepName() === 'home') render();
    } catch (e) { if (manual || !boot) toast(isNetErr(e) ? 'Could not reach the server.' : e.message, 5000); }
  }

  function renderLogin() {
    view.innerHTML = `<div class="card">
      <h2>Log in</h2>
      <p class="hint" style="margin-top:0">Use the password given to you by the admin.</p>
      <label for="pw">Password</label>
      <input type="password" id="pw" autocomplete="current-password">
      <label class="check" style="font-weight:400"><input type="checkbox" id="showPw"> Show password</label>
      <div id="loginErr"></div>
      <button class="btn" id="loginBtn">Log in</button>
      <p class="hint">You need signal for the first log in. After that, the app also works without signal.</p></div>`;
    $('#showPw').onchange = e => { $('#pw').type = e.target.checked ? 'text' : 'password'; };
    $('#pw').onkeydown = e => { if (e.key === 'Enter') doLogin(); };
    $('#loginBtn').onclick = doLogin;
  }
  async function doLogin() {
    const pw = $('#pw').value.trim(), btn = $('#loginBtn'), err = $('#loginErr');
    if (!pw) return;
    if (!navigator.onLine) { err.innerHTML = '<div class="notice bad">No signal. Connect to the internet to log in.</div>'; return; }
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Logging in…'; err.innerHTML = '';
    try {
      const r = await api('login', { password: pw });
      session = { token: r.token, user: r.user }; ls.set('session', session);
      btn.innerHTML = '<span class="spinner"></span>Loading your partners…';
      boot = await api('bootstrap', { token: session.token }, 60000);
      ls.set('boot:' + key(session.user.name), boot);
      start();
    } catch (e) {
      err.innerHTML = `<div class="notice bad">${esc(isNetErr(e) ? 'Could not reach the server. Check your signal and try again.' : e.message)}</div>`;
      btn.disabled = false; btn.textContent = 'Log in';
    }
  }

  /* ======================= FLOW ======================= */
  const STEPS = ['partner', 'photo', 'location', 'type', 'details', 'agree', 'review'];
  const STEP_LABEL = { partner: 'Partner', photo: 'Store photo', location: 'Location check', type: 'Touchpoint type',
                       details: 'Details', agree: 'Agreement', review: 'Review & send' };
  let current = 'home';
  const stepName = () => current;
  function go(step) { current = step; if (draft) { draft.step = step; saveDraft(); } render(); window.scrollTo(0, 0); }

  function newDraft() {
    draft = { clientId: uid(), step: 'partner', partner: '', image: null, capturedAt: null, lat: null, lng: null, acc: null,
              locate: null, offline: false, gridMuni: '', gridProv: '', brgy: '', brgyDetected: '', brgyOther: false, street: '', full: '',
              type: '', tradeName: '', dthClass: '', owner: '', contact: '', loadingClass: '', loadingPrimary: '',
              ottClass: '', ottPrimary: '', terms: false, consent: false };
    saveDraft(); go('partner');
  }
  const partnerObj = () => (boot.partners || []).find(p => p.name === draft.partner);
  const typeInfo = code => ({ DTH: { dth: 1 }, LOADING: { loading: 1 }, OTT: { ott: 1 }, 'DTH+LOADING': { dth: 1, loading: 1 }, 'LOADING+OTT': { loading: 1, ott: 1 } }[code] || {});
  const typeLabel = code => ((boot.types || []).find(t => t.code === code) || {}).label || code;

  const RESEND_STEPS = ['location', 'type', 'details', 'review'];
  function stepsBar() {
    const list = draft && draft.resubmit ? RESEND_STEPS : STEPS;
    const i = list.indexOf(current);
    return `<div class="steps">${list.map((s, j) => `<i class="${j <= i ? 'done' : ''}"></i>`).join('')}</div>
            <div class="step-title">${draft && draft.resubmit ? 'Correcting ' + esc(draft.resubmit.id) + ' · ' : ''}Step ${i + 1} of ${list.length} · ${STEP_LABEL[current]}</div>`;
  }
  const covKey = p => (/^NCR/i.test(p || '') || /^MANILA$/i.test(String(p || '').trim())) ? 'NCR' : key(p);
  const navBtns = (nextLabel, nextDisabled, backTo) => `<div class="row-btns">
      <button class="btn ghost" id="backBtn" data-to="${backTo}">‹ Back</button>
      <button class="btn" id="nextBtn" ${nextDisabled ? 'disabled' : ''}>${nextLabel}</button></div>`;
  function bindBack() { const b = $('#backBtn'); if (b) b.onclick = () => go(b.dataset.to); }

  function render() {
    if (!session) return renderLogin();
    ({ home: renderHome, partner: renderPartner, photo: renderPhoto, location: renderLocation, type: renderType,
       details: renderDetails, agree: renderAgree, review: renderReview, done: renderDone,
       amend: renderAmendMenu, amendCode: renderAmendCode, amendForm: renderAmendForm, amendReview: renderAmendReview, amendDone: renderAmendDone })[current]();
  }

  /* ---------- HOME ---------- */
  async function renderHome() {
    const queue = (await DB.all('queue').catch(() => [])).sort((a, b) => b.savedAt - a.savedAt);
    const hasDraft = !!(await DB.get('draft', 'current').catch(() => null));
    const loadedAt = boot && boot.loadedAt ? new Date(boot.loadedAt) : null;
    const today = loadedAt && loadedAt.toDateString() === new Date().toDateString();
    const waiting = queue.filter(q => !q.error).length, problems = queue.length - waiting;
    view.innerHTML = `
      ${waiting ? `<div class="unsent" id="unsentBanner"><span class="n">${waiting}</span><div>
          <b>${waiting} request${waiting === 1 ? '' : 's'} not sent yet</b>
          <small class="hint" style="display:block;margin:2px 0 0">${navigator.onLine ? 'Keep the app open until it says Sent ✓' : 'Open this app again once you have signal — they send automatically.'}</small></div>
          ${navigator.onLine ? '<button class="btn" id="bannerSendBtn">⬆ Send</button>' : ''}</div>` : ''}
      ${problems ? `<div class="notice bad"><b>${problems} saved request${problems === 1 ? ' was' : 's were'} not accepted</b>See the reason below, then fix or discard ${problems === 1 ? 'it' : 'them'}.</div>` : ''}
      <div class="notice ${!boot ? 'bad' : today ? 'ok' : 'warn'}">${!boot ? '✗ Partner list not loaded — connect to the internet.'
        : (today ? '✓ ' : '⚠ ') + boot.partners.length + ' partner(s) ready · updated ' +
          (today ? 'today ' + loadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : loadedAt.toLocaleDateString()) +
          (today ? ' · works offline' : ' — connect to update')}</div>
      ${hasDraft ? `<div class="card"><h2>Unfinished request</h2><p class="hint" style="margin-top:0">You have a request you haven't sent yet.</p>
        <button class="btn dark" id="resumeBtn">Continue it</button><button class="btn ghost" id="dropDraftBtn">Delete it</button></div>` : ''}
      <button class="big-choice" id="newBtn" ${boot && boot.partners.length ? '' : 'disabled'}>➕ Register New Touchpoint
        <small>New DTH Acquisition, Loading or OTT touchpoint</small></button>
      <button class="big-choice" id="amendBtn" ${boot && boot.partners.length ? '' : 'disabled'}>✏️ Amend Existing Touchpoint
        <small>Change information, upgrade DTH class, or add to Loading / DTH / OTT</small></button>
      <div class="card" id="myReqCard"><h2>My requests</h2><div id="myReq"><p class="hint">${navigator.onLine ? '<span class="spinner"></span>Loading…' : 'Connect to the internet to see the status of your requests.'}</p></div></div>
      ${queue.length ? `<div class="card"><h2>${queue.length} request(s) waiting to send</h2>
        ${queue.map(q => `<div class="list-item"><img src="data:image/jpeg;base64,${q.request.image}" alt="">
          <div class="t"><b>${esc(q.request.tradeName)}</b><small>${esc(q.request.partner)} · ${new Date(q.savedAt).toLocaleString()}</small>
          ${q.error ? `<small class="err">Problem: ${esc(q.error)}</small>` : ''}</div>
          <button data-discard="${esc(q.clientId)}">Discard</button></div>`).join('')}
        <button class="btn ghost" id="sendNowBtn" style="margin-top:10px">⬆ Send now</button></div>` : ''}
`;
    $('#newBtn').onclick = () => newDraft();
    $('#amendBtn').onclick = () => go('amend');
    loadMyRequests();
    if (hasDraft) {
      $('#resumeBtn').onclick = async () => { draft = await DB.get('draft', 'current'); go(draft.step || 'partner'); };
      $('#dropDraftBtn').onclick = async () => { if (confirm('Delete the unfinished request?')) { await clearDraft(); draft = null; render(); } };
    }
    view.querySelectorAll('[data-discard]').forEach(b => b.onclick = async () => {
      if (!confirm('Delete this request from the phone? It has NOT been sent.')) return;
      await DB.del('queue', b.dataset.discard); render();
    });
    const sn = $('#sendNowBtn'); if (sn) sn.onclick = () => sync(true);
    const bs = $('#bannerSendBtn'); if (bs) bs.onclick = () => sync(true);
  }

  /* ---------- 1. PARTNER ---------- */
  function renderPartner() {
    const ps = boot.partners;
    view.innerHTML = `${stepsBar()}<div class="card"><h2>Which partner is this touchpoint for?</h2>
      <label for="partnerSel">Partner <span class="req">*</span></label>
      <select id="partnerSel"><option value="">— Select partner —</option>
        ${ps.map(p => `<option ${p.name === draft.partner ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <div class="hint">Only partners assigned to you are listed.</div>
      ${navBtns('Next ›', !draft.partner, 'home')}</div>`;
    $('#partnerSel').onchange = e => {
      if (draft.partner !== e.target.value) { draft.partner = e.target.value; draft.locate = null; draft.gridMuni = draft.gridProv = ''; }
      saveDraft(); $('#nextBtn').disabled = !draft.partner;
    };
    $('#nextBtn').onclick = () => go('photo');
    $('#backBtn').onclick = async () => { if (confirm('Cancel this request?')) { await clearDraft(); draft = null; go('home'); } };
  }

  /* ---------- 2. PHOTO ---------- */
  function renderPhoto() {
    startGps();
    const has = !!draft.image;
    view.innerHTML = `${stepsBar()}<div class="card"><h2>Take a picture of the store</h2>
      ${has ? `<img id="preview" src="data:image/jpeg;base64,${draft.image}" alt="Store photo">` : ''}
      <button class="btn ${has ? 'ghost' : ''}" id="camBtn">📷 ${has ? 'Retake photo' : 'Take photo'}</button>
      <div id="gpsBox">${gpsBoxHtml()}</div>
      ${has && draft.lat != null ? `<div class="hint">📍 Location saved with the photo: ${draft.lat.toFixed(6)}, ${draft.lng.toFixed(6)} (±${draft.acc} m)</div>` : ''}
      ${has && draft.lat == null ? `<div class="notice warn">Waiting for GPS to attach the location to this photo…</div>` : ''}
      <input type="file" id="cam" accept="image/*" capture="environment" hidden>
      ${navBtns('Check location ›', !(has && draft.lat != null), 'partner')}</div>`;
    $('#camBtn').onclick = () => $('#cam').click();
    $('#cam').onchange = async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try {
        draft.image = (await resize(f)).split(',')[1];
        draft.capturedAt = Date.now(); draft.locate = null; draft.gridMuni = draft.gridProv = '';
        draft.lat = draft.lng = draft.acc = null;
        if (gps && Date.now() - gps.at < 60000) lockGps();
        saveDraft(); render();
      } catch (err) { toast('Could not read the photo. Please retake.'); }
    };
    bindBack(); $('#nextBtn').onclick = () => go('location');
  }
  function resize(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = reject; img.src = url;
    });
  }

  /* ---------- 3. LOCATION CHECK ---------- */
  async function renderLocation() {
    const p = partnerObj();
    if (draft.resubmit) return renderResubmitLocation();
    if (!draft.locate && navigator.onLine) {
      view.innerHTML = `${stepsBar()}<div class="card"><h2>Checking location</h2>
        <div class="notice warn"><span class="spinner"></span>Checking if this spot is within ${esc(draft.partner)}'s coverage…</div></div>`;
      try {
        draft.locate = await api('locate', { token: session.token, partner: draft.partner, lat: draft.lat, lng: draft.lng }, 30000);
        draft.offline = false;
        const d = draft.locate.detected || {};
        draft.brgyDetected = d.brgy || '';
        if (!draft.street) draft.street = d.street || '';
        draft.full = d.full || '';
        // pre-select the GPS town only if it is one of the partner's municipalities; otherwise the rep chooses
        if (draft.locate.status === 'OK') {
          const m = draft.locate.match;
          draft.gridMuni = m ? m.muni : ''; draft.gridProv = m ? m.prov : '';
          draft.brgy = ''; draft.brgyOther = false;
        }
      } catch (e) {
        if (!isNetErr(e)) { view.innerHTML = `${stepsBar()}<div class="card"><div class="notice bad">${esc(e.message)}</div>${navBtns('Next ›', true, 'photo')}</div>`; bindBack(); return; }
        draft.locate = null; draft.offline = true;
      }
      saveDraft();
      if (current !== 'location') return;
    } else if (!draft.locate) { draft.offline = true; }
    await loadBrgy();
    if (current !== 'location') return;

    const L = draft.locate, st = draft.offline ? 'OFFLINE' : L.status;
    const options = st === 'OFFLINE' ? p.areas : (L.options || []);
    const det = L && L.detected ? L.detected : {};
    const ncr = !!det.ncr;
    const provName = ncr ? 'Metro Manila' : (det.gridProv || '');
    const sel = options.length ? `<label for="muniSel">Municipality <span class="req">*</span></label>
      <select id="muniSel"><option value="">— Select ${esc(draft.partner)}'s municipality —</option>
      ${groupByProv(options).map(([prov, list]) => `<optgroup label="${esc(prov)}">${list.map(a => {
        const v = a.muni + '|' + a.prov; return `<option value="${esc(v)}" ${v === draft.gridMuni + '|' + draft.gridProv ? 'selected' : ''}>${esc(a.muni)}</option>`; }).join('')}</optgroup>`).join('')}
      </select>
      <div class="hint">Only ${esc(draft.partner)}'s municipalities${st === 'OK' ? ' in ' + esc(provName) : ''} are listed.</div>
      <label>Province</label><div id="provOut" class="hint" style="font-size:16px;color:var(--ink);font-weight:700;margin-top:0">${esc(draft.gridProv || '—')}</div>
      ${ncr ? '<div class="hint">Metro Manila: the province follows the municipality you choose.</div>' : ''}` : '';
    let box = '';
    const gpsTown = det.city || det.gridMuni;
    if (st === 'OK') box = `<div class="notice ok"><b>✓ Province verified: ${esc(provName)}</b>Within ${esc(draft.partner)}'s coverage.
      ${gpsTown ? `<br><small>GPS town: ${esc(gpsTown)}${L.match ? ' — selected below. Change it if needed.' : ` — not one of ${esc(draft.partner)}'s municipalities. Choose the municipality below.`}</small>` : ''}</div>`;
    else if (st === 'OUT_OF_COVERAGE') box = `<div class="notice bad"><b>✗ Cannot proceed</b>This location (${esc(det.city)}, ${esc(det.gridProv || det.province)}) is not within the coverage of ${esc(draft.partner)}.
      ${L.coverage && L.coverage.length ? `<br>Coverage: ${esc(L.coverage.join(', '))}` : ''}</div>`;
    else if (st === 'UNVERIFIED') box = `<div class="notice warn"><b>Address could not be identified</b>Choose the municipality. Head office will verify it.</div>`;
    else box = `<div class="notice warn"><b>No signal</b>Choose the municipality. The location will be checked against ${esc(draft.partner)}'s coverage when the request is sent.</div>`;

    view.innerHTML = `${stepsBar()}<div class="card"><h2>Location</h2>${box}
      ${st === 'OUT_OF_COVERAGE' ? `<button class="btn ghost" id="retakeBtn">📷 Retake photo at the right spot</button>
        <button class="btn ghost" id="changePartnerBtn">Change partner</button>` : `
      ${sel}
      <h3>Captured location</h3>
      ${draft.full ? `<div class="hint" style="font-size:14px;color:var(--ink)">${esc(draft.full)}</div>` : ''}
      <div class="hint">📍 ${draft.lat.toFixed(6)}, ${draft.lng.toFixed(6)} (±${draft.acc} m)</div>
      <div id="brgyBox"></div>
      <label for="street">Street / House no.</label>
      <input type="text" id="street" value="${esc(draft.street)}" placeholder="e.g. 12 Rizal St.">
      ${navBtns('Next ›', false, 'photo')}`}</div>`;
    if (st === 'OUT_OF_COVERAGE') {
      $('#retakeBtn').onclick = () => go('photo');
      $('#changePartnerBtn').onclick = () => go('partner');
      return;
    }
    if ($('#muniSel')) $('#muniSel').onchange = e => {
      const [m, pv] = e.target.value.split('|'); draft.gridMuni = m || ''; draft.gridProv = pv || '';
      draft.brgy = ''; draft.brgyOther = false; saveDraft(); renderBrgy();   // new town → new barangay list
      const po = $('#provOut'); if (po) po.textContent = draft.gridProv || '—';  // province follows the municipality
    };
    renderBrgy();
    $('#street').oninput = e => { draft.street = e.target.value; saveDraft(); };
    bindBack();
    $('#nextBtn').onclick = () => {
      if (!draft.gridMuni) { toast('Please choose the municipality'); $('#muniSel') && $('#muniSel').focus(); return; }
      if (!draft.brgy.trim()) { toast(draft.brgyOther || !brgyList() ? 'Please type the Barangay' : 'Please choose the Barangay'); const b = $('#brgy') || $('#brgyOther'); b && b.focus(); return; }
      go('type');
    };
  }

  /* ---------- Barangay: official PSA list for the chosen town, with "Other" for typing ---------- */
  let BRGY = null;
  async function loadBrgy() {
    if (BRGY) return BRGY;
    try { const r = await fetch('barangays.json'); BRGY = (await r.json()).byGrid || {}; } catch (e) { BRGY = {}; }
    return BRGY;
  }
  const brgyList = () => (draft.gridMuni && BRGY) ? BRGY[key(draft.gridMuni) + '|' + key(draft.gridProv)] || null : null;
  const brgyKey = s => key(String(s || '').replace(/\(.*?\)/g, '').replace(/^\s*(barangay|brgy\.?|bgy\.?)\s+/i, ''));
  function matchBrgy(list, name) {
    const k = brgyKey(name); if (!k) return '';
    const exact = list.find(b => brgyKey(b) === k); if (exact) return exact;
    const loose = list.filter(b => { const bk = brgyKey(b); return Math.min(bk.length, k.length) >= 5 && (bk.startsWith(k) || k.startsWith(bk)); });
    return loose.length === 1 ? loose[0] : '';
  }
  function renderBrgy() {
    const box = $('#brgyBox'); if (!box) return;
    const list = brgyList();
    const label = `<label for="brgy">Barangay <span class="req">*</span></label>`;
    if (!draft.gridMuni) { box.innerHTML = label + `<select id="brgy" disabled><option>Choose the municipality first</option></select>`; return; }
    if (!list) {   // town has no official list (rare): type it
      box.innerHTML = label + `<input type="text" id="brgy" value="${esc(draft.brgy || draft.brgyDetected)}" placeholder="Type the barangay">`;
      if (!draft.brgy && draft.brgyDetected) { draft.brgy = draft.brgyDetected; saveDraft(); }
      $('#brgy').oninput = e => { draft.brgy = e.target.value; saveDraft(); };
      return;
    }
    if (!draft.brgy && !draft.brgyOther && draft.brgyDetected) { draft.brgy = matchBrgy(list, draft.brgyDetected); saveDraft(); }
    const inList = list.indexOf(draft.brgy) > -1;
    const showHint = draft.brgyDetected && !inList && !draft.brgyOther;
    box.innerHTML = label + `<select id="brgy"><option value="">— Select barangay (${list.length}) —</option>
        ${list.map(b => `<option ${b === draft.brgy && !draft.brgyOther ? 'selected' : ''}>${esc(b)}</option>`).join('')}
        <option value="__OTHER__" ${draft.brgyOther ? 'selected' : ''}>Other / not in the list…</option></select>
      ${draft.brgyOther ? `<input type="text" id="brgyOther" value="${esc(draft.brgy)}" placeholder="Type the barangay" style="margin-top:8px">` : ''}
      ${showHint ? `<div class="hint">GPS address shows “${esc(draft.brgyDetected)}”, which is not in the official list. Choose the correct barangay, or pick “Other” to type it.</div>`
                 : inList && draft.brgyDetected && !draft.brgyOther ? `<div class="hint ok">✓ Filled in from the GPS address. Change it if it's wrong.</div>` : ''}`;
    $('#brgy').onchange = e => {
      if (e.target.value === '__OTHER__') { draft.brgyOther = true; draft.brgy = ''; }
      else { draft.brgyOther = false; draft.brgy = e.target.value; }
      saveDraft(); renderBrgy();
      if (draft.brgyOther) $('#brgyOther').focus();
    };
    if ($('#brgyOther')) $('#brgyOther').oninput = e => { draft.brgy = e.target.value; saveDraft(); };
  }

  function groupByProv(list) {
    const m = new Map();
    list.forEach(a => { if (!m.has(a.prov)) m.set(a.prov, []); m.get(a.prov).push(a); });
    return [...m.entries()].map(([k, v]) => [k, v.sort((a, b) => a.muni.localeCompare(b.muni))]);
  }

  /* ---------- 4. TYPE ---------- */
  function renderType() {
    view.innerHTML = `${stepsBar()}<div class="card"><h2>What type of touchpoint?</h2>
      ${boot.types.map(t => `<label class="type-opt ${draft.type === t.code ? 'on' : ''}"><input type="radio" name="tt" value="${t.code}" ${draft.type === t.code ? 'checked' : ''}> ${esc(t.label)}</label>`).join('')}
      ${navBtns('Next ›', !draft.type, 'location')}</div>`;
    view.querySelectorAll('input[name=tt]').forEach(r => r.onchange = () => {
      draft.type = r.value; saveDraft();
      view.querySelectorAll('.type-opt').forEach(l => l.classList.toggle('on', l.contains(r)));
      $('#nextBtn').disabled = false;
    });
    bindBack(); $('#nextBtn').onclick = () => go('details');
  }

  /* ---------- 5. DETAILS ---------- */
  function renderDetails() {
    const t = typeInfo(draft.type);
    const opts = (list, val) => `<option value="">— Select —</option>` + list.map(c => `<option ${c === val ? 'selected' : ''}>${esc(c)}</option>`).join('');
    view.innerHTML = `${stepsBar()}<div class="card"><h2>Touchpoint details</h2>
      <label for="tradeName">Trade Name / Dealer Name <span class="req">*</span></label>
      <input type="text" id="tradeName" value="${esc(draft.tradeName)}" placeholder="Store or business name">
      ${t.dth ? `<h3>DTH Acquisition</h3>
        <label for="dthClass">DTH Acquisition Class <span class="req">*</span></label><select id="dthClass">${opts(boot.dthClasses, draft.dthClass)}</select>
        <label for="owner">Owner Name / CS Email <span class="req">*</span></label><input type="text" id="owner" value="${esc(draft.owner)}">
        <label for="contact">Contact Number <span class="req">*</span></label><input type="tel" id="contact" inputmode="numeric" maxlength="13" value="${esc(draft.contact)}" placeholder="09XXXXXXXXX">
        <div class="hint" id="contactHint">11-digit mobile number starting with 0</div>` : ''}
      ${t.loading ? `<h3>Loading</h3>
        <label for="loadingClass">Loading Classification <span class="req">*</span></label><select id="loadingClass">${opts(boot.loadingClasses, draft.loadingClass)}</select>
        <label for="loadingPrimary">Primary Code <span class="hint" style="display:inline">(optional)</span></label>
        <input type="text" id="loadingPrimary" value="${esc(draft.loadingPrimary)}" autocapitalize="characters" spellcheck="false">
        <div id="primaryHint" class="hint">Leave blank if none. If filled, it must be an active Loading touchpoint of ${esc(draft.partner)}.</div>` : ''}
      ${t.ott ? `<h3>OTT Acquisition</h3>
        <label for="ottClass">OTT Classification <span class="req">*</span></label><select id="ottClass">${opts(boot.ottClasses, draft.ottClass)}</select>
        <label for="ottPrimary">Primary Salescode <span class="hint" style="display:inline">(optional)</span></label>
        <input type="text" id="ottPrimary" value="${esc(draft.ottPrimary)}" autocapitalize="characters" spellcheck="false">` : ''}
      ${navBtns('Next ›', false, 'type')}</div>`;
    const bind = (id, prop) => { const el = $('#' + id); if (el) el.oninput = el.onchange = () => { draft[prop] = el.value; saveDraft(); if (id === 'loadingPrimary') checkPrimary(); if (id === 'contact') mobileHint(el, $('#contactHint')); }; };
    if ($('#contact') && draft.contact) mobileHint($('#contact'), $('#contactHint'));
    [['tradeName', 'tradeName'], ['dthClass', 'dthClass'], ['owner', 'owner'], ['contact', 'contact'], ['loadingClass', 'loadingClass'],
     ['loadingPrimary', 'loadingPrimary'], ['ottClass', 'ottClass'], ['ottPrimary', 'ottPrimary']].forEach(([a, b]) => bind(a, b));
    if (t.loading) checkPrimary();
    bindBack();
    $('#nextBtn').onclick = () => { const miss = detailsProblem(); if (miss) { toast(miss); return; } go(draft.resubmit ? 'review' : 'agree'); };
  }
  // Mobile number: 11 digits starting with 0 (spaces or dashes are ignored)
  const mobileDigits = s => String(s || '').replace(/[\s\-().]/g, '');
  const mobileOk = s => /^0\d{10}$/.test(mobileDigits(s));
  function mobileHint(inp, h) {
    if (!h) return;
    const d = mobileDigits(inp.value);
    if (!d) { h.className = 'hint'; h.textContent = '11-digit mobile number starting with 0'; inp.classList.remove('invalid'); return; }
    const ok = mobileOk(d);
    h.className = 'hint ' + (ok ? 'ok' : 'bad');
    h.textContent = ok ? '✓ Valid mobile number' : !/^\d+$/.test(d) ? '✗ Numbers only' : d[0] !== '0' ? '✗ Must start with 0' : '✗ ' + d.length + ' of 11 digits';
    inp.classList.toggle('invalid', !ok);
  }
  // Primary Code must be an ACTIVE Loading touchpoint of the SAME partner
  function primaryOk() {
    const c = normCode(draft.loadingPrimary); if (!c) return true;
    const byP = boot.loadingCodesByPartner || {};
    return (byP[draft.partner] || []).indexOf(c) > -1;
  }
  function checkPrimary() {
    const h = $('#primaryHint'), inp = $('#loadingPrimary'); if (!h) return;
    const c = normCode(draft.loadingPrimary);
    if (!c) { h.className = 'hint'; h.textContent = 'Leave blank if none. If filled, it must be an active Loading touchpoint of ' + draft.partner + '.'; inp.classList.remove('invalid'); return; }
    const ok = primaryOk();
    h.className = 'hint ' + (ok ? 'ok' : 'bad');
    h.textContent = ok ? '✓ Active Loading touchpoint of ' + draft.partner : '✗ Not an active Loading touchpoint of ' + draft.partner + '. Please check the code.';
    inp.classList.toggle('invalid', !ok);
  }
  function detailsProblem() {
    const t = typeInfo(draft.type);
    if (!draft.tradeName.trim()) return 'Please enter the Trade Name';
    if (t.dth) {
      if (!draft.dthClass) return 'Please choose the DTH Acquisition Class';
      if (!draft.owner.trim()) return 'Please enter the Owner Name / CS Email';
      if (!draft.contact.trim()) return 'Please enter the Contact Number';
      if (!mobileOk(draft.contact)) return 'Contact Number must be 11 digits starting with 0 (e.g. 09171234567)';
    }
    if (t.loading) { if (!draft.loadingClass) return 'Please choose the Loading Classification'; if (!primaryOk()) return 'Primary Code is not an active Loading touchpoint of ' + draft.partner; }
    if (t.ott && !draft.ottClass) return 'Please choose the OTT Classification';
    return '';
  }

  /* ---------- 6. AGREEMENT ---------- */
  function renderAgree() {
    view.innerHTML = `${stepsBar()}<div class="card"><h2>Agreement</h2>
      <table class="sum"><tr><td>Requestor</td><td><b>${esc(session.user.name)}</b> (${esc(session.user.position)})</td></tr>
      <tr><td>Partner</td><td>${esc(draft.partner)}</td></tr></table>
      <label class="check"><input type="checkbox" id="terms" ${draft.terms ? 'checked' : ''}>
        <span>I have read and agree to the <a href="${esc(CFG.TERMS_URL)}" target="_blank" rel="noopener">Terms and Conditions</a>.</span></label>
      <details class="consent"><summary>Read the Consent</summary>${CFG.CONSENT_HTML || ''}</details>
      <label class="check"><input type="checkbox" id="consent" ${draft.consent ? 'checked' : ''}>
        <span>I consent to the collection and processing of the information in this form.</span></label>
      ${navBtns('Proceed to Review ›', !(draft.terms && draft.consent), 'details')}</div>`;
    const upd = () => { draft.terms = $('#terms').checked; draft.consent = $('#consent').checked; saveDraft(); $('#nextBtn').disabled = !(draft.terms && draft.consent); };
    $('#terms').onchange = upd; $('#consent').onchange = upd;
    bindBack(); $('#nextBtn').onclick = () => go('review');
  }

  /* ---------- 7. REVIEW ---------- */
  function renderReview() {
    const t = typeInfo(draft.type);
    const row = (a, b) => b ? `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>` : '';
    const sec = s => `<tr class="section"><td colspan="2">${esc(s)}</td></tr>`;
    view.innerHTML = `${stepsBar()}<div class="card"><h2>Review your request</h2>
      ${draft.image ? `<img class="thumb" src="data:image/jpeg;base64,${draft.image}" alt="">` : `<div class="notice ok">Store photo and GPS location are kept from your original request.</div>`}
      <table class="sum">
        ${sec('Request')}${row('Action', 'Register New Touchpoint')}${row('Touchpoint type', typeLabel(draft.type))}
        ${row('Partner', draft.partner)}${row('Requestor', session.user.name + ' (' + session.user.position + ')')}
        ${sec('Touchpoint')}${row('Trade Name', draft.tradeName)}
        ${t.dth ? row('DTH Class', draft.dthClass) + row('Owner / CS Email', draft.owner) + row('Contact Number', draft.contact) : ''}
        ${t.loading ? row('Loading Classification', draft.loadingClass) + row('Primary Code', normCode(draft.loadingPrimary) || '—') : ''}
        ${t.ott ? row('OTT Classification', draft.ottClass) + row('OTT Primary Salescode', normCode(draft.ottPrimary) || '—') : ''}
        ${sec('Location')}${row('Municipality', draft.gridMuni)}${row('Province', draft.gridProv)}
        ${row('Barangay', draft.brgy)}${row('Street', draft.street)}
        ${draft.resubmit ? row('GPS', 'Kept from the original request') : row('GPS', draft.lat.toFixed(6) + ', ' + draft.lng.toFixed(6) + ' (±' + draft.acc + ' m)')}
        ${draft.resubmit ? '' : row('Location check', draft.offline ? 'Will be checked when sent'
          : draft.locate.status === 'OK' ? 'Province verified by GPS' : 'Not verified — head office will check')}
        ${draft.resubmit ? '' : sec('Agreement') + row('Terms and Conditions', 'Accepted') + row('Consent', 'Accepted')}
      </table>
      <div class="row-btns"><button class="btn ghost" id="backBtn" data-to="${draft.resubmit ? 'details' : 'agree'}">‹ Back</button>
        <button class="btn" id="sendBtn">${draft.resubmit ? 'Resend' : 'Confirm &amp; Send'}</button></div></div>`;
    bindBack();
    if (draft.resubmit) { $('#sendBtn').onclick = sendResubmit; return; }
    $('#sendBtn').onclick = async () => {
      const req = { clientId: draft.clientId, partner: draft.partner, touchpointType: draft.type, tradeName: draft.tradeName.trim(),
        brgy: draft.brgy.trim(), street: draft.street.trim(), gridMuni: draft.gridMuni, gridProv: draft.gridProv,
        lat: draft.lat, lng: draft.lng, acc: draft.acc, capturedAt: draft.capturedAt, image: draft.image,
        dthClass: draft.dthClass, owner: draft.owner.trim(), contact: draft.contact.trim(),
        loadingClass: draft.loadingClass, loadingPrimary: normCode(draft.loadingPrimary),
        ottClass: draft.ottClass, ottPrimary: normCode(draft.ottPrimary),
        termsAccepted: true, consentAccepted: true, deviceId: DEVICE_ID };
      try { await DB.put('queue', { clientId: req.clientId, request: req, savedAt: Date.now() }); }
      catch (e) { toast('Phone storage is full. Send or discard waiting requests first.', 6000); return; }
      await clearDraft();
      lastSent = { clientId: req.clientId, trade: req.tradeName, partner: req.partner };
      draft = null; current = 'done'; render(); window.scrollTo(0, 0);
      sync();
    };
  }

  /* ---------- DONE ---------- */
  let lastSent = null;
  async function renderDone() {
    const stillQueued = lastSent && await DB.get('queue', lastSent.clientId).catch(() => null);
    const sent = lastSent && ls.get('recent', []).find(r => r.clientId === lastSent.clientId);
    view.innerHTML = `<div class="card center">
      ${sent ? `<div class="done-mark">✅</div><h2>Request sent</h2>
          <p>Request ID: <b>${esc(sent.requestId)}</b></p><p class="hint">Status: For approval. You'll be notified once it's approved.</p>`
        : stillQueued && stillQueued.error ? `<div class="done-mark">⚠️</div><h2>Request not accepted</h2><div class="notice bad">${esc(stillQueued.error)}</div>`
        : `<div class="done-mark">📱</div><h2>Saved on your phone</h2>
           <p class="hint">${navigator.onLine ? '<span class="spinner"></span>Sending…' : 'No signal. It will be sent automatically when you have signal. Keep the app installed.'}</p>`}
      <button class="btn" id="anotherBtn">➕ Register another touchpoint</button>
      <button class="btn ghost" id="homeBtn">Home</button></div>`;
    $('#anotherBtn').onclick = () => newDraft();
    $('#homeBtn').onclick = () => go('home');
  }


  /* ======================= MY REQUESTS (status, cancel, correct & resend) ======================= */
  const STATUS_PILL = { 'FOR APPROVAL': 'warn', 'RETURNED FOR CORRECTION': 'bad', 'APPROVED': 'ok', 'REJECTED': 'bad', 'CANCELLED': '', 'APPROVED - ACTION NEEDED': 'warn' };
  const myReqsKey = () => 'myReqs:' + key(session && session.user.name);
  let myReqs = null;
  async function loadMyRequests() {
    const box = $('#myReq'); if (!box) return;
    if (!myReqs) {   // saved copy from the last time (shown right away, also offline)
      const c = ls.get(myReqsKey(), null);
      if (c && Array.isArray(c.list) && c.month === monthKey(new Date())) { myReqs = c.list; myReqs.month = c.month; }
    }
    if (myReqs) drawMyRequests();
    if (!navigator.onLine) { if (!myReqs) box.innerHTML = '<p class="hint">Connect to the internet to see the status of your requests.</p>'; return; }
    try {
      const r = await api('myRequests', { token: session.token, scope: 'current' }, 30000);
      myReqs = r.requests; myReqs.month = r.month; ls.set(myReqsKey(), { list: myReqs, month: r.month });
      drawMyRequests();
    } catch (e) { if (!myReqs && $('#myReq')) $('#myReq').innerHTML = '<p class="hint">Could not load your requests.</p>'; }
  }
  const GROUPS = [
    { k: 'process',  label: 'On Process', cls: 'g-process',  st: ['FOR APPROVAL', 'APPROVED - ACTION NEEDED'] },
    { k: 'returned', label: 'Returned',   cls: 'g-returned', st: ['RETURNED FOR CORRECTION'] },
    { k: 'approved', label: 'Approved',   cls: 'g-approved', st: ['APPROVED'] },
    { k: 'declined', label: 'Declined',   cls: 'g-declined', st: ['REJECTED'] }];
  const inGroup = (g, r) => g.st.indexOf(r.status) > -1;
  const shortDate = iso => iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const ageDays = iso => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5));
  const actionShort = a => String(a || '').replace('AMEND - ', 'Amend: ').replace('REGISTER NEW', 'New').toLowerCase().replace(/^\w/, c => c.toUpperCase());

  const monthKey = d => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'); };
  const monthName = ym => { const [y, m] = String(ym).split('-').map(Number); return y ? new Date(y, m - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' }) : ''; };

  function drawMyRequests() {
    const box = $('#myReq'); if (!box) return;
    const section = kind => {
      const mine = myReqs.filter(r => reqKind(r) === kind);
      const cancelled = mine.filter(r => r.status === 'CANCELLED');
      return `<div class="tracker"><h3>${KIND_LABEL[kind]}</h3>
        <div class="tiles">${GROUPS.map(g => {
          const n = mine.filter(r => inGroup(g, r)).length;
          return `<button class="tile ${g.cls}" data-g="${g.k}" data-kind="${kind}" ${n ? '' : 'disabled'}><b>${n}</b><span>${g.label}</span></button>`; }).join('')}</div>
        ${cancelled.length ? `<button class="linkish" data-g="cancelled" data-kind="${kind}">Cancelled (${cancelled.length})</button>` : ''}
        ${!mine.length ? `<p class="hint">No ${kind === 'NEW' ? 'new touchpoint' : 'amendment'} requests this month yet.</p>` : ''}
        <button class="archive-link" data-arc="${kind}">🗂 ${kind === 'NEW' ? 'New requests' : 'Amendments'} archive — previous months</button></div>`;
    };
    box.innerHTML = `<p class="month-note">${esc(monthName(myReqs.month || monthKey(new Date())))} · plus anything still in process from earlier months</p>
      ${section('NEW')}${section('AMEND')}`;
    box.querySelectorAll('[data-g]').forEach(b => b.onclick = () => openGroup(b.dataset.g, b.dataset.kind));
    box.querySelectorAll('[data-arc]').forEach(b => b.onclick = () => openArchive(b.dataset.arc));
  }
  const reqKind = r => /^AMEND/i.test(r.action || '') ? 'AMEND' : 'NEW';
  const KIND_LABEL = { NEW: '➕ New touchpoint requests', AMEND: '✏️ Amendment requests' };

  /* Archive: finished requests (approved / declined / cancelled) from previous months */
  function sheet(title, inner) {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="sheet"><div class="sheet-hd"><h2>${title}</h2><button class="x" aria-label="Close">✕</button></div>${inner}</div>`;
    document.body.appendChild(m);
    document.body.style.overflow = 'hidden';
    const close = () => { m.remove(); document.body.style.overflow = ''; };
    m.querySelector('.x').onclick = close;
    m.onclick = e => { if (e.target === m) close(); };
    return { m, close };
  }
  async function openArchive(kind) {
    if (!navigator.onLine) { toast('Connect to the internet to open the archive.'); return; }
    const { m } = sheet(kind === 'AMEND' ? 'Amendments archive' : 'New requests archive', `<div id="arcBody"><p class="hint"><span class="spinner"></span>Loading your previous requests…</p></div>`);
    let list;
    try { list = (await api('myRequests', { token: session.token, scope: 'archive' }, 60000)).requests.filter(r => reqKind(r) === kind); }
    catch (e) { const b = m.querySelector('#arcBody'); if (b) b.innerHTML = `<div class="notice bad">${esc(isNetErr(e) ? 'Could not reach the server.' : e.message)}</div>`; return; }
    const body = m.querySelector('#arcBody'); if (!body) return;
    if (!list.length) { body.innerHTML = '<p class="hint">No finished requests from previous months.</p>'; return; }
    const months = [...new Set(list.map(r => r.month).filter(Boolean))].sort().reverse();
    const ST = { APPROVED: 'Approved', REJECTED: 'Declined', CANCELLED: 'Cancelled' };
    body.innerHTML = `<div class="filters">
        <select id="fMonth"><option value="">All months</option>${months.map(x => `<option value="${x}">${esc(monthName(x))}</option>`).join('')}</select>
        <select id="fStatus"><option value="">All statuses</option><option value="APPROVED">Approved</option><option value="REJECTED">Declined</option><option value="CANCELLED">Cancelled</option></select></div>
      <p class="hint" id="fCount" style="margin:0 0 8px"></p>
      <div class="tbl"><table class="grid"><thead><tr><th>Request</th><th>Result</th><th>Requested</th></tr></thead><tbody id="arcRows"></tbody></table></div>`;
    const draw = () => {
      const fm = $('#fMonth').value, fs = $('#fStatus').value;
      const rows = list.filter(r => (!fm || r.month === fm) && (!fs || r.status === fs));   // already newest first
      $('#fCount').textContent = rows.length + ' request' + (rows.length === 1 ? '' : 's') + ' · newest first · tap a row for its history';
      $('#arcRows').innerHTML = rows.map((r, i) => {
        const x = r.status === 'REJECTED' ? r.rejected : r.status === 'CANCELLED' ? r.cancelled : null;
        const result = `<span class="pill st-${esc(r.status)}">${esc(ST[r.status] || r.status)}</span>` +
          (r.status === 'APPROVED' ? (r.salescode ? `<div class="code" style="margin-top:4px">${esc(r.salescode)}</div>` : '') + `<small>${shortDate(r.approvedAt)}</small>`
            : x ? `<small>${esc(x.who || '')} · ${shortDate(x.at)}</small>${x.remarks ? `<div class="reason">“${esc(x.remarks)}”</div>` : ''}` : '');
        return `<tr data-i="${i}"><td><b>${esc(r.trade || r.salescode)}</b><small>${esc(r.id)} · ${esc(actionShort(r.action))}<br>${esc(r.partner)}</small></td>
          <td>${result}</td><td>${shortDate(r.at)}</td></tr>
          <tr class="more" id="amore${i}" hidden><td colspan="3">
            ${r.changes ? `<p class="hint" style="white-space:pre-line;margin-top:0">${esc(r.changes)}</p>` : ''}
            <ul class="hist">${(r.history || []).map(h => `<li>${new Date(h.at).toLocaleString()} — ${esc(h.who)}: <b>${esc(h.what)}</b>${h.remarks ? ' — “' + esc(h.remarks) + '”' : ''}</li>`).join('')}</ul></td></tr>`;
      }).join('') || '<tr><td colspan="3" class="hint">Nothing matches these filters.</td></tr>';
      m.querySelectorAll('#arcRows tr[data-i]').forEach(tr => tr.onclick = () => {
        const more = m.querySelector('#amore' + tr.dataset.i); more.hidden = !more.hidden; tr.classList.toggle('open', !more.hidden); });
    };
    $('#fMonth').onchange = draw; $('#fStatus').onchange = draw;
    draw();
  }

  /* Pop-up table for one group */
  function openGroup(k, kind) {
    const g = GROUPS.find(x => x.k === k) || { k: 'cancelled', label: 'Cancelled', st: ['CANCELLED'] };
    const list = myReqs.filter(r => inGroup(g, r) && reqKind(r) === kind);
    const head = { process: ['Request', 'Ageing', 'Current approver'], returned: ['Request', 'Returned by / reason', 'Action'],
                   approved: ['Request', 'Sales Code', 'Approved on'], declined: ['Request', 'Declined by / reason', 'Date'],
                   cancelled: ['Request', 'Cancelled on', ''] }[k];
    const reqCell = r => `<b>${esc(r.trade || r.salescode)}</b><small>${esc(r.id)} · ${esc(actionShort(r.action))}<br>${esc(r.partner)} · sent ${shortDate(r.at)}</small>`;
    const rows = list.map((r, i) => {
      let c2 = '', c3 = '';
      if (k === 'process') {
        const d = ageDays(r.at);
        c2 = `<span class="age ${d >= 3 ? 'late' : ''}">${d} day${d === 1 ? '' : 's'}</span>`;
        c3 = r.status === 'FOR APPROVAL' ? esc(r.approver || '—') : '<span class="pill warn">Approved – being recorded by admin</span>';
      } else if (k === 'returned') {
        const x = r.returned || {};
        c2 = `<b>${esc(x.who || '—')}</b><small>${shortDate(x.at)}</small><div class="reason">“${esc(x.remarks || '')}”</div>`;
        c3 = `<button class="btn mini" data-edit="${i}">Update &amp; resend</button>`;
      } else if (k === 'approved') {
        c2 = r.salescode ? `<span class="code">${esc(r.salescode)}</span>` : '—';
        c3 = shortDate(r.approvedAt);
      } else if (k === 'declined') {
        const x = r.rejected || {};
        c2 = `<b>${esc(x.who || '—')}</b><div class="reason">“${esc(x.remarks || '')}”</div>`;
        c3 = shortDate(x.at);
      } else {
        c2 = shortDate(r.cancelled && r.cancelled.at);
      }
      return `<tr data-i="${i}"><td>${reqCell(r)}</td><td>${c2}</td><td>${c3}</td></tr>
        <tr class="more" id="more${i}" hidden><td colspan="3">
          ${r.changes ? `<p class="hint" style="white-space:pre-line;margin-top:0">${esc(r.changes)}</p>` : ''}
          <ul class="hist">${(r.history || []).map(h => `<li>${new Date(h.at).toLocaleString()} — ${esc(h.who)}: <b>${esc(h.what)}</b>${h.remarks ? ' — “' + esc(h.remarks) + '”' : ''}</li>`).join('')}</ul>
          ${r.canCancel ? `<button class="btn ghost mini" data-cancel="${i}">Cancel this request</button>` : ''}
        </td></tr>`;
    }).join('');
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="sheet"><div class="sheet-hd"><h2>${kind === 'AMEND' ? 'Amendments' : 'New requests'} · ${esc(g.label)} <span class="hint">(${list.length})</span></h2><button class="x" aria-label="Close">✕</button></div>
      <p class="hint" style="margin:0 0 8px">Tap a request to see its history${k === 'process' || k === 'returned' ? ' or cancel it' : ''}.</p>
      <div class="tbl"><table class="grid"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
    document.body.appendChild(m);
    document.body.style.overflow = 'hidden';
    const close = () => { m.remove(); document.body.style.overflow = ''; };
    m.querySelector('.x').onclick = close;
    m.onclick = e => { if (e.target === m) close(); };
    m.querySelectorAll('tr[data-i]').forEach(tr => tr.onclick = e => {
      if (e.target.closest('button')) return;
      const more = m.querySelector('#more' + tr.dataset.i); more.hidden = !more.hidden; tr.classList.toggle('open', !more.hidden);
    });
    m.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { close(); startCorrection(list[Number(b.dataset.edit)]); });
    m.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => { close(); await cancelRequest(list[Number(b.dataset.cancel)]); });
  }
  async function cancelRequest(r) {
    if (!navigator.onLine) { toast('Connect to the internet to cancel.'); return; }
    const reason = prompt('Cancel ' + r.id + '?\nReason (optional):', '');
    if (reason === null) return;
    try { await api('cancel', { token: session.token, id: r.id, reason }); toast('Request cancelled'); loadMyRequests(); }
    catch (e) { toast(isNetErr(e) ? 'Could not reach the server.' : e.message, 5000); }
  }
  function startCorrection(r) {
    if (!navigator.onLine) { toast('Connect to the internet to correct and resend.'); return; }
    const e = r.edit; if (!e) return;
    if (e.kind === 'AMEND') { am = { purpose: e.purpose, code: e.code, db: e.db, resubmit: { id: r.id, remark: r.lastRemark }, prefill: e }; go('amendCode'); lookupAmend(); return; }
    draft = { clientId: uid(), resubmit: { id: r.id, remark: r.lastRemark, prov: e.gridProv }, partner: e.partner, image: null,
      lat: Number(e.lat) || null, lng: Number(e.lng) || null, acc: null, locate: null, offline: false,
      gridMuni: e.gridMuni, gridProv: e.gridProv, brgy: e.brgy || '', brgyDetected: '', brgyOther: false, street: e.street || '', full: '',
      type: e.touchpointType, tradeName: e.tradeName || '', dthClass: e.dthClass || '', owner: e.owner || '', contact: e.contact || '',
      loadingClass: e.loadingClass || '', loadingPrimary: e.loadingPrimary || '', ottClass: e.ottClass || '', ottPrimary: e.ottPrimary || '',
      terms: true, consent: true };
    saveDraft(); go('location');
  }
  async function renderResubmitLocation() {
    await loadBrgy(); if (current !== 'location') return;
    const p = partnerObj();
    const options = p ? p.areas.filter(a => covKey(a.prov) === covKey(draft.resubmit.prov)) : [];
    if (!options.some(a => key(a.muni) === key(draft.gridMuni) && key(a.prov) === key(draft.gridProv))) options.unshift({ muni: draft.gridMuni, prov: draft.gridProv });
    const rm = draft.resubmit.remark;
    view.innerHTML = `${stepsBar()}<div class="card"><h2>Correct your request</h2>
      ${rm ? `<div class="notice bad"><b>${esc(rm.who)} asked you to correct:</b>${esc(rm.remarks)}</div>` : ''}
      <p class="hint">The store photo and GPS location stay the same. You can change the municipality (same province), barangay, street, type and details.</p>
      <label for="muniSel">Municipality <span class="req">*</span></label>
      <select id="muniSel">${groupByProv(options).map(([prov, list]) => `<optgroup label="${esc(prov)}">${list.map(a => {
        const v = a.muni + '|' + a.prov; return `<option value="${esc(v)}" ${v === draft.gridMuni + '|' + draft.gridProv ? 'selected' : ''}>${esc(a.muni)}</option>`; }).join('')}</optgroup>`).join('')}</select>
      <div id="brgyBox"></div>
      <label for="street">Street / House no.</label>
      <input type="text" id="street" value="${esc(draft.street)}">
      <div class="row-btns"><button class="btn ghost" id="backBtn">‹ Cancel</button><button class="btn" id="nextBtn">Next ›</button></div></div>`;
    const brgyList0 = brgyList();
    if (brgyList0 && draft.brgy && brgyList0.indexOf(draft.brgy) < 0) draft.brgyOther = true;   // keep a typed barangay
    $('#muniSel').onchange = e => { const [m, pv] = e.target.value.split('|'); draft.gridMuni = m; draft.gridProv = pv; draft.brgy = ''; draft.brgyOther = false; saveDraft(); renderBrgy(); };
    $('#street').oninput = e => { draft.street = e.target.value; saveDraft(); };
    renderBrgy();
    $('#backBtn').onclick = async () => { if (confirm('Stop correcting? Nothing will be sent.')) { await clearDraft(); draft = null; go('home'); } };
    $('#nextBtn').onclick = () => { if (!draft.brgy.trim()) { toast('Please choose the Barangay'); return; } go('type'); };
  }
  async function sendResubmit() {
    if (!navigator.onLine) { toast('Connect to the internet to resend.'); return; }
    const btn = $('#sendBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Sending…';
    const req = { touchpointType: draft.type, tradeName: draft.tradeName.trim(), brgy: draft.brgy.trim(), street: draft.street.trim(),
      gridMuni: draft.gridMuni, gridProv: draft.gridProv, dthClass: draft.dthClass, owner: draft.owner.trim(), contact: draft.contact.trim(),
      loadingClass: draft.loadingClass, loadingPrimary: normCode(draft.loadingPrimary), ottClass: draft.ottClass, ottPrimary: normCode(draft.ottPrimary) };
    try {
      await api('resubmit', { token: session.token, id: draft.resubmit.id, request: req }, 60000);
      const id = draft.resubmit.id; await clearDraft(); draft = null;
      toast('Resent ✓ ' + id + ' is back with the approver'); go('home');
    } catch (e) { btn.disabled = false; btn.textContent = 'Resend'; toast(isNetErr(e) ? 'Could not reach the server.' : e.message, 6000); }
  }

  /* ======================= AMEND EXISTING TOUCHPOINT ======================= */
  let am = null;   // { purpose, code, db, rec, values, justification, resubmit }
  const AMEND_OPTS = [
    ['CHANGE', '📝 Change information', 'Edit the details of an active touchpoint'],
    ['UPGRADE', '⬆️ Upgrade DTH Acquisition class', 'Multibrand → Exclusive / Agent-Installer → Satlite Partner Store → Cignal Partner / Supported Store'],
    ['DTH>LOADING', '➕ DTH Acquisition → add as Loading', 'Same Sales Code, added to Loading touchpoints'],
    ['LOADING>DTH', '➕ Loading → add as DTH Acquisition', 'Same Sales Code, added to DTH Acquisition touchpoints'],
    ['LOADING>OTT', '➕ Loading → add as OTT Acquisition', 'Same Sales Code, added to OTT touchpoints']];
  const amendTitle = p => (AMEND_OPTS.find(o => o[0] === p) || [, p])[1].replace(/^\S+\s/, '');

  function renderAmendMenu() {
    view.innerHTML = `<div class="card"><h2>Amend existing touchpoint</h2><p class="hint" style="margin-top:0">Needs signal. Amendments go to the department for approval.</p></div>
      ${AMEND_OPTS.map(o => `<button class="big-choice" data-p="${o[0]}">${o[1]}<small>${o[2]}</small></button>`).join('')}
      <button class="btn ghost" id="homeBtn">‹ Back</button>`;
    view.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { am = { purpose: b.dataset.p }; go('amendCode'); });
    $('#homeBtn').onclick = () => go('home');
  }

  function renderAmendCode() {
    view.innerHTML = `<div class="card"><h2>${esc(amendTitle(am.purpose))}</h2>
      ${am.resubmit && am.resubmit.remark ? `<div class="notice bad"><b>${esc(am.resubmit.remark.who)} asked you to correct:</b>${esc(am.resubmit.remark.remarks)}</div>` : ''}
      <label for="amCode">Sales Code <span class="req">*</span></label>
      <input type="text" id="amCode" value="${esc(am.code || '')}" autocapitalize="characters" spellcheck="false" ${am.resubmit ? 'disabled' : ''}>
      <div id="amMsg"></div>
      <div class="row-btns"><button class="btn ghost" id="backBtn">‹ Back</button><button class="btn" id="amFind">Check</button></div></div>`;
    $('#backBtn').onclick = () => { const toHome = am && am.resubmit; am = null; go(toHome ? 'home' : 'amend'); };
    $('#amCode').onkeydown = e => { if (e.key === 'Enter') lookupAmend(); };
    $('#amFind').onclick = lookupAmend;
  }
  async function lookupAmend() {
    const inp = $('#amCode'), msg = $('#amMsg'); if (!inp) return;
    const code = normCode(inp.value); if (!code) { toast('Please enter the Sales Code'); return; }
    if (!navigator.onLine) { msg.innerHTML = '<div class="notice bad">No signal. Amendments need the internet to check the Sales Code.</div>'; return; }
    msg.innerHTML = '<div class="notice warn"><span class="spinner"></span>Checking ' + esc(code) + '…</div>';
    try {
      const r = await api('lookup', { token: session.token, code, purpose: am.purpose }, 45000);
      am.code = r.code; am.records = r.records;
      if (am.purpose === 'CHANGE' && r.records.length > 1 && !am.db) {
        msg.innerHTML = `<div class="notice ok"><b>✓ Found in ${r.records.length} databases.</b>Which one do you want to change?</div>` +
          r.records.map((x, i) => `<button class="big-choice" data-i="${i}">${esc(x.dbLabel)}<small>${esc(x.summary.name)} · ${esc(x.summary.muni)}, ${esc(x.summary.prov)}</small></button>`).join('');
        msg.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { am.rec = am.records[Number(b.dataset.i)]; am.db = am.rec.db; startAmendForm(); });
        return;
      }
      am.rec = am.db ? r.records.find(x => x.db === am.db) || r.records[0] : r.records[0]; am.db = am.rec.db;
      startAmendForm();
    } catch (e) {
      msg.innerHTML = `<div class="notice bad">${esc(isNetErr(e) ? 'Could not reach the server. Check your signal.' : e.message)}</div>`;
    }
  }
  function startAmendForm() {
    const rec = am.rec;
    am.values = {}; am.justification = (am.prefill && am.prefill.justification) || '';
    (rec.fields || []).forEach(f => { am.values[f.h] = f.type === 'area' ? Object.assign({}, f.value || {}) : (f.value || ''); });
    if (am.prefill && am.prefill.values) Object.keys(am.prefill.values).forEach(h => { am.values[h] = am.prefill.values[h]; });
    if (am.purpose === 'UPGRADE') am.values = { CLASS: am.prefill && am.prefill.values ? am.prefill.values.CLASS : '' };
    go('amendForm');
  }
  const areaKey = a => a ? key(a.muni) + '|' + key(a.prov) : '';
  function amendAreaFor(fieldsArea) { return fieldsArea || am.values.AREA || null; }

  function renderAmendForm() {
    const rec = am.rec;
    const ro = (rec.readonly || []).map(x => `<tr><td>${esc(x.label)}</td><td>${esc(x.value)}</td></tr>`).join('');
    const head = `<div class="card"><h2>${esc(amendTitle(am.purpose))}</h2>
      ${am.resubmit && am.resubmit.remark ? `<div class="notice bad"><b>${esc(am.resubmit.remark.who)} asked you to correct:</b>${esc(am.resubmit.remark.remarks)}</div>` : ''}
      <div class="notice ok"><b>✓ ${esc(am.code)} · ${esc(rec.dbLabel)}</b>${esc(rec.summary.name)} — ${esc(rec.summary.muni)}, ${esc(rec.summary.prov)} · ${esc(rec.partner)}</div>
      ${ro ? `<h3>Cannot be changed</h3><table class="sum">${ro}</table>` : ''}`;
    let body = '';
    if (am.purpose === 'UPGRADE') {
      body = `<h3>Upgrade</h3><p>Current class: <b>${esc(rec.currentClass)}</b> (level ${rec.currentLevel})</p>
        ${rec.upgradeOptions.map(o => `<label class="type-opt ${am.values.CLASS === o.cls ? 'on' : ''}"><input type="radio" name="upg" value="${esc(o.cls)}" ${am.values.CLASS === o.cls ? 'checked' : ''}> ${esc(o.cls)} <span class="hint" style="margin-left:auto">level ${o.level}</span></label>`).join('')}`;
    } else {
      body = `<h3>${am.purpose === 'CHANGE' ? 'Edit the details' : 'Details for ' + esc(rec.targetLabel)}</h3>` + rec.fields.map((f, i) => fieldHtml(f, i)).join('');
    }
    const justReq = am.purpose === 'CHANGE' || am.purpose === 'UPGRADE';
    view.innerHTML = head + body + `
      <label for="amJust">${justReq ? 'Justification <span class="req">*</span>' : 'Remarks (optional)'}</label>
      <textarea id="amJust" rows="3" placeholder="${justReq ? 'Why is this change needed?' : ''}">${esc(am.justification)}</textarea>
      <div class="row-btns"><button class="btn ghost" id="backBtn">‹ Back</button><button class="btn" id="nextBtn">Review ›</button></div></div>`;
    // bind fields
    if (am.purpose === 'UPGRADE') view.querySelectorAll('input[name=upg]').forEach(r => r.onchange = () => {
      am.values.CLASS = r.value; view.querySelectorAll('.type-opt').forEach(l => l.classList.toggle('on', l.contains(r))); });
    (rec.fields || []).forEach((f, i) => bindField(f, i));
    $('#amJust').oninput = e => { am.justification = e.target.value; };
    $('#backBtn').onclick = () => { if (am.resubmit) { if (confirm('Stop correcting? Nothing will be sent.')) { am = null; go('home'); } } else { am.db = null; go('amendCode'); } };
    $('#nextBtn').onclick = () => { const p = amendProblem(); if (p) { toast(p); return; } go('amendReview'); };
  }
  function fieldHtml(f, i) {
    const id = 'af' + i, v = am.values[f.h], req = f.req ? ' <span class="req">*</span>' : '';
    const opts = (list, val) => `<option value="">— Select —</option>` + list.map(c => `<option ${key(c) === key(val) ? 'selected' : ''}>${esc(c)}</option>`).join('') +
      (val && !list.some(c => key(c) === key(val)) ? `<option selected value="${esc(val)}">${esc(val)} (current)</option>` : '');
    if (f.type === 'dthClass') return `<label for="${id}">${esc(f.label)}${req}</label><select id="${id}">${opts(boot.dthClasses, v)}</select>`;
    if (f.type === 'loadClass') return `<label for="${id}">${esc(f.label)}${req}</label><select id="${id}">${opts(boot.loadingClasses, v)}</select>`;
    if (f.type === 'area') {
      const cur = v || {}, has = f.areas.some(a => areaKey(a) === areaKey(cur));
      return `<label for="${id}">${esc(f.label)}${req}</label><select id="${id}">
        ${!has && cur.muni ? `<option value="" selected>${esc(cur.muni)}, ${esc(cur.prov)} (current — choose to change)</option>` : ''}
        ${groupByProv(f.areas).map(([prov, list]) => `<optgroup label="${esc(prov)}">${list.map(a => `<option value="${esc(a.muni + '|' + a.prov)}" ${areaKey(a) === areaKey(cur) ? 'selected' : ''}>${esc(a.muni)}</option>`).join('')}</optgroup>`).join('')}</select>`;
    }
    if (f.type === 'brgy') return `<div id="${id}box"></div>`;
    const ph = f.type === 'primary' ? 'Leave blank if none' : '';
    const t = f.type === 'tel' ? 'tel' : 'text';
    return `<label for="${id}">${esc(f.label)}${req}</label><input type="${t}" id="${id}" value="${esc(v)}" placeholder="${ph}" ${f.type === 'primary' || f.type === 'code' ? 'autocapitalize="characters" spellcheck="false"' : ''}>
      ${f.type === 'primary' || f.type === 'tel' ? `<div class="hint" id="${id}hint">${f.type === 'tel' ? '11-digit mobile number starting with 0' : ''}</div>` : ''}`;
  }
  function bindField(f, i) {
    const el = $('#af' + i);
    if (f.type === 'brgy') { drawAmendBrgy(f, i); return; }
    if (!el) return;
    el.oninput = el.onchange = () => {
      if (f.type === 'area') {
        if (!el.value) return;
        const [m, p] = el.value.split('|'); am.values.AREA = { muni: m, prov: p };
        (am.rec.fields || []).forEach((g, j) => { if (g.type === 'brgy') { am.values[g.h] = ''; drawAmendBrgy(g, j); } });
      } else am.values[f.h] = el.value;
      if (f.type === 'primary') primaryHint(f, i);
      if (f.type === 'tel') mobileHint(el, $('#af' + i + 'hint'));
    };
    if (f.type === 'primary') primaryHint(f, i);
    if (f.type === 'tel' && el.value && (am.purpose !== 'CHANGE' || key(el.value) !== key(f.value))) mobileHint(el, $('#af' + i + 'hint'));
  }
  function primaryHint(f, i) {
    const h = $('#af' + i + 'hint'), c = normCode(am.values[f.h]); if (!h) return;
    if (!c) { h.className = 'hint'; h.textContent = 'Optional. Must be an active Loading touchpoint of ' + am.rec.partner + '.'; return; }
    const ok = ((boot.loadingCodesByPartner || {})[am.rec.partner] || []).indexOf(c) > -1;
    h.className = 'hint ' + (ok ? 'ok' : 'bad');
    h.textContent = ok ? '✓ Active Loading touchpoint of ' + am.rec.partner : '✗ Not an active Loading touchpoint of ' + am.rec.partner;
  }
  async function drawAmendBrgy(f, i) {
    await loadBrgy();
    const box = $('#af' + i + 'box'); if (!box) return;
    const area = f.area || am.values.AREA;
    const list = area ? BRGY[key(area.muni) + '|' + key(area.prov)] : null;
    const v = am.values[f.h] || '';
    const label = `<label for="af${i}">${esc(f.label)}${f.req ? ' <span class="req">*</span>' : ''}</label>`;
    if (!list) { box.innerHTML = label + `<input type="text" id="af${i}" value="${esc(v)}">`; $('#af' + i).oninput = e => { am.values[f.h] = e.target.value; }; return; }
    const other = v && list.indexOf(v) < 0;
    box.innerHTML = label + `<select id="af${i}"><option value="">— Select barangay (${list.length}) —</option>
      ${list.map(b => `<option ${b === v ? 'selected' : ''}>${esc(b)}</option>`).join('')}
      <option value="__OTHER__" ${other ? 'selected' : ''}>Other / not in the list…</option></select>
      ${other ? `<input type="text" id="af${i}o" value="${esc(v)}" style="margin-top:8px" placeholder="Type the barangay">` : ''}`;
    $('#af' + i).onchange = e => {
      if (e.target.value === '__OTHER__') { am.values[f.h] = ' '; drawAmendBrgy(f, i); setTimeout(() => { const o = $('#af' + i + 'o'); if (o) { o.value = ''; o.focus(); } am.values[f.h] = ''; }, 0); }
      else am.values[f.h] = e.target.value;
    };
    if ($('#af' + i + 'o')) $('#af' + i + 'o').oninput = e => { am.values[f.h] = e.target.value; };
  }
  function amendProblem() {
    const rec = am.rec;
    if (am.purpose === 'UPGRADE') { if (!am.values.CLASS) return 'Please choose the class to upgrade to'; }
    else for (const f of rec.fields) {
      const v = am.values[f.h];
      if (f.req && (f.type === 'area' ? !(v && v.muni) : !String(v || '').trim())) return 'Please fill in: ' + f.label;
      if (f.type === 'primary' && normCode(v) && ((boot.loadingCodesByPartner || {})[rec.partner] || []).indexOf(normCode(v)) < 0)
        return 'Primary Code is not an active Loading touchpoint of ' + rec.partner;
      // mobile number: checked when entered or changed (an old number left unchanged is not blocked)
      if (f.type === 'tel' && String(v || '').trim() && (am.purpose !== 'CHANGE' || key(v) !== key(f.value)) && !mobileOk(v))
        return f.label + ' must be 11 digits starting with 0 (e.g. 09171234567)';
    }
    if ((am.purpose === 'CHANGE' || am.purpose === 'UPGRADE') && !am.justification.trim()) return 'Please write the justification';
    if (am.purpose === 'CHANGE' && !amendChanges().length) return 'Nothing was changed yet';
    return '';
  }
  function amendChanges() {
    const rec = am.rec;
    if (am.purpose === 'UPGRADE') return [['DTH Acquisition Class', rec.currentClass, am.values.CLASS]];
    if (am.purpose !== 'CHANGE') return rec.fields.map(f => [f.label, '', am.values[f.h] || '—']);
    return rec.fields.filter(f => {
      const v = am.values[f.h], o = f.value;
      return f.type === 'area' ? areaKey(v) !== areaKey(o) : key(v) !== key(o);
    }).map(f => f.type === 'area' ? [f.label, o2s(f.value), o2s(am.values.AREA)] : [f.label, f.value, am.values[f.h]]);
  }
  const o2s = a => a && a.muni ? a.muni + ', ' + a.prov : '';
  function renderAmendReview() {
    const ch = amendChanges(), isChange = am.purpose === 'CHANGE' || am.purpose === 'UPGRADE';
    view.innerHTML = `<div class="card"><h2>Review your amendment</h2>
      <table class="sum"><tr><td>Request</td><td>${esc(amendTitle(am.purpose))}</td></tr><tr><td>Sales Code</td><td>${esc(am.code)}</td></tr>
        <tr><td>Partner</td><td>${esc(am.rec.partner)}</td></tr><tr><td>Touchpoint</td><td>${esc(am.rec.summary.name)}</td></tr>
        <tr class="section"><td colspan="2">${isChange ? 'Changes' : 'Add as ' + esc(am.rec.targetLabel)}</td></tr>
        ${ch.map(c => `<tr><td>${esc(c[0])}</td><td>${isChange ? `<s style="color:#999">${esc(c[1] || '—')}</s><br><b style="color:var(--brand)">${esc(c[2] || '—')}</b>` : `<b style="color:var(--brand)">${esc(c[2])}</b>`}</td></tr>`).join('')}
        ${am.justification.trim() ? `<tr><td>${isChange ? 'Justification' : 'Remarks'}</td><td>${esc(am.justification)}</td></tr>` : ''}
        <tr><td>Approver</td><td>Department (final)</td></tr></table>
      <div class="row-btns"><button class="btn ghost" id="backBtn">‹ Back</button><button class="btn" id="sendBtn">${am.resubmit ? 'Resend' : 'Confirm &amp; Send'}</button></div></div>`;
    $('#backBtn').onclick = () => go('amendForm');
    $('#sendBtn').onclick = sendAmend;
  }
  async function sendAmend() {
    if (!navigator.onLine) { toast('No signal. Connect to the internet to send.'); return; }
    const btn = $('#sendBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Sending…';
    const values = {};
    if (am.purpose === 'CHANGE') {   // send only what changed
      am.rec.fields.forEach(f => { const v = am.values[f.h], o = f.value;
        if (f.type === 'area' ? areaKey(v) !== areaKey(o) : key(v) !== key(o)) values[f.h] = v; });
    } else Object.assign(values, am.values);
    const req = { clientId: uid(), purpose: am.purpose, code: am.code, db: am.db, values, justification: am.justification.trim(), deviceId: DEVICE_ID };
    try {
      const r = am.resubmit ? await api('resubmit', { token: session.token, id: am.resubmit.id, request: req }, 60000)
                            : await api('submitAmend', { token: session.token, request: req }, 60000);
      am.sentId = am.resubmit ? am.resubmit.id : r.requestId; go('amendDone');
    } catch (e) { btn.disabled = false; btn.textContent = am.resubmit ? 'Resend' : 'Confirm & Send'; toast(isNetErr(e) ? 'Could not reach the server.' : e.message, 6000); }
  }
  function renderAmendDone() {
    view.innerHTML = `<div class="card center"><div class="done-mark">✅</div><h2>${am.resubmit ? 'Request resent' : 'Amendment sent'}</h2>
      <p>Request ID: <b>${esc(am.sentId)}</b></p><p class="hint">Status: For approval by the department. You'll get an email once it's decided.</p>
      <button class="btn" id="againBtn">✏️ Another amendment</button><button class="btn ghost" id="homeBtn">Home</button></div>`;
    $('#againBtn').onclick = () => { am = null; go('amend'); };
    $('#homeBtn').onclick = () => { am = null; go('home'); };
  }

  /* ======================= SENDING (also retries after no signal) ======================= */
  async function sync(manual) {
    if (syncing || !session) return;
    if (!navigator.onLine) { if (manual) toast('No signal — will send automatically later.'); return; }
    syncing = true;
    let sent = 0;
    const bar = $('#sendBar');
    try {
      // requests the server already refused are only retried when the rep taps Send
      const items = (await DB.all('queue')).filter(it => manual || !it.error).sort((a, b) => a.savedAt - b.savedAt);
      for (let n = 0; n < items.length; n++) {
        const it = items[n];
        bar.hidden = false;
        $('#sendTxt').textContent = 'Sending ' + (n + 1) + ' of ' + items.length + '… keep the app open';
        $('#sendFill').style.width = Math.round(n / items.length * 100) + '%';
        try {
          const r = await api('submit', { token: session.token, request: it.request }, 120000);
          await DB.del('queue', it.clientId); sent++;
          const recent = ls.get('recent', []);
          recent.unshift({ clientId: it.clientId, requestId: r.requestId, trade: it.request.tradeName, partner: it.request.partner, at: Date.now() });
          ls.set('recent', recent.slice(0, 50));
        } catch (e) {
          if (isNetErr(e)) { if (manual) toast('Still no connection — will try again.'); break; }
          if (e.code === 'AUTH') break;
          it.error = e.message; await DB.put('queue', it);
        }
      }
    } catch (e) { toast('Could not read saved requests: ' + e.message, 5000); }
    finally {
      syncing = false;
      bar.hidden = true;
      if (sent) toast('Sent ' + sent + ' request(s) ✓');
      if (current === 'home' || current === 'done') render();
    }
  }

  /* ======================= START ======================= */
  async function start() {
    ls.del('myReqs');   // old shared cache from an earlier version
    $('#menuBtn').hidden = false;
    $('#who').textContent = session.user.name + ' · ' + session.user.position;
    boot = boot || ls.get('boot:' + key(session.user.name), null);
    startGps();
    const saved = await DB.get('draft', 'current').catch(() => null);
    if (saved && saved.step && saved.step !== 'partner' && boot) { draft = saved; current = saved.step; toast('Continuing your unfinished request'); }
    else current = 'home';
    render();
    refreshBoot(); sync();
    setInterval(() => sync(), 60000);
  }

  setNet();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (session) start(); else renderLogin();
})();
