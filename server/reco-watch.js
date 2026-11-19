// Reco Table watch: every 30 seconds the server reads the sheets behind the Reco Table — RECO TABLE (target market, tag,
// laptop, stock), DB (each branch's recommended laptop and alternatives) and LAPTOP DB (laptops and branch stock) —
// in one request and compares a fingerprint of each with the last check. When one changed, onChange([names]) runs
// (the server syncs and tells the laptops, which reload their data at once), like the price watch does for prices.
// A sheet that is still loading ("Loading...", #REF!) or shrank by a lot is ignored, and a change counts only when two
// reads in a row agree, so a half-loaded read starts no sync.
const crypto = require('node:crypto');

// Every 30 seconds: with two matching reads, a change is acted on within about a minute.
const CHECK_INTERVAL_MS = 30 * 1000;
const CONFIRM_READS = 2;
const MIN_ROWS_SHARE = 0.9;
const LOADING = /^(Loading|#REF!|#ERROR!|#N\/A)/i;

const fingerprint = (values) => crypto.createHash('sha1').update(JSON.stringify(values)).digest('hex');
const filledRows = (values) => values.filter((row) => (row || []).some((cell) => String(cell ?? '').trim())).length;
const isLoading = (values) => values.some((row) => (row || []).slice(0, 6).some((cell) => LOADING.test(String(cell ?? '').trim())));

// readSheets(): { name: values } of the watched sheets (only those present). onChange(names): one or more changed.
function createRecoWatch({ readSheets, onChange, log = () => {}, intervalMs = CHECK_INTERVAL_MS }) {
  const known = {}; // name → { print, rows }
  const pending = {}; // name → { print, count }
  let timer = null;
  let running = false;

  async function check() {
    if (running) return;
    running = true;
    try {
      const sheets = await readSheets();
      const changed = [];
      for (const [name, values] of Object.entries(sheets || {})) {
        if (!values.length || isLoading(values)) continue;
        const rows = filledRows(values);
        const print = fingerprint(values);
        const before = known[name];
        if (!before) { known[name] = { print, rows }; continue; } // first read: the starting point
        if (before.print === print) { delete pending[name]; continue; }
        if (rows < before.rows * MIN_ROWS_SHARE) continue; // being cleared or refilled
        const wait = pending[name];
        if (!wait || wait.print !== print) { pending[name] = { print, count: 1 }; }
        else wait.count += 1;
        if (pending[name].count < CONFIRM_READS) continue;
        known[name] = { print, rows };
        delete pending[name];
        changed.push(name);
      }
      if (changed.length) {
        log('info', `${changed.join(', ')} changed: syncing so the laptops get it now`);
        await onChange(changed);
      }
    } catch (error) {
      log('warning', `Reco Table check failed: ${error.message}`);
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) return;
      check();
      timer = setInterval(check, intervalMs);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    check
  };
}

module.exports = { createRecoWatch };
