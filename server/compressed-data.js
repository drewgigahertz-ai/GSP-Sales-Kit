// Prepares the SalesKit data once per branch (until the data changes) and keeps it gzip-compressed,
// with a fingerprint (ETag) of exactly what that branch receives. Laptops send the fingerprint they
// have, and get "304 Not Modified" (no download) when their branch's data is the same.
const crypto = require('node:crypto');
const zlib = require('node:zlib');

// scopeOf(user): 'ALL' for full access, otherwise the branch code.
// build(scope): the data object that scope receives.
function createCompressedData({ getDataVersion, scopeOf, build }) {
  let version = null;
  const entries = new Map();

  // { etag, gzip, size } for this user. dedupe: the client rebuilds dvApplicationsPerSkuData from
  // appUkspData (they are the same table), so it is sent once (SalesKit 1.0.6 and newer).
  function get(user, { dedupe = false } = {}) {
    const currentVersion = getDataVersion();
    if (currentVersion !== version) {
      version = currentVersion;
      entries.clear();
    }
    const scope = scopeOf(user);
    const key = `${scope}|${dedupe ? 'dedupe' : 'full'}`;
    let entry = entries.get(key);
    if (!entry) {
      let data = build(scope);
      if (dedupe && data.dvApplicationsPerSkuData && data.dvApplicationsPerSkuData === data.appUkspData) {
        data = { ...data };
        delete data.dvApplicationsPerSkuData;
      }
      const json = Buffer.from(JSON.stringify(data));
      entry = {
        etag: `"${crypto.createHash('sha1').update(json).digest('hex').slice(0, 24)}"`,
        gzip: zlib.gzipSync(json, { level: 6 }),
        size: json.length
      };
      entries.set(key, entry);
    }
    return entry;
  }

  return { get };
}

module.exports = { createCompressedData };
