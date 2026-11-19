// The SalesKit Server window's bridge (preload.js → window.salesKitServer) for the web version (/server). Each
// call goes to POST /server/api/call with the same channel the window uses over IPC; live updates come from
// GET /server/api/events. A sign-in screen (server admins only) comes first: calls made before signing in wait for it.
// What only works on the server computer is done here instead: choosing the Google key uploads the file, the
// Copy buttons copy on this computer, and the backups folder is shown as a path.
(function () {
  'use strict';
  const STORE = 'saleskitServerWebSession';
  let sessionKey = '';
  try { sessionKey = sessionStorage.getItem(STORE) || ''; } catch { /* not kept */ }
  let me = null;
  let signedIn = null; // resolves once signed in
  let resolveSignedIn = null;
  const listeners = {}; // channel → Set(callback)
  let events = null;

  function waitForSignIn() {
    if (!signedIn) signedIn = new Promise((resolve) => { resolveSignedIn = resolve; });
    return signedIn;
  }

  async function post(path, body, withSession = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (withSession && sessionKey) headers['X-SalesKit-Session'] = sessionKey;
    let response;
    try {
      response = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    } catch {
      throw new Error('The server did not answer. It may be restarting; try again in a moment.');
    }
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  }

  // One action of the server (server/main.js), as the window calls it. A lost session shows the sign-in screen and
  // repeats the call afterwards.
  async function call(channel, ...args) {
    if (!sessionKey) await waitForSignIn();
    for (;;) {
      const { status, data } = await post('/server/api/call', { channel, args });
      if (status === 401) {
        sessionKey = '';
        signedIn = null;
        showSignIn('Please sign in again.');
        await waitForSignIn();
        continue;
      }
      if (status !== 200) throw new Error(data.error || 'The server could not do that.');
      return data.result;
    }
  }

  // ---------- live updates ----------
  function subscribe(channel, callback) {
    if (!listeners[channel]) listeners[channel] = new Set();
    listeners[channel].add(callback);
    return () => listeners[channel].delete(callback);
  }
  function openEvents() {
    if (events) events.close();
    events = new EventSource(`/server/api/events?session=${encodeURIComponent(sessionKey)}`);
    ['server:state', 'server:devices', 'server:logos', 'server:log', 'server:sync-progress'].forEach((channel) => {
      events.addEventListener(channel, (event) => {
        let payload = null;
        try { payload = JSON.parse(event.data); } catch { return; }
        (listeners[channel] || []).forEach((callback) => { try { callback(payload); } catch (e) { console.error(e); } });
      });
    });
    // Reconnects by itself (e.g. after the server restarts for an update); once back, the page is brought up to date.
    events.addEventListener('hello', () => {
      setStatus('');
      call('server:get-state').then((state) => (listeners['server:state'] || []).forEach((cb) => cb(state))).catch(() => {});
    });
    events.onerror = () => setStatus('Reconnecting to the server…');
  }

  // ---------- this computer: copying and choosing files ----------
  async function copy(text) {
    text = String(text == null ? '' : text);
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
    } catch { /* fall back below */ }
    // Pages on http:// (not localhost) have no clipboard API: copy through a hidden text box.
    const box = document.createElement('textarea');
    box.value = text;
    box.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(box);
    box.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    box.remove();
    if (!ok) window.prompt('Copy this (Ctrl+C):', text);
    return true;
  }
  function chooseFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.display = 'none';
      input.addEventListener('change', () => resolve(input.files[0] || null));
      // No change event when the window is closed without a file: give up when the page gets the focus back.
      window.addEventListener('focus', () => setTimeout(() => resolve(input.files[0] || null), 800), { once: true });
      document.body.appendChild(input);
      input.click();
      setTimeout(() => input.remove(), 60000);
    });
  }

  // ---------- the bridge, as preload.js has it ----------
  const c = (channel) => (...args) => call(channel, ...args);
  window.salesKitServer = {
    getState: c('server:get-state'),
    getLogs: c('server:get-logs'),
    syncNow: c('server:sync-now'),
    clearPriceChanges: c('server:clear-price-changes'),
    getPriceChanges: c('server:price-changes'),
    deletePriceChanges: c('server:delete-price-changes'),
    checkClientRelease: c('server:check-client-release'),
    checkServerUpdate: c('server:check-server-update'),
    getDataHealth: (recheck) => call('server:data-health', Boolean(recheck)),
    installServerUpdate: async () => {
      const result = await call('server:install-server-update');
      if (result && result.ok) setStatus('The server is restarting to update. This page reconnects by itself; you may need to sign in again.');
      return result;
    },
    chooseKey: async () => {
      const file = await chooseFile('.json,application/json');
      if (!file) return call('server:get-state');
      return call('server:set-key-file', await file.text());
    },
    updateSettings: c('server:update-settings'),
    copyToken: async () => copy(await call('server:get-token')),
    copyText: (text) => copy(text),
    copyClientConfig: async (address) => copy(await call('server:client-config-text', address)),
    newToken: c('server:new-token'),
    getTableData: c('server:table-data'),
    getDevices: c('server:get-devices'),
    getActivitySummary: c('server:get-activity-summary'),
    forgetDevice: c('server:forget-device'),
    backupNow: c('server:backup-now'),
    restoreBackup: c('server:restore-backup'),
    openBackupsFolder: async () => {
      const folder = await call('server:backups-folder-path');
      window.prompt('The backups are in this folder on the server computer:', folder);
      return '';
    },
    onState: (callback) => subscribe('server:state', callback),
    onDevices: (callback) => subscribe('server:devices', callback),
    getRejected: c('server:get-rejected'),
    clearRejected: c('server:clear-rejected'),
    getUsers: c('server:get-users'),
    getBranches: c('server:get-branches'),
    createUser: c('server:create-user'),
    updateUser: c('server:update-user'),
    setUserPassword: c('server:set-user-password'),
    revealPassword: c('server:reveal-password'),
    signOutUser: c('server:sign-out-user'),
    removeUser: c('server:remove-user'),
    getLogos: c('server:get-logos'),
    onLogos: (callback) => subscribe('server:logos', callback),
    onLog: (callback) => subscribe('server:log', callback),
    onSyncProgress: (callback) => subscribe('server:sync-progress', callback)
  };

  // ---------- sign-in screen and the "signed in" chip ----------
  const style = document.createElement('style');
  style.textContent = `
    #webSignIn { position: fixed; inset: 0; z-index: 3000; display: none; align-items: center; justify-content: center;
      background: linear-gradient(135deg, #0012b3, #0a3cff); font-family: 'Plus Jakarta Sans', sans-serif; }
    #webSignIn.open { display: flex; }
    #webSignIn form { width: 360px; max-width: calc(100% - 32px); background: #fff; border-radius: 16px; padding: 28px 26px;
      box-shadow: 0 24px 60px rgba(0,0,0,.35); }
    #webSignIn h1 { font-size: 20px; font-weight: 800; color: #0012b3; margin: 0 0 4px; }
    #webSignIn p { font-size: 13px; color: #64748b; margin: 0 0 18px; }
    #webSignIn label { display: block; font-size: 12.5px; font-weight: 700; color: #334155; margin: 10px 0 5px; }
    #webSignIn input { width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 9px; font: inherit; font-size: 14px; }
    #webSignIn button { width: 100%; margin-top: 18px; padding: 11px; border: 0; border-radius: 10px; background: #0012b3; color: #fff; font-weight: 800; font-size: 14px; cursor: pointer; }
    #webSignIn button:disabled { opacity: .6; }
    #webSignIn .err { color: #b91c1c; font-size: 12.5px; font-weight: 600; min-height: 18px; margin-top: 10px; }
    #webChip { position: fixed; right: 14px; bottom: 14px; z-index: 2500; display: none; align-items: center; gap: 8px;
      background: #0f172a; color: #e2e8f0; border-radius: 999px; padding: 6px 8px 6px 14px; font: 600 12px 'Plus Jakarta Sans', sans-serif;
      box-shadow: 0 8px 24px rgba(0,0,0,.25); }
    #webChip.open { display: flex; }
    #webChip b { color: #fff; }
    #webChip button { border: 0; border-radius: 999px; background: #334155; color: #fff; padding: 4px 10px; font: inherit; cursor: pointer; }
    #webStatus { position: fixed; left: 50%; top: 12px; transform: translateX(-50%); z-index: 2600; display: none; background: #fef3c7;
      color: #92400e; border-radius: 10px; padding: 8px 14px; font: 700 12.5px 'Plus Jakarta Sans', sans-serif; box-shadow: 0 6px 18px rgba(0,0,0,.15); }
    #webStatus.open { display: block; }`;
  document.head.appendChild(style);

  function build() {
    const box = document.createElement('div');
    box.id = 'webSignIn';
    box.innerHTML = `<form autocomplete="on">
      <h1>Sales Tools Server</h1>
      <p>Web version. Sign in with a Sales Tools account that is a server admin.</p>
      <label for="webUser">Username</label><input id="webUser" name="username" autocomplete="username" required>
      <label for="webPass">Password</label><input id="webPass" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
      <div class="err" id="webErr"></div>
    </form>`;
    document.body.appendChild(box);
    box.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = box.querySelector('button');
      button.disabled = true;
      document.getElementById('webErr').textContent = '';
      try {
        const { status, data } = await post('/server/api/login', { username: document.getElementById('webUser').value, password: document.getElementById('webPass').value }, false);
        if (status !== 200) { document.getElementById('webErr').textContent = data.error || 'Could not sign in.'; return; }
        sessionKey = data.sessionKey;
        me = data.user;
        try { sessionStorage.setItem(STORE, sessionKey); } catch { /* not kept */ }
        document.getElementById('webPass').value = '';
        signedInNow();
      } catch (error) {
        document.getElementById('webErr').textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });

    const chip = document.createElement('div');
    chip.id = 'webChip';
    chip.innerHTML = '<span><i class="bi bi-globe2"></i> Web · <b id="webMe"></b></span><button type="button" id="webOut">Sign out</button>';
    document.body.appendChild(chip);
    document.getElementById('webOut').addEventListener('click', async () => {
      await post('/server/api/logout', {}).catch(() => {});
      try { sessionStorage.removeItem(STORE); } catch { /* not kept */ }
      location.reload();
    });

    const status = document.createElement('div');
    status.id = 'webStatus';
    document.body.appendChild(status);
  }

  function setStatus(text) {
    const box = document.getElementById('webStatus');
    if (!box) return;
    box.textContent = text;
    box.classList.toggle('open', Boolean(text));
  }

  function showSignIn(message) {
    if (events) { events.close(); events = null; }
    document.getElementById('webChip').classList.remove('open');
    document.getElementById('webSignIn').classList.add('open');
    document.getElementById('webErr').textContent = message || '';
    setTimeout(() => document.getElementById('webUser').focus(), 50);
  }

  function signedInNow() {
    document.getElementById('webSignIn').classList.remove('open');
    document.getElementById('webMe').textContent = (me && (me.displayName || me.username)) || 'signed in';
    document.getElementById('webChip').classList.add('open');
    openEvents();
    waitForSignIn();
    resolveSignedIn();
  }

  function start() {
    build();
    if (!sessionKey) return showSignIn('');
    // A session kept from before (page reloaded): check it still works.
    post('/server/api/call', { channel: 'server:get-state', args: [] }).then(({ status }) => {
      if (status === 200) signedInNow();
      else { sessionKey = ''; showSignIn(''); }
    }).catch(() => showSignIn('The server did not answer.'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
