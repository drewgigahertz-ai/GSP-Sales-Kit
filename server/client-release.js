// Keeps track of the newest SalesKit release on GitHub. The server tells every SalesKit about it in its
// 2-minute /api/version check, so open laptops start downloading a new version within minutes instead of
// waiting for their own hourly GitHub check.
const GITHUB_OWNER = 'drewgigahertz-ai';
const GITHUB_REPO = 'GSP-Sales-Kit';
const LATEST_YML_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download/latest.yml`;
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

function createClientReleaseWatcher({ fetchImpl = fetch, onChange = () => {}, onError = () => {} } = {}) {
  // { version, checkedAt, error }
  let latest = { version: null, checkedAt: null, error: '' };
  let timer = null;
  let running = null;

  async function checkNow() {
    if (running) return running;
    running = (async () => {
      try {
        // latest.yml is the file electron-updater itself reads; it names the newest published version.
        const response = await fetchImpl(LATEST_YML_URL, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
        const match = /^version:\s*['"]?([0-9][\w.+-]*)['"]?\s*$/m.exec(await response.text());
        if (!match) throw new Error('The latest release has no version in latest.yml.');
        const changed = match[1] !== latest.version;
        latest = { version: match[1], checkedAt: new Date().toISOString(), error: '' };
        if (changed) onChange(latest);
      } catch (error) {
        // Keep the last known version; laptops still update through their own hourly check.
        latest = { ...latest, checkedAt: new Date().toISOString(), error: error.message };
        onError(error);
      } finally {
        running = null;
      }
      return latest;
    })();
    return running;
  }

  function start() {
    if (timer) return;
    checkNow();
    timer = setInterval(checkNow, CHECK_INTERVAL_MS);
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  return { start, stop, checkNow, get: () => latest };
}

module.exports = { createClientReleaseWatcher, LATEST_YML_URL };
