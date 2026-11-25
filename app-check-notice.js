// App test notice: while the admin tests this laptop's apps from the App Check Server (electron/app-check.js), a
// card in the bottom-right corner says so, lists each app with its progress, and has a Stop button. The apps open
// and close by themselves during the test. Loaded on the sign-in page too, so a test there is not a surprise.
(function () {
  const api = window.saleskit;
  if (!api || typeof api.onAppCheckState !== 'function') return;

  const style = document.createElement('style');
  style.textContent = `
    .app-check-notice {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 5000;
      width: min(380px, calc(100vw - 40px));
      overflow: hidden;
      border-radius: 14px;
      background: #fff;
      box-shadow: 0 18px 48px rgba(15, 23, 42, .32);
      color: #0f172a;
      font-family: 'Outfit', 'Segoe UI', sans-serif;
      font-size: 14px;
    }
    .app-check-notice[hidden] { display: none; }
    .app-check-notice-head {
      padding: 14px 18px;
      background: linear-gradient(135deg, #0012b3, #003ecb);
      color: #fff;
    }
    .app-check-notice-head b { display: block; font-size: 1.02rem; font-weight: 800; }
    .app-check-notice-head span { display: block; margin-top: 2px; font-size: .8rem; opacity: .88; }
    .app-check-notice ul { margin: 0; padding: 8px 18px; list-style: none; }
    .app-check-notice li { padding: 7px 0; border-bottom: 1px solid #eef2f8; }
    .app-check-notice li:last-child { border-bottom: 0; }
    .app-check-notice-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-weight: 700; }
    .app-check-notice-detail { margin-top: 2px; color: #64748b; font-size: .76rem; line-height: 1.3; word-break: break-word; }
    .app-check-status { flex: none; padding: 2px 9px; border-radius: 999px; background: #eef1f6; color: #64748b; font-size: .7rem; font-weight: 800; }
    .app-check-status.testing { background: #e4e9fb; color: #1d3ae0; }
    .app-check-status.ok { background: #e2f5e9; color: #14783a; }
    .app-check-status.bad { background: #fde6e6; color: #c42424; }
    .app-check-status.warn { background: #fdf0d8; color: #a4510a; }
    .app-check-notice-foot { display: flex; justify-content: flex-end; padding: 10px 18px 14px; }
    .app-check-notice-foot button {
      padding: 7px 16px;
      border: 1px solid #f0bcbc;
      border-radius: 8px;
      background: #fff;
      color: #c42424;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    .app-check-notice-foot button:disabled { opacity: .6; cursor: default; }
    /* Header chip: this laptop's scheduled check (from head office's App Tests page). */
    .app-check-chip { display: inline-flex; align-items: center; gap: 5px; margin-left: 8px; padding: 1px 9px; border-radius: 999px;
      background: rgba(255, 255, 255, .16); border: 1px solid rgba(255, 255, 255, .35); color: #fff; font-size: .72rem; font-weight: 700;
      white-space: nowrap; vertical-align: middle; cursor: default; }
    .app-check-chip.done { background: rgba(34, 197, 94, .25); border-color: rgba(134, 239, 172, .7); }
    .app-check-chip.missed { background: rgba(239, 68, 68, .25); border-color: rgba(252, 165, 165, .7); }
    .app-check-chip.now { background: rgba(250, 204, 21, .25); border-color: rgba(253, 224, 71, .75); }
  `;
  document.head.appendChild(style);

  const card = document.createElement('section');
  card.className = 'app-check-notice';
  card.hidden = true;
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
  card.innerHTML = `
    <div class="app-check-notice-head">
      <b>Admin is testing this laptop's apps</b>
      <span>Please wait. Apps will open and close by themselves.</span>
    </div>
    <ul></ul>
    <div class="app-check-notice-foot"><button type="button">Stop test</button></div>`;
  const list = card.querySelector('ul');
  const stopButton = card.querySelector('button');
  stopButton.addEventListener('click', () => {
    stopButton.disabled = true;
    api.stopAppCheck();
  });

  const LABELS = {
    waiting: 'Waiting', testing: 'Testing', ok: 'OK', exited: 'Closed early', crashed: 'Crashed', failed: 'Failed',
    missing: 'File missing', not_installed: 'Not installed', stopped: 'Stopped'
  };
  const tone = (status) => ({ testing: 'testing', ok: 'ok', exited: 'warn', stopped: 'warn', waiting: '' }[status] ?? 'bad');

  function render(state) {
    if (!state || !state.running) {
      card.hidden = true;
      stopButton.disabled = false;
      stopButton.textContent = 'Stop test';
      return;
    }
    list.replaceChildren(...(state.targets || []).map((target) => {
      const item = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'app-check-notice-row';
      const name = document.createElement('span');
      name.textContent = target.name;
      const badge = document.createElement('span');
      badge.className = `app-check-status ${tone(target.status)}`;
      badge.textContent = LABELS[target.status] || target.status;
      row.append(name, badge);
      item.append(row);
      if (target.detail && target.status === 'testing') {
        const detail = document.createElement('div');
        detail.className = 'app-check-notice-detail';
        detail.textContent = target.detail;
        item.append(detail);
      }
      return item;
    }));
    stopButton.disabled = Boolean(state.stopping);
    stopButton.textContent = state.stopping ? (state.stoppedBy === 'admin' ? 'Stopped by head office...' : 'Stopping...') : 'Stop test';
    card.hidden = false;
  }

  // ---- Header chip: "Daily check today 1:45–1:55 PM", "Checked today ✓", "Next check Sat 1:00 PM" ----
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const NAMES = { daily: 'Daily check', apps: 'App tests' };
  const clock = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  };
  const minutesOf = (hhmm) => Number(String(hhmm).slice(0, 2)) * 60 + Number(String(hhmm).slice(3, 5));
  // The next day (from tomorrow) the check runs.
  const nextDay = (days) => { const today = new Date().getDay(); for (let i = 1; i <= 7; i += 1) if (days.includes((today + i) % 7)) return i === 1 ? 'tomorrow' : DAYS[(today + i) % 7]; return ''; };
  function chipFor(job) {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const what = `${NAMES[job.id] || 'Check'} (${job.checks.map((c) => ({ banner: 'banner', desktop: 'desktop', apps: 'apps' }[c] || c)).join(', ')})`;
    const days = job.days.length === 7 ? 'every day' : job.days.map((d) => DAYS[d]).join(', ');
    const tip = `${what}, ${days}, ${clock(job.start)} to ${clock(job.end)}. Set by head office. Wi-Fi is turned on for the check if it is off, and off again right after. App tests open and close apps on this laptop by themselves.`;
    if (job.today && job.status === 'done') return { tone: 'done', text: `${NAMES[job.id]} done today ✓`, tip };
    if (job.today && (job.status === 'missed' || job.status === 'partial')) return { tone: 'missed', text: `${NAMES[job.id]}: ${job.status === 'partial' ? 'apps not tested' : 'not checked'} today`, tip: `${job.reason || ''}\n${tip}`.trim() };
    if (job.today && minutes < minutesOf(job.end)) {
      return minutes >= minutesOf(job.start)
        ? { tone: 'now', text: `${NAMES[job.id]} now (until ${clock(job.end)})`, tip }
        : { tone: '', text: `${NAMES[job.id]} today ${clock(job.start)}`, tip };
    }
    const next = nextDay(job.days);
    return next ? { tone: '', text: `Next ${NAMES[job.id].toLowerCase()} ${next} ${clock(job.start)}`, tip } : null;
  }
  const chip = document.createElement('span');
  chip.className = 'app-check-chip';
  chip.hidden = true;
  async function renderChip() {
    if (typeof api.getAppCheckSchedule !== 'function') return;
    const anchor = document.getElementById('laptopSkuLabel') || document.getElementById('signedInUser');
    if (!anchor) return;
    let jobs = [];
    try { jobs = await api.getAppCheckSchedule(); } catch { jobs = []; }
    // The one that matters most: running now, then today's, then the next.
    const chips = (jobs || []).map(chipFor).filter(Boolean);
    const pick = chips.find((c) => c.tone === 'now') || chips.find((c) => c.tone === 'missed') || chips.find((c) => /today/.test(c.text) && c.tone === '') || chips[0];
    if (!pick) { chip.hidden = true; return; }
    if (chip.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', chip);
    chip.className = `app-check-chip ${pick.tone}`;
    chip.textContent = `🗓 ${pick.text}${chips.length > 1 ? ` · +${chips.length - 1}` : ''}`;
    chip.title = chips.map((c) => c.tip).join('\n\n');
    chip.hidden = false;
  }

  function start() {
    document.body.appendChild(card);
    api.onAppCheckState(render);
    api.getAppCheckState().then(render).catch(() => {});
    renderChip();
    setInterval(renderChip, 30 * 1000);
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
