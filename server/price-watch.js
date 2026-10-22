// Price-change watch: every minute the server reads only the NEW PRICING sheet and compares each laptop's
// CASH PRICE, SRP and 12MOS (the "with bundle" columns H, I, J) with the last check. A difference becomes a
// price-change event { id, at, changes: [...] }, which the server pushes to SalesKit laptops at once (see
// /api/events in local-api.js). Events are kept for 30 days so a laptop that was off catches up when it connects.
const fs = require('node:fs');
const path = require('node:path');
const { pricesCollection, matchKey } = require('../electron/banner-data');

const CHECK_INTERVAL_MS = 60 * 1000;
const KEEP_DAYS = 30;
const MAX_EVENTS = 300;
const PRICE_FIELDS = ['cash', 'srp', 'twelveMonths'];
// While the sheet is being cleared, refilled or still loading, a read has fewer rows than before. Such a read is
// ignored when it has under 90% of the known rows; a single row that disappears only counts as removed after it
// has been missing for 15 minutes, so rows that come back with the same prices announce nothing.
const MIN_ROWS_SHARE = 0.9;
const REMOVE_AFTER_MS = 15 * 60 * 1000;
// More than half the rows new (or removed) at once is the sheet being reloaded, not price changes: taken in silently.
const BULK_SHARE = 0.5;

// NEW PRICING rows → { key: { itemCode, branch, promoTitle, cash, srp, twelveMonths } }. key: item + branch + promo
// title, so a laptop listed for several branches or promos is followed row by row.
function snapshotOf(values) {
  const snapshot = {};
  for (const { data } of pricesCollection(values).rows) {
    const key = `${matchKey(data.item_code)}|${data.branch}|${matchKey(data.promo_title)}`;
    if (snapshot[key]) continue;
    const price = (value) => (value === '' ? null : Number(value));
    snapshot[key] = {
      itemCode: data.item_code,
      branch: data.branch,
      promoTitle: data.promo_title,
      cash: price(data.cash),
      srp: price(data.srp),
      twelveMonths: price(data.twelve_months)
    };
  }
  return snapshot;
}

// What changed between two snapshots: price changes, new rows and removed rows.
function diff(before, after) {
  const changes = [];
  for (const [key, row] of Object.entries(after)) {
    const old = before[key];
    if (!old) {
      changes.push({ kind: 'added', itemCode: row.itemCode, branch: row.branch, promoTitle: row.promoTitle, before: null, after: pick(row) });
    } else if (PRICE_FIELDS.some((field) => old[field] !== row[field])) {
      changes.push({ kind: 'changed', itemCode: row.itemCode, branch: row.branch, promoTitle: row.promoTitle, before: pick(old), after: pick(row) });
    }
  }
  for (const [key, row] of Object.entries(before)) {
    if (!after[key]) {
      changes.push({ kind: 'removed', itemCode: row.itemCode, branch: row.branch, promoTitle: row.promoTitle, before: pick(row), after: null });
    }
  }
  return changes;
}

function pick(row) {
  return { cash: row.cash, srp: row.srp, twelveMonths: row.twelveMonths };
}

// readValues(): the NEW PRICING values; onChange(event): called after a change is recorded; log(level, message).
function createPriceWatch({ filePath, readValues, onChange = () => {}, log = () => {} }) {
  let state = { snapshot: null, events: [], nextId: 1 };
  try {
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (saved && typeof saved === 'object') state = { ...state, ...saved };
  } catch {}

  function save() {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(state), 'utf8');
    } catch {}
  }

  function prune() {
    const oldest = Date.now() - KEEP_DAYS * 864e5;
    state.events = state.events.filter((event) => Date.parse(event.at) >= oldest).slice(-MAX_EVENTS);
  }

  let checking = false;
  async function check() {
    if (checking) return null;
    checking = true;
    try {
      const snapshot = snapshotOf(await readValues());
      const count = Object.keys(snapshot).length;
      const known = state.snapshot ? Object.keys(state.snapshot).length : 0;
      const now = Date.now();
      if (!count) return null;
      // The sheet is being cleared or is still loading: the known prices stay, the next check tries again. A sheet
      // that stays this much smaller for 15 minutes really lost those rows, and is taken as it is.
      if (known && count < known * MIN_ROWS_SHARE) {
        state.shrunkSince = state.shrunkSince || now;
        if (now - state.shrunkSince < REMOVE_AFTER_MS) return null;
      } else {
        state.shrunkSince = null;
      }
      if (!state.snapshot) {
        // First check: remember the prices, nothing to announce.
        state.snapshot = snapshot;
        state.missing = {};
        save();
        return null;
      }
      // Rows missing from this read stay known (with their last prices) until they have been gone for 15 minutes.
      const missing = {};
      const next = { ...snapshot };
      for (const [key, row] of Object.entries(state.snapshot)) {
        if (snapshot[key]) continue;
        const since = (state.missing && state.missing[key]) || now;
        if (now - since < REMOVE_AFTER_MS) {
          next[key] = row;
          missing[key] = since;
        }
      }
      const changes = diff(state.snapshot, next);
      state.snapshot = next;
      state.missing = missing;
      const added = changes.filter((change) => change.kind === 'added').length;
      const removed = changes.filter((change) => change.kind === 'removed').length;
      if (added > count * BULK_SHARE || removed > known * BULK_SHARE) {
        save();
        log('info', `Pricing sheet reloaded (${added} rows added, ${removed} removed at once); not announced as price changes`);
        return null;
      }
      if (!changes.length) {
        save();
        return null;
      }
      const event = { id: state.nextId++, at: new Date().toISOString(), changes };
      state.events.push(event);
      prune();
      save();
      log('info', `Price change: ${changes.length} row${changes.length === 1 ? '' : 's'} in NEW PRICING`);
      onChange(event);
      return event;
    } catch (error) {
      log('warning', `Price check failed: ${error.message}`);
      return null;
    } finally {
      checking = false;
    }
  }

  let timer = null;
  return {
    start() {
      if (timer) return;
      timer = setInterval(check, CHECK_INTERVAL_MS);
      check();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    check,
    latestId: () => state.nextId - 1,
    count: () => state.events.length,
    // Clears the price-change history (every laptop's list). The current prices stay as the starting point, so
    // nothing is announced again; ids keep counting up, so laptops do not mistake old changes for new ones.
    clear() {
      state.events = [];
      save();
    },
    // Events after the given id (newest last).
    since: (id) => state.events.filter((event) => event.id > Number(id || 0))
  };
}

module.exports = { createPriceWatch, snapshotOf, diff };
