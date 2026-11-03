// Data health (Data health tab): sheet problems that silently break what SalesKit shows, checked after each sync.
//   1. Recommended laptops (RECO TABLE, DB sheet) missing from LAPTOP DATABASE (GST PRICING), where the Flyers
//      take each laptop's name, part number and specs.
//   2. Recommended laptops marked END OF LIFE / EOL in LAPTOP DATABASE.
//   3. The same item twice in SPECS with different prices.
//   4. Recommended laptops with no picture (SPECS Image URL) or no OS (LAPTOP DATABASE).
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
  // LAPTOP DATABASE by item (the first row of a laptop listed twice), with its sheet row.
  const laptopDatabase = new Map();
  for (const row of getRows('laptop_database')) {
    const key = matchKey(row.item);
    if (key && !laptopDatabase.has(key)) laptopDatabase.set(key, { row: sheetRow(row), os: text(row.os), eol: text(row.eol_status) });
  }
  // Before the first sync that reads LAPTOP DATABASE, nothing is reported against it.
  const laptopDatabaseSynced = laptopDatabase.size > 0;
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

  // 1. Missing from LAPTOP DATABASE. 2. End of life.
  const missing = [];
  const endOfLife = [];
  // 4. No picture / no OS.
  const noPicture = [];
  const noOs = [];
  for (const [key, entry] of recommended) {
    const listed = laptopDatabase.get(key);
    if (laptopDatabaseSynced && !listed) missing.push({ item: entry.item, hasPrice: priced.has(key), usedIn: usedIn(entry) });
    if (listed && /^(END OF LIFE|EOL)$/.test(listed.eol)) {
      endOfLife.push({ item: entry.item, where: `LAPTOP DATABASE row ${listed.row}: ${listed.eol}`, usedIn: usedIn(entry) });
    }
    const specs = specsByItem.get(key);
    if (!specs) noPicture.push({ item: entry.item, where: 'Not in SPECS', usedIn: usedIn(entry) });
    else if (!specs.rows.some((row) => row.image)) {
      noPicture.push({ item: entry.item, where: `SPECS row ${specs.rows.map((row) => row.row).filter(Boolean).join(', ')}: no Image URL`, usedIn: usedIn(entry) });
    }
    // Missing from LAPTOP DATABASE altogether is already in group 1.
    if (listed && !listed.os) noOs.push({ item: entry.item, where: `LAPTOP DATABASE row ${listed.row}: no OS`, usedIn: usedIn(entry) });
  }

  // 2. Same item twice in SPECS with different prices.
  const duplicates = [];
  for (const entry of specsByItem.values()) {
    if (entry.rows.length < 2) continue;
    const prices = new Set(entry.rows.map((row) => row.price));
    if (prices.size > 1) duplicates.push({ item: entry.item, rows: entry.rows.map(({ row, price }) => ({ row, price })) });
  }

  const byItem = (a, b) => a.item.localeCompare(b.item);
  [missing, endOfLife, duplicates, noPicture, noOs].forEach((list) => list.sort(byItem));
  return {
    checkedAt: new Date().toISOString(),
    recommendedCount: recommended.size,
    laptopDatabaseSynced,
    missing,
    endOfLife,
    duplicates,
    noPicture,
    noOs,
    total: missing.length + endOfLife.length + duplicates.length + noPicture.length + noOs.length
  };
}

module.exports = { buildDataHealth };
