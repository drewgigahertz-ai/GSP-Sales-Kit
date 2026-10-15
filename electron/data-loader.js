const fs = require('node:fs');

// Loads the SalesKit data from the server with as little traffic as possible:
// - the server's fingerprint (ETag) of the saved data is sent along, and "304 Not Modified" means
//   the saved copy is still current, so nothing is downloaded;
// - calls that arrive while a download is running share it (the page asks several times at startup);
// - the saved copy can be shown right away, but only to an account of the same branch scope, so a
//   shared laptop never shows one branch's stock to another branch.
//
// The saved data lives in snapshotCache; a small meta file next to it remembers its fingerprint,
// scope and logo addresses, so checking them never reads the large file.

const FULL_ACCESS_BRANCHES = ['ALL', 'HO'];

function normalizeBranch(branch) {
  return String(branch || '').trim().toUpperCase();
}

// 'ALL' for accounts that see every branch, otherwise the branch code.
function scopeOfUser(user) {
  const branch = normalizeBranch(user && user.branch);
  return !branch || FULL_ACCESS_BRANCHES.includes(branch) ? 'ALL' : branch;
}

// A branch account's copy (branch-only stock from older servers, or all branches with its home branch) is
// only shown to that branch.
function scopeOfData(data) {
  const branch = data && (data.lockedBranch || data.homeBranch);
  return branch ? normalizeBranch(branch) : 'ALL';
}

// The server sends the application benchmark table once; the page expects it under both names.
function expand(data) {
  if (data && data.appUkspData && !data.dvApplicationsPerSkuData) data.dvApplicationsPerSkuData = data.appUkspData;
  return data;
}

function createDataLoader({ requestServer, snapshotCache, metaPath, getUser }) {
  let inFlight = null;

  function loadMeta() {
    try {
      return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch {
      return null;
    }
  }

  function saveMeta(meta) {
    try {
      fs.writeFileSync(metaPath, JSON.stringify(meta));
    } catch (error) {
      console.warn('Could not save the data fingerprint:', error.message);
    }
  }

  function loadSaved() {
    return expand(snapshotCache.load());
  }

  // The saved data, if this account may see it (offline mode, without an account, always may).
  function savedDataFor(user) {
    if (user) {
      const meta = loadMeta();
      if (!meta || meta.scope !== scopeOfUser(user)) return null;
    }
    return loadSaved();
  }

  async function download() {
    const meta = loadMeta();
    const user = getUser();
    const canReuse = Boolean(meta && meta.etag && (!user || meta.scope === scopeOfUser(user)));
    const result = await requestServer('/api/initial-data', {
      timeoutMs: 120000,
      headers: canReuse ? { 'If-None-Match': meta.etag } : {},
      withMeta: true
    });

    if (result.status === 304) {
      const saved = loadSaved();
      if (saved) return { data: saved, tag: meta.etag, downloaded: false };
      // The saved file is gone: download it again in full.
      saveMeta({});
      return download();
    }

    const data = result.body;
    if (snapshotCache.save(data)) {
      saveMeta({
        etag: result.etag || null,
        scope: scopeOfData(data),
        headerLogoUrl: data.headerLogoUrl || '',
        applicationLogoUrl: data.applicationLogoUrl || '',
        savedAt: new Date().toISOString()
      });
    }
    return { data: expand(data), tag: result.etag || null, downloaded: true };
  }

  // { data, tag, downloaded }: tag is the server's fingerprint (null from older servers).
  function load() {
    if (!inFlight) inFlight = download().finally(() => { inFlight = null; });
    return inFlight;
  }

  return { load, loadSaved, savedDataFor, loadMeta, hasSaved: () => Boolean(loadMeta()) || Boolean(snapshotCache.exists && snapshotCache.exists()) };
}

module.exports = { createDataLoader, scopeOfUser, scopeOfData, expand };
