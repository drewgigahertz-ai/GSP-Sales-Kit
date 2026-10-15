// What each SalesKit laptop is showing: live ("Showing now" on the Devices tab) and a 30-day history of the
// banners shown, for the "Most shown banners" summary. The history lives in its own small database
// (activity.db), apart from the SalesKit data and its backups.
const Database = require('better-sqlite3');

const HISTORY_DAYS = 30;
const PRUNE_EVERY_MS = 6 * 60 * 60 * 1000;
const FIELD_LIMIT = 160;

function clip(value) {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, FIELD_LIMIT);
}

// The laptop's report: { page, kind, item, detail, fullscreen, idle }. kind is 'banner', 'clearance' or
// 'feature-banner' while a banner is on screen, '' otherwise.
function normalize(activity = {}) {
  return {
    page: clip(activity.page),
    kind: ['banner', 'clearance', 'feature-banner'].includes(activity.kind) ? activity.kind : '',
    item: clip(activity.item),
    detail: clip(activity.detail),
    fullscreen: Boolean(activity.fullscreen),
    idle: Boolean(activity.idle)
  };
}

function describe(activity) {
  return [activity.page, activity.item, activity.detail, activity.fullscreen ? 'Fullscreen' : '']
    .filter(Boolean).join(' · ');
}

function createActivityLog(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS shown (
      at TEXT NOT NULL,
      device TEXT NOT NULL,
      username TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL,
      item TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS shown_at ON shown (at);
  `);
  const insert = db.prepare('INSERT INTO shown (at, device, username, branch, kind, item, detail) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const live = new Map();

  function prune() {
    const cutoff = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM shown WHERE at < ?').run(cutoff);
  }
  prune();
  const pruneTimer = setInterval(prune, PRUNE_EVERY_MS);

  // Returns true when what the laptop shows changed (the Devices tab is then refreshed).
  function record(deviceKey, user, rawActivity) {
    const activity = normalize(rawActivity);
    const now = new Date().toISOString();
    const previous = live.get(deviceKey);
    const sameScreen = previous && describe(previous.activity) === describe(activity) && previous.activity.kind === activity.kind;
    if (sameScreen && previous.activity.idle === activity.idle) return false;
    live.set(deviceKey, { activity, since: sameScreen ? previous.since : now, at: now });
    // History: each time a banner comes on screen (not when the same one only wakes from idle).
    if (activity.kind && !activity.idle && !sameScreen) {
      insert.run(now, deviceKey, user ? clip(user.username) : '', user ? clip(user.branch) : '',
        activity.kind, activity.item, activity.detail);
    }
    return true;
  }

  // { text, since, idle, banner } for the Devices tab, or null when the laptop has not reported yet.
  function liveFor(deviceKey) {
    const entry = live.get(deviceKey);
    if (!entry) return null;
    return { text: describe(entry.activity), since: entry.since, idle: entry.activity.idle, banner: Boolean(entry.activity.kind) };
  }

  // Most shown banners over the last `days` days, overall and per branch.
  function summary(days = HISTORY_DAYS) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const top = db.prepare(`
      SELECT kind, item, detail, COUNT(*) AS times, COUNT(DISTINCT branch) AS branches, MAX(at) AS last
      FROM shown WHERE at >= ? GROUP BY kind, item, detail ORDER BY times DESC, last DESC LIMIT 20
    `).all(cutoff);
    const branches = db.prepare(`
      SELECT branch, COUNT(*) AS times, COUNT(DISTINCT item) AS laptops
      FROM shown WHERE at >= ? GROUP BY branch ORDER BY times DESC
    `).all(cutoff);
    const total = db.prepare('SELECT COUNT(*) AS count FROM shown WHERE at >= ?').get(cutoff).count;
    return { days, total, top, branches };
  }

  function close() {
    clearInterval(pruneTimer);
    db.close();
  }

  return { record, liveFor, summary, close };
}

module.exports = { createActivityLog, normalize, describe };
