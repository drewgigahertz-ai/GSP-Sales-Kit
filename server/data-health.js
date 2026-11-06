// Data health (Data health tab): sheet problems that silently break what SalesKit shows, checked after each sync.
//   1. Recommended laptops (RECO TABLE, DB sheet) missing from LAPTOP DB, where the Flyers
//      take each laptop's name, part number and specs.
//   2. Recommended laptops marked END OF LIFE / EOL in LAPTOP DB.
//   3. The same item twice in SPECS with different prices.
//   4. Recommended laptops with no picture (LAPTOP DB, else SPECS Image URL) or no OS (LAPTOP DB), and KSP names in
//      LAPTOP DB with no picture in UKSP ICON, every LAPTOP DB laptop with no MTM (its part number), and promos
//      (title + freebies) with no picture in PROMO IMAGES.
//   5. Prices not read from the price matrix (a header renamed, access removed): NEW PRICING was used instead.
// Each problem names the sheet (and row, where the sheet has one) to fix.
const { matchKey } = require('../electron/banner-data');
const { promoKey } = require('../electron/promo-icons');

function text(value) {
  const result = value === null || value === undefined ? '' : String(value).trim();
  return result.startsWith('#') ? '' : result;
}

// Sheet row of a synced row (ids are item_<row> for sheets read whole, see sheets-sync.js), or null.
function sheetRow(row) {
  const match = /^item_0*(\d+)$/.exec(String(row && row.id || ''));
  return match ? Number(match[1]) : null;
}

// options.priceSource: { sync, watch }, each { source: 'matrix' | 'new-pricing', error } or null (see server/main.js);
// null when no price matrix is set.
function buildDataHealth(getRows, { priceSource = null } = {}) {
  const recoRows = getRows('reco_table');
  const dbRows = getRows('reco_db');
  const specRows = getRows('specs');
  // LAPTOP DB by item (the first row of a laptop listed twice), with its sheet row.
  const laptopDatabase = new Map();
  for (const row of getRows('laptop_database')) {
    const key = matchKey(row.item);
    if (key && !laptopDatabase.has(key)) laptopDatabase.set(key, { row: sheetRow(row), os: text(row.os), eol: text(row.eol_status), picture: text(row.picture) });
  }
  // Before the first sync that reads LAPTOP DB, nothing is reported against it.
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

  // 1. Missing from LAPTOP DB. 2. End of life.
  const missing = [];
  const endOfLife = [];
  // 4. No picture / no OS.
  const noPicture = [];
  const noOs = [];
  for (const [key, entry] of recommended) {
    const listed = laptopDatabase.get(key);
    if (laptopDatabaseSynced && !listed) missing.push({ item: entry.item, hasPrice: priced.has(key), usedIn: usedIn(entry) });
    if (listed && /^(END OF LIFE|EOL)$/.test(listed.eol)) {
      endOfLife.push({ item: entry.item, where: `LAPTOP DB row ${listed.row}: ${listed.eol}`, usedIn: usedIn(entry) });
    }
    // The picture: LAPTOP DB (column before ITEM DESCRIPTION), else SPECS' Image URL.
    const specs = specsByItem.get(key);
    if (!(listed && listed.picture) && !(specs && specs.rows.some((row) => row.image))) {
      noPicture.push({ item: entry.item, where: listed ? `LAPTOP DB row ${listed.row}: no picture` : 'Not in LAPTOP DB', usedIn: usedIn(entry) });
    }
    // Missing from LAPTOP DB altogether is already in group 1.
    if (listed && !listed.os) noOs.push({ item: entry.item, where: `LAPTOP DB row ${listed.row}: no OS`, usedIn: usedIn(entry) });
  }

  // Every laptop in LAPTOP DB without an MTM: its brand and model would show no part number under them.
  const noMtm = [];
  const seenMtm = new Set();
  for (const row of getRows('laptop_database')) {
    const key = matchKey(row.item);
    if (!key || seenMtm.has(key)) continue;
    seenMtm.add(key);
    if (!text(row.mtm)) noMtm.push({ item: text(row.item), where: `LAPTOP DB row ${sheetRow(row)}: no MTM`, usedIn: recommended.has(key) ? usedIn(recommended.get(key)) : 'Not recommended' });
  }

  // Promos (title + freebies) with no Icon Link in PROMO IMAGES; ageing promos show their clearance banner instead.
  const promoIcons = new Map(getRows('promo_icons').map((row) => [promoKey(row.name), text(row.link)]));
  const promoLaptops = new Map();
  for (const row of getRows('banner_prices')) {
    const promo = text(row.promo);
    if (!promo || /\bag(e)?ing\b/i.test(promo)) continue;
    const entry = promoLaptops.get(promoKey(promo)) || { name: [text(row.promo_title), promo.slice(text(row.promo_title).length)].filter(Boolean).join(' + '), items: new Set() };
    entry.items.add(matchKey(row.item_code));
    promoLaptops.set(promoKey(promo), entry);
  }
  const noPromoIcon = promoIcons.size
    ? [...promoLaptops].filter(([key]) => !promoIcons.get(key)).map(([key, entry]) => ({
      item: entry.name,
      where: promoIcons.has(key) ? 'PROMO IMAGES: no Icon Link' : 'PROMO IMAGES: not listed',
      usedIn: `Promo of ${entry.items.size} laptop${entry.items.size === 1 ? '' : 's'}`
    }))
    : [];

  // KSP names with no picture for the Banner's feature row (UKSP ICON, else DB PHOTOS' spec pictures), with how many
  // laptops have them.
  const specPictures = new Set(getRows('banner_photos').filter((row) => row.kind === 'spec' && text(row.link)).map((row) => matchKey(row.name)));
  const kspsWithoutIcon = new Map();
  for (const row of getRows('banner_laptops')) {
    for (const n of [1, 2, 3, 4]) {
      const name = text(row[`uksp${n}`]);
      if (name && !text(row[`uksp${n}_pic`]) && !specPictures.has(matchKey(name))) kspsWithoutIcon.set(name, (kspsWithoutIcon.get(name) || 0) + 1);
    }
  }
  const noIcon = laptopDatabaseSynced
    ? [...kspsWithoutIcon].map(([name, count]) => ({ item: name, where: 'UKSP ICON: no picture for this name', usedIn: `KSP of ${count} laptop${count === 1 ? '' : 's'}` }))
    : [];

  // 2. Same item twice in SPECS with different prices.
  const duplicates = [];
  for (const entry of specsByItem.values()) {
    if (entry.rows.length < 2) continue;
    const prices = new Set(entry.rows.map((row) => row.price));
    if (prices.size > 1) duplicates.push({ item: entry.item, rows: entry.rows.map(({ row, price }) => ({ row, price })) });
  }

  // 5. The price matrix could not be read at the last sync or price check.
  const priceMatrix = [];
  for (const [kind, label] of [['sync', 'Sync'], ['watch', 'Price check']]) {
    const read = priceSource && priceSource[kind];
    if (read && read.source !== 'matrix') priceMatrix.push({ where: label, error: read.error || 'Not read' });
  }

  const byItem = (a, b) => a.item.localeCompare(b.item);
  [missing, endOfLife, duplicates, noPicture, noOs, noIcon, noMtm, noPromoIcon].forEach((list) => list.sort(byItem));
  return {
    checkedAt: new Date().toISOString(),
    recommendedCount: recommended.size,
    laptopDatabaseSynced,
    missing,
    endOfLife,
    duplicates,
    noPicture,
    noOs,
    noIcon,
    noMtm,
    noPromoIcon,
    priceMatrix,
    total: priceMatrix.length + missing.length + endOfLife.length + duplicates.length + noPicture.length + noOs.length + noIcon.length + noMtm.length + noPromoIcon.length
  };
}

module.exports = { buildDataHealth };
