// Scheduled checks for App Tests (server/app-check.js): the "Daily check" (banner on screen and desktop, and the
// apps too when "Include app tests" is ticked) and "App tests" on their own schedule. Each schedule says on which
// days, between which times, and on which laptops (all, some branches, or some laptops). The laptops keep their
// schedule and run it themselves (electron/app-check.js): they turn Wi-Fi on for the check and off again after it
// when it was off before, and only test apps while nobody uses the laptop.
// Every check a laptop reports is one line of checks.jsonl; the CSV export is made from it (and from the manual
// tests in runs.jsonl).

const JOBS = ['daily', 'apps'];
const JOB_LABEL = { daily: 'Daily check', apps: 'App tests', manual: 'Manual app test' };
const DAY_MS = 24 * 60 * 60 * 1000;

const text = (value, max = 60) => String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
const time = (value, fallback) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value)) ? String(value) : fallback);
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
// "2026-11-25" in this computer's time zone.
const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const DEFAULTS = {
  daily: { enabled: false, days: [0, 1, 2, 3, 4, 5, 6], start: '12:00', end: '15:00', includeApps: false, scope: { mode: 'laptops', branches: [], laptops: [] } },
  apps: { enabled: false, days: [6], start: '13:00', end: '16:00', scope: { mode: 'laptops', branches: [], laptops: [] } }
};

// A schedule as saved: days 0 (Sunday) to 6, start before end, and who it is for.
function cleanSchedule(job, value, before = {}) {
  const base = { ...DEFAULTS[job], ...(value && typeof value === 'object' ? value : {}) };
  const days = [...new Set((Array.isArray(base.days) ? base.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  let start = time(base.start, DEFAULTS[job].start);
  let end = time(base.end, DEFAULTS[job].end);
  if (minutesOf(end) <= minutesOf(start)) end = DEFAULTS[job].end > start ? DEFAULTS[job].end : '23:59';
  const scope = base.scope && typeof base.scope === 'object' ? base.scope : {};
  const list = (items, max) => [...new Set((Array.isArray(items) ? items : []).map((x) => text(x, 80)).filter(Boolean))].slice(0, max);
  const enabled = Boolean(base.enabled);
  return {
    enabled,
    days,
    start,
    end,
    ...(job === 'daily' ? { includeApps: Boolean(base.includeApps) } : {}),
    scope: {
      mode: ['all', 'branches', 'laptops'].includes(scope.mode) ? scope.mode : 'laptops',
      branches: list(scope.branches, 100).map((b) => b.toUpperCase()),
      laptops: list(scope.laptops, 500)
    },
    // Since when it is on: days before that are not "Not checked".
    enabledAt: enabled ? (before.enabled && before.enabledAt ? before.enabledAt : new Date().toISOString()) : null
  };
}

function cleanSchedules(value, before = {}) {
  const out = {};
  for (const job of JOBS) out[job] = cleanSchedule(job, value && value[job], before[job]);
  const idle = Math.round(Number(value && value.idleMinutes));
  out.idleMinutes = Number.isFinite(idle) && idle >= 1 && idle <= 60 ? idle : 5;
  return out;
}

// Is this laptop (its computer name and branch) one the schedule is for?
function inScope(schedule, name, branch) {
  const { mode, branches, laptops } = schedule.scope;
  if (mode === 'all') return true;
  if (mode === 'branches') return Boolean(branch) && branches.includes(String(branch).toUpperCase());
  return laptops.includes(name);
}

// What a laptop gets on its check-in: its jobs ({ id, days, start, end, checks: ['banner', 'desktop', 'apps'] }) and
// how long it must be idle before apps are tested.
function scheduleFor(schedules, name, branch) {
  const jobs = [];
  for (const id of JOBS) {
    const s = schedules[id];
    if (!s.enabled || !s.days.length || !inScope(s, name, branch)) continue;
    const checks = id === 'daily' ? ['banner', 'desktop', ...(s.includeApps ? ['apps'] : [])] : ['apps'];
    jobs.push({ id, days: s.days, start: s.start, end: s.end, checks });
  }
  return { idleMinutes: schedules.idleMinutes, jobs };
}

// Today's state of each scheduled job on a laptop, for the page: { daily: {...}, apps: {...} } with status
// 'done' | 'interrupted' | 'missed' | 'waiting' | 'running' | 'nocheck' (window over, no report) | 'off' (not today).
function todayFor(schedules, laptop, checks, now = new Date()) {
  const date = localDate(now);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const out = {};
  for (const id of JOBS) {
    const s = schedules[id];
    if (!s.enabled || !inScope(s, laptop.name, laptop.branch)) continue;
    if (!s.days.includes(now.getDay())) { out[id] = { status: 'off' }; continue; }
    const mine = checks.filter((c) => c.laptop === laptop.name && c.job === id && c.date === date && c.trigger !== 'now');
    const last = mine[mine.length - 1];
    if (last) { out[id] = { status: last.status, time: last.time, reason: last.reason }; continue; }
    if (minutes < minutesOf(s.start)) out[id] = { status: 'waiting', from: s.start, to: s.end };
    else if (minutes < minutesOf(s.end)) out[id] = { status: 'running', from: s.start, to: s.end };
    else out[id] = { status: 'nocheck', reason: 'No report: Sales Tools was closed or the laptop was off' };
  }
  return out;
}

const BANNER_LABEL = { match: 'Matches the laptop', different: 'Different laptop', nosku: 'No Laptop SKU to compare', unknown: 'Cannot tell', nobanner: 'No banner on screen', none: '' };
const STATUS_LABEL = { done: 'Done', interrupted: 'Stopped: laptop used', missed: 'Not checked', nocheck: 'Not checked' };
const APP_LABEL = { ok: 'Passed', not_installed: 'Not installed', exited: 'Closed early', crashed: 'Crashed', failed: 'Failed', missing: 'No demo file', stopped: 'Stopped' };

// The CSV rows for checks and manual tests between from and to ("YYYY-MM-DD", both included), one row per app tested
// (a check without app tests is one row). filter: { branch, type: '' | 'daily' | 'apps' | 'manual' }.
// laptops: [{ name, branch }] now, to list the scheduled checks that never reported as "Not checked".
function csvRows({ checks, runs, schedules, laptops, from, to, branch, type }) {
  const inRange = (date) => (!from || date >= from) && (!to || date <= to);
  const wanted = (job, br) => (!type || type === job) && (!branch || br === branch);
  const secs = (ms) => (ms === undefined || ms === null ? '' : Math.round(ms / 1000));
  const header = ['Date', 'Time', 'Check', 'Started by', 'Branch', 'Laptop SKU', 'Laptop', 'Computer name', 'Status', 'Reason', 'Banner', 'Banner on screen', 'Desktop', 'Desktop: not allowed', 'Desktop: missing', 'Wi-Fi', 'App', 'App result', 'App seconds', 'App detail'];
  const rows = [];
  for (const c of checks) {
    if (!inRange(c.date) || !wanted(c.job, c.branch)) continue;
    const t = new Date(c.time);
    const base = [c.date, t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), JOB_LABEL[c.job] || c.job, c.trigger === 'now' ? 'Run now (App Tests page)' : 'Schedule',
      c.branch, c.sku || '', [c.make, c.model].filter(Boolean).join(' '), c.laptop, STATUS_LABEL[c.status] || c.status, c.reason || '',
      c.banner ? BANNER_LABEL[c.banner.status] || c.banner.status : '', c.banner ? c.banner.item || '' : '',
      c.desktop ? (c.desktop.status === 'ok' ? 'Correct' : c.desktop.status === 'check' ? 'Not correct' : 'Not reported') : '',
      c.desktop ? (c.desktop.extra || []).join(', ') : '', c.desktop ? (c.desktop.missing || []).join(', ') : '', c.wifi || ''];
    if (c.apps && c.apps.length) for (const r of c.apps) rows.push([...base, r.target, APP_LABEL[r.status] || r.status, secs(r.ms), r.detail || '']);
    else rows.push([...base, '', c.appsNote || '', '', '']);
  }
  // Manual tests (Run test on the Laptops tab); scheduled ones are in the checks above.
  if (!type || type === 'manual') {
    for (const run of runs) {
      if (run.job) continue;
      const t = new Date(run.startedAt || run.time);
      const date = localDate(t);
      if (!inRange(date) || (branch && run.branch !== branch)) continue;
      const base = [date, t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), JOB_LABEL.manual, 'Run test (App Tests page)', run.branch, run.sku || '', [run.make, run.model].filter(Boolean).join(' '), run.laptop,
        run.stoppedOnLaptop ? 'Stopped on the laptop' : run.stoppedByAdmin ? 'Cancelled' : 'Done', '', '', '', '', '', '', ''];
      for (const r of run.results) rows.push([...base, r.target, APP_LABEL[r.status] || r.status, secs(r.ms), r.detail || '']);
    }
  }
  // Scheduled checks with no report at all: each day in the range the schedule was on, for the laptops it is for now.
  const today = localDate();
  for (const id of JOBS) {
    const s = schedules[id];
    if (!s.enabledAt || (type && type !== id)) continue;
    const first = localDate(new Date(s.enabledAt));
    const start = new Date(`${from && from > first ? from : first}T00:00:00`);
    const last = to && to < today ? to : today;
    for (let day = start; localDate(day) <= last; day = new Date(day.getTime() + DAY_MS + 3600 * 1000)) {
      day.setHours(0, 0, 0, 0);
      const date = localDate(day);
      if (!s.days.includes(day.getDay())) continue;
      // Today counts only once the window is over.
      if (date === today) { const now = new Date(); if (now.getHours() * 60 + now.getMinutes() < minutesOf(s.end)) continue; }
      for (const l of laptops) {
        if (!inScope(s, l.name, l.branch) || (branch && l.branch !== branch)) continue;
        if (checks.some((c) => c.laptop === l.name && c.job === id && c.date === date && c.trigger !== 'now')) continue;
        rows.push([date, '', JOB_LABEL[id], 'Schedule', l.branch, l.sku || '', [l.make, l.model].filter(Boolean).join(' '), l.name, 'Not checked', 'No report: Sales Tools was closed or the laptop was off', '', '', '', '', '', '', '', '', '', '']);
      }
    }
  }
  rows.sort((a, b) => `${a[0]} ${a[4]} ${a[7]}`.localeCompare(`${b[0]} ${b[4]} ${b[7]}`));
  return [header, ...rows];
}

module.exports = { JOBS, cleanSchedules, scheduleFor, todayFor, csvRows, localDate, inScope };
