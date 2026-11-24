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
    x.style.cssText = 'margin-left:auto;background:none;color:#7a5200;border:0;font-size:18px;padding:4px 8px';
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
    session = null; boot = null; ls.del('session');
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

  function stepsBar() {
    const i = STEPS.indexOf(current);
    return `<div class="steps">${STEPS.map((s, j) => `<i class="${j <= i ? 'done' : ''}"></i>`).join('')}</div>
            <div class="step-title">Step ${i + 1} of ${STEPS.length} · ${STEP_LABEL[current]}</div>`;
  }
  const navBtns = (nextLabel, nextDisabled, backTo) => `<div class="row-btns">
      <button class="btn ghost" id="backBtn" data-to="${backTo}">‹ Back</button>
      <button class="btn" id="nextBtn" ${nextDisabled ? 'disabled' : ''}>${nextLabel}</button></div>`;
  function bindBack() { const b = $('#backBtn'); if (b) b.onclick = () => go(b.dataset.to); }

  function render() {
    if (!session) return renderLogin();
    ({ home: renderHome, partner: renderPartner, photo: renderPhoto, location: renderLocation, type: renderType,
       details: renderDetails, agree: renderAgree, review: renderReview, done: renderDone })[current]();
  }

  /* ---------- HOME ---------- */
  async function renderHome() {
    const queue = (await DB.all('queue').catch(() => [])).sort((a, b) => b.savedAt - a.savedAt);
    const recent = ls.get('recent', []);
    const hasDraft = !!(await DB.get('draft', 'current').catch(() => null));
    const loadedAt = boot && boot.loadedAt ? new Date(boot.loadedAt) : null;
    const today = loadedAt && loadedAt.toDateString() === new Date().toDateString();
    view.innerHTML = `
      <div class="notice ${!boot ? 'bad' : today ? 'ok' : 'warn'}">${!boot ? '✗ Partner list not loaded — connect to the internet.'
        : (today ? '✓ ' : '⚠ ') + boot.partners.length + ' partner(s) ready · updated ' +
          (today ? 'today ' + loadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : loadedAt.toLocaleDateString()) +
          (today ? ' · works offline' : ' — connect to update')}</div>
      ${hasDraft ? `<div class="card"><h2>Unfinished request</h2><p class="hint" style="margin-top:0">You have a request you haven't sent yet.</p>
        <button class="btn dark" id="resumeBtn">Continue it</button><button class="btn ghost" id="dropDraftBtn">Delete it</button></div>` : ''}
      <button class="big-choice" id="newBtn" ${boot && boot.partners.length ? '' : 'disabled'}>➕ Register New Touchpoint
        <small>New DTH Acquisition, Loading or OTT touchpoint</small></button>
      <button class="big-choice" disabled>✏️ Amend Existing Touchpoint<small>Coming soon</small></button>
      ${queue.length ? `<div class="card"><h2>${queue.length} request(s) waiting to send</h2>
        ${queue.map(q => `<div class="list-item"><img src="data:image/jpeg;base64,${q.request.image}" alt="">
          <div class="t"><b>${esc(q.request.tradeName)}</b><small>${esc(q.request.partner)} · ${new Date(q.savedAt).toLocaleString()}</small>
          ${q.error ? `<small class="err">Problem: ${esc(q.error)}</small>` : ''}</div>
          <button data-discard="${esc(q.clientId)}">Discard</button></div>`).join('')}
        <button class="btn ghost" id="sendNowBtn" style="margin-top:10px">⬆ Send now</button></div>` : ''}
      ${recent.length ? `<div class="card"><h2>Sent from this phone</h2>${recent.slice(0, 10).map(r => `<div class="list-item"><div class="t">
          <b>${esc(r.trade)}</b> <span class="pill">${esc(r.requestId)}</span><small>${esc(r.partner)} · ${new Date(r.at).toLocaleString()}</small></div></div>`).join('')}</div>` : ''}`;
    $('#newBtn').onclick = () => newDraft();
    if (hasDraft) {
      $('#resumeBtn').onclick = async () => { draft = await DB.get('draft', 'current'); go(draft.step || 'partner'); };
      $('#dropDraftBtn').onclick = async () => { if (confirm('Delete the unfinished request?')) { await clearDraft(); draft = null; render(); } };
    }
    view.querySelectorAll('[data-discard]').forEach(b => b.onclick = async () => {
      if (!confirm('Delete this request from the phone? It has NOT been sent.')) return;
      await DB.del('queue', b.dataset.discard); render();
    });
    const sn = $('#sendNowBtn'); if (sn) sn.onclick = () => sync(true);
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
        if (draft.locate.status === 'OK') { draft.gridMuni = draft.locate.match.muni; draft.gridProv = draft.locate.match.prov; }
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
    const sel = options.length && st !== 'OK' ? `<label for="muniSel">${st === 'CONFIRM_MUNI' ? 'Confirm municipality' : 'Municipality'} <span class="req">*</span></label>
      <select id="muniSel"><option value="">— Select municipality —</option>
      ${groupByProv(options).map(([prov, list]) => `<optgroup label="${esc(prov)}">${list.map(a => {
        const v = a.muni + '|' + a.prov; return `<option value="${esc(v)}" ${v === draft.gridMuni + '|' + draft.gridProv ? 'selected' : ''}>${esc(a.muni)}</option>`; }).join('')}</optgroup>`).join('')}
      </select>` : '';
    const det = L && L.detected ? L.detected : {};
    let box = '';
    const nearNote = det.mappedBy === 'nearest' ? `<br><small>GPS town “${esc(det.city)}” is not in GRID, so it was matched to the nearest GRID municipality (${esc(det.distanceKm)} km away).</small>` : '';
    if (st === 'OK') box = `<div class="notice ok"><b>✓ Location verified</b>${esc(L.match.muni)}, ${esc(L.match.prov)} is within ${esc(draft.partner)}'s coverage.${nearNote}</div>`;
    else if (st === 'CONFIRM_MUNI') box = `<div class="notice warn"><b>Please confirm the municipality</b>GPS shows <b style="display:inline">${esc(det.city || det.gridMuni)}</b>, which is not in ${esc(draft.partner)}'s assigned municipalities for ${esc(/^NCR|^MANILA$/i.test(det.gridProv || '') ? 'Metro Manila' : det.gridProv)}. Choose the correct one below.${nearNote}</div>`;
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
        <label for="contact">Contact Number <span class="req">*</span></label><input type="tel" id="contact" value="${esc(draft.contact)}" placeholder="09XX XXX XXXX">` : ''}
      ${t.loading ? `<h3>Loading</h3>
        <label for="loadingClass">Loading Classification <span class="req">*</span></label><select id="loadingClass">${opts(boot.loadingClasses, draft.loadingClass)}</select>
        <label for="loadingPrimary">Primary Code <span class="hint" style="display:inline">(optional)</span></label>
        <input type="text" id="loadingPrimary" value="${esc(draft.loadingPrimary)}" autocapitalize="characters" spellcheck="false">
        <div id="primaryHint" class="hint">Leave blank if none. If filled, it must be an active Loading touchpoint.</div>` : ''}
      ${t.ott ? `<h3>OTT Acquisition</h3>
        <label for="ottClass">OTT Classification <span class="req">*</span></label><select id="ottClass">${opts(boot.ottClasses, draft.ottClass)}</select>
        <label for="ottPrimary">Primary Salescode <span class="hint" style="display:inline">(optional)</span></label>
        <input type="text" id="ottPrimary" value="${esc(draft.ottPrimary)}" autocapitalize="characters" spellcheck="false">` : ''}
      ${navBtns('Next ›', false, 'type')}</div>`;
    const bind = (id, prop) => { const el = $('#' + id); if (el) el.oninput = el.onchange = () => { draft[prop] = el.value; saveDraft(); if (id === 'loadingPrimary') checkPrimary(); }; };
    [['tradeName', 'tradeName'], ['dthClass', 'dthClass'], ['owner', 'owner'], ['contact', 'contact'], ['loadingClass', 'loadingClass'],
     ['loadingPrimary', 'loadingPrimary'], ['ottClass', 'ottClass'], ['ottPrimary', 'ottPrimary']].forEach(([a, b]) => bind(a, b));
    if (t.loading) checkPrimary();
    bindBack();
    $('#nextBtn').onclick = () => { const miss = detailsProblem(); if (miss) { toast(miss); return; } go('agree'); };
  }
  function primaryOk() { const c = normCode(draft.loadingPrimary); return !c || (boot.activeLoadingCodes || []).indexOf(c) > -1; }
  function checkPrimary() {
    const h = $('#primaryHint'), inp = $('#loadingPrimary'); if (!h) return;
    const c = normCode(draft.loadingPrimary);
    if (!c) { h.className = 'hint'; h.textContent = 'Leave blank if none. If filled, it must be an active Loading touchpoint.'; inp.classList.remove('invalid'); return; }
    const ok = primaryOk();
    h.className = 'hint ' + (ok ? 'ok' : 'bad');
    h.textContent = ok ? '✓ Active Loading touchpoint' : '✗ Not found among active Loading touchpoints. Please check the code.';
    inp.classList.toggle('invalid', !ok);
  }
  function detailsProblem() {
    const t = typeInfo(draft.type);
    if (!draft.tradeName.trim()) return 'Please enter the Trade Name';
    if (t.dth) {
      if (!draft.dthClass) return 'Please choose the DTH Acquisition Class';
      if (!draft.owner.trim()) return 'Please enter the Owner Name / CS Email';
      if (!draft.contact.trim()) return 'Please enter the Contact Number';
    }
    if (t.loading) { if (!draft.loadingClass) return 'Please choose the Loading Classification'; if (!primaryOk()) return 'Primary Code is not an active Loading touchpoint'; }
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
      <img class="thumb" src="data:image/jpeg;base64,${draft.image}" alt="">
      <table class="sum">
        ${sec('Request')}${row('Action', 'Register New Touchpoint')}${row('Touchpoint type', typeLabel(draft.type))}
        ${row('Partner', draft.partner)}${row('Requestor', session.user.name + ' (' + session.user.position + ')')}
        ${sec('Touchpoint')}${row('Trade Name', draft.tradeName)}
        ${t.dth ? row('DTH Class', draft.dthClass) + row('Owner / CS Email', draft.owner) + row('Contact Number', draft.contact) : ''}
        ${t.loading ? row('Loading Classification', draft.loadingClass) + row('Primary Code', normCode(draft.loadingPrimary) || '—') : ''}
        ${t.ott ? row('OTT Classification', draft.ottClass) + row('OTT Primary Salescode', normCode(draft.ottPrimary) || '—') : ''}
        ${sec('Location')}${row('Municipality', draft.gridMuni)}${row('Province', draft.gridProv)}
        ${row('Barangay', draft.brgy)}${row('Street', draft.street)}
        ${row('GPS', draft.lat.toFixed(6) + ', ' + draft.lng.toFixed(6) + ' (±' + draft.acc + ' m)')}
        ${row('Location check', draft.offline ? 'Will be checked when sent' : ({ OK: 'Verified by GPS', CONFIRM_MUNI: 'Municipality confirmed by you', UNVERIFIED: 'Not verified' })[draft.locate.status])}
        ${sec('Agreement')}${row('Terms and Conditions', 'Accepted')}${row('Consent', 'Accepted')}
      </table>
      <div class="row-btns"><button class="btn ghost" id="backBtn" data-to="agree">‹ Back</button>
        <button class="btn" id="sendBtn">Confirm &amp; Send</button></div></div>`;
    bindBack();
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

  /* ======================= SENDING (also retries after no signal) ======================= */
  async function sync(manual) {
    if (syncing || !session) return;
    if (!navigator.onLine) { if (manual) toast('No signal — will send automatically later.'); return; }
    syncing = true;
    let sent = 0;
    try {
      const items = (await DB.all('queue')).sort((a, b) => a.savedAt - b.savedAt);
      for (const it of items) {
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
      if (sent) toast('Sent ' + sent + ' request(s) ✓');
      if (current === 'home' || current === 'done') render();
    }
  }

  /* ======================= START ======================= */
  async function start() {
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
