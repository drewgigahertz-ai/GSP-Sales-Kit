// Data health (Data health tab): sheet problems that silently break what SalesKit shows, checked after each sync.
//   1. Recommended laptops (RECO TABLE, DB sheet) missing from LAPTOP RAW or BANNER SPECS: no price, logo or OS.
//   2. The same item twice in SPECS with different prices.
//   3. Recommended laptops with no picture (SPECS Image URL) or no OS (BANNER SPECS).
// Each problem names the sheet (and row, where the sheet has one) to fix.
const { matchKey } = require('../electron/banner-data');

function text(value) {
  const result = value === null || value === undefined ? '' : String(value).trim();
  return result.startsWith('#') ? '' : result;
}

// Sheet row of a synced row (ids are item_<row> for sheets read whole, see sheets-sync.js), or null.
function sheetRow(row) {
  const match = /^item_0*(\d+)$/.exec(String(row && row.id || ''));
  return match ? Number(match[1]) : null;
}

function buildDataHealth(getRows) {
  const recoRows = getRows('reco_table');
  const dbRows = getRows('reco_db');
  const specRows = getRows('specs');
  const laptopKeys = new Set(getRows('banner_laptops').map((row) => matchKey(row.item_code)));
  const bannerSpecs = new Map();
  for (const row of getRows('banner_specs')) {
    const key = matchKey(row.item_code);
    if (!bannerSpecs.has(key)) bannerSpecs.set(key, new Set());
    if (text(row.value)) bannerSpecs.get(key).add(String(row.guide || '').toUpperCase());
  }
  const priced = new Set(getRows('banner_prices')
    .filter((row) => text(row.twelve_months) || text(row.cash))
    .map((row) => matchKey(row.item_code)));

  // Recommended laptops: where each is used (branches in RECO TABLE, in the DB sheet).
  const recommended = new Map();
  const use = (item, source, branch) => {
    const name = text(item).replace(/\s+/g, ' ');
    if (!name) return;
    const key = matchKey(name);
    if (!recommended.has(key)) recommended.set(key, { item: name, reco: new Set(), db: new Set() });
    if (branch) recommended.get(key)[source].add(String(branch).trim().toUpperCase());
  };
  recoRows.forEach((row) => use(row['ITEM DESCRIPTION'], 'reco', row.BR));
  dbRows.forEach((row) => use(row.item, 'db', row.branch));
  const usedIn = (entry) => [
    entry.reco.size ? `RECO TABLE (${entry.reco.size} branch${entry.reco.size === 1 ? '' : 'es'})` : '',
    entry.db.size ? `DB (${entry.db.size} branch${entry.db.size === 1 ? '' : 'es'})` : ''
  ].filter(Boolean).join(', ');

  // SPECS rows per item.
  const specsByItem = new Map();
  for (const row of specRows) {
    const name = text(row['ITEM DESCRIPTION']).replace(/\s+/g, ' ');
    if (!name) continue;
    const key = matchKey(name);
    if (!specsByItem.has(key)) specsByItem.set(key, { item: name, rows: [] });
    specsByItem.get(key).rows.push({ row: sheetRow(row), price: text(row.PRICE), image: text(row['Image URL']) });
  }

  // 1. Missing from LAPTOP RAW or BANNER SPECS.
  const missing = [];
  // 3. No picture / no OS.
  const noPicture = [];
  const noOs = [];
  for (const [key, entry] of recommended) {
    const inRaw = laptopKeys.has(key);
    const guides = bannerSpecs.get(key);
    if (!inRaw || !guides) {
      missing.push({ item: entry.item, laptopRaw: inRaw, bannerSpecs: Boolean(guides), hasPrice: priced.has(key), usedIn: usedIn(entry) });
    }
    const specs = specsByItem.get(key);
    if (!specs) noPicture.push({ item: entry.item, where: 'Not in SPECS', usedIn: usedIn(entry) });
    else if (!specs.rows.some((row) => row.image)) {
      noPicture.push({ item: entry.item, where: `SPECS row ${specs.rows.map((row) => row.row).filter(Boolean).join(', ')}: no Image URL`, usedIn: usedIn(entry) });
    }
    // Missing from BANNER SPECS altogether is already in group 1.
    if (guides && !guides.has('OS')) noOs.push({ item: entry.item, where: 'BANNER SPECS: no OS row', usedIn: usedIn(entry) });
  }

  // 2. Same item twice in SPECS with different prices.
  const duplicates = [];
  for (const entry of specsByItem.values()) {
    if (entry.rows.length < 2) continue;
    const prices = new Set(entry.rows.map((row) => row.price));
    if (prices.size > 1) duplicates.push({ item: entry.item, rows: entry.rows.map(({ row, price }) => ({ row, price })) });
  }

  const byItem = (a, b) => a.item.localeCompare(b.item);
  [missing, duplicates, noPicture, noOs].forEach((list) => list.sort(byItem));
  return {
    checkedAt: new Date().toISOString(),
    recommendedCount: recommended.size,
    missing,
    duplicates,
    noPicture,
    noOs,
    total: missing.length + duplicates.length + noPicture.length + noOs.length
  };
}

module.exports = { buildDataHealth };
