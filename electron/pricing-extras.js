// PRICING MATRIX tab (server side): what the price matrix says about a promo besides its prices, from GHZ PRICING
// MATRIX's NEW PRICING MATRIX V3 (laptops), ATTACHMENT PRICING, DESKTOP PRICING SUMMARY and PM MOBILE VER 2.5:
//   promo dates       SUPPORT START DATE / SUPPORT END DATE (the dates only: the SUPPORT amount is never read)
//   incentives        VENDOR PROMO AND SALESMAN INCENTIVES and its PROMO VALIDITY (staff only on the tab)
//   vendor freebies   1.–3. VENDOR FREEBIES TO END USER (claiming mechanics) and each one's PROMO VALIDITY / CLAIMING
// Only these columns and ITEM DESCRIPTION / PROMO TITLE are fetched; costs, support, profits and margins never are.
// A tab without one of them simply has none (e.g. the mobile tab has no incentive column).

const headerKey = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const text = (value) => (value === null || value === undefined ? '' : String(value).replace(/\s+/g, ' ').trim());

const SHEETS = [
  ['NEW PRICING MATRIX V3', 'laptop'],
  ['ATTACHMENT PRICING', 'attachment'],
  ['DESKTOP PRICING SUMMARY', 'desktop'],
  ['PM MOBILE VER 2.5', 'mobile']
];

function columnLetters(index) {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

// 46179 (a sheet date) or "6/8/2026" → "2026-06-08"; anything else → ''.
function isoDate(value) {
  if (typeof value === 'number' && value > 30000 && value < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const m = text(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const iso = text(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : '';
}
// "-", "N/A", "#REF!", "0" say nothing.
const note = (value) => {
  const t = text(value);
  return !t || /^(-+|N\/?A|NONE|0|#.*)$/i.test(t) ? '' : t;
};

// The top rows (up to the ITEM DESCRIPTION row) → the columns to fetch: { headerRow, cols: { name: index } }.
function locateExtras(rows) {
  const headerRow = rows.findIndex((row) => (row || []).some((cell) => headerKey(cell) === 'ITEMDESCRIPTION'));
  if (headerRow === -1) throw new Error('the ITEM DESCRIPTION header was not found');
  const width = Math.max(...rows.slice(0, headerRow + 1).map((row) => (row || []).length));
  // Each column's headers from every top row, joined ("VENDORPROMOANDSALESMANINCENTIVES|INCENTIVES").
  const heads = Array.from({ length: width }, (_, i) => rows.slice(0, headerRow + 1).map((row) => headerKey((row || [])[i])).filter(Boolean).join('|'));
  const own = (i) => headerKey((rows[headerRow] || [])[i]);
  const find = (test, from = 0) => heads.findIndex((h, i) => i >= from && test(h, i));
  const cols = {};
  cols.item = heads.findIndex((h, i) => own(i) === 'ITEMDESCRIPTION');
  const promo = heads.findIndex((h, i) => own(i) === 'PROMOTITLE' || own(i) === 'PROGRAMTITLE');
  if (promo !== -1) cols.promo = promo;
  const start = find((h) => h.includes('SUPPORTSTARTDATE'));
  const end = find((h) => h.includes('SUPPORTENDDATE'));
  if (start !== -1) cols.start = start;
  if (end !== -1) cols.end = end;
  // The validity column right after a text column (within the next two columns).
  const validityAfter = (index) => {
    const v = find((h) => h.includes('PROMOVALIDITY') || h.includes('VALIDITY'), index + 1);
    return v !== -1 && v - index <= 2 ? v : -1;
  };
  const incentive = find((h) => h.includes('SALESMANINCENTIVE'));
  if (incentive !== -1) {
    cols.incentive = incentive;
    const v = validityAfter(incentive);
    if (v !== -1) cols.incentiveValidity = v;
  }
  for (const n of [1, 2, 3]) {
    const vendor = find((h) => h.includes(`${n}VENDORFREEBIES`));
    if (vendor === -1) continue;
    cols[`vendor${n}`] = vendor;
    const v = validityAfter(vendor);
    if (v !== -1) cols[`vendor${n}Validity`] = v;
  }
  return { headerRow, cols };
}

async function readSheetExtras(sheets, spreadsheetId, sheet, kind) {
  const tab = `'${sheet.replace(/'/g, "''")}'`;
  const head = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A1:ZZ6`, valueRenderOption: 'FORMATTED_VALUE' });
  const { headerRow, cols } = locateExtras(head.data.values || []);
  const names = Object.keys(cols);
  // Nothing beyond the item and promo: this tab has no extras.
  if (!names.some((name) => name !== 'item' && name !== 'promo')) return [];
  const startRow = headerRow + 2;
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: names.map((name) => `${tab}!${columnLetters(cols[name])}${startRow}:${columnLetters(cols[name])}`),
    majorDimension: 'COLUMNS',
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  const columns = Object.fromEntries(names.map((name, i) => [name, (((response.data.valueRanges || [])[i] || {}).values || [[]])[0] || []]));
  const length = Math.max(0, ...Object.values(columns).map((column) => column.length));
  const at = (name, r) => (columns[name] ? columns[name][r] : '');
  const rows = [];
  const seen = new Set();
  for (let r = 0; r < length; r += 1) {
    const item = text(at('item', r));
    if (!item) continue;
    const promoTitle = text(at('promo', r));
    const promo = /^no promo$/i.test(promoTitle) ? '' : promoTitle;
    const key = `${item.toUpperCase()}|${promo.toUpperCase()}`;
    if (seen.has(key)) continue;
    const vendor = [1, 2, 3]
      .map((n) => ({ text: note(at(`vendor${n}`, r)), validity: note(at(`vendor${n}Validity`, r)) }))
      .filter((v) => v.text);
    const data = {
      kind,
      item,
      promo,
      start: isoDate(at('start', r)),
      end: isoDate(at('end', r)),
      incentive: note(at('incentive', r)),
      incentive_validity: note(at('incentiveValidity', r)),
      vendor: vendor.length ? JSON.stringify(vendor) : ''
    };
    if (!data.start && !data.end && !data.incentive && !data.vendor) continue;
    seen.add(key);
    rows.push(data);
  }
  return rows;
}

// Every tab → collection pricing_extras. A tab that cannot be read is reported through warn and left out.
async function readPricingExtras(sheets, spreadsheetId, warn = () => {}) {
  const rows = [];
  for (const [sheet, kind] of SHEETS) {
    try {
      rows.push(...await readSheetExtras(sheets, spreadsheetId, sheet, kind));
    } catch (error) {
      warn(`${sheet} (promo dates and incentives): ${error.message}`);
    }
  }
  return {
    collection: 'pricing_extras',
    columns: ['kind', 'item', 'promo', 'start', 'end', 'incentive', 'incentive_validity', 'vendor'],
    rows: rows.map((data, index) => ({ id: `item_${String(index + 1).padStart(5, '0')}`, data }))
  };
}

// The pricing_extras table → { 'KIND|ITEM|PROMO': { start, end, incentive, incentiveValidity, vendor: [{ text, validity }] } }.
function pricingExtras(rows = []) {
  const out = {};
  for (const row of rows) {
    let vendor = [];
    try { vendor = row.vendor ? JSON.parse(row.vendor) : []; } catch { vendor = []; }
    out[`${text(row.kind)}|${text(row.item).toUpperCase()}|${text(row.promo).toUpperCase()}`] = {
      start: text(row.start), end: text(row.end), incentive: text(row.incentive), incentiveValidity: text(row.incentive_validity), vendor
    };
  }
  return out;
}

module.exports = { readPricingExtras, pricingExtras, locateExtras, isoDate };
