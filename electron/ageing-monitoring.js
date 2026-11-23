// Clearance banners for ageing laptops (server side), drawn by the Banner page (banner-clearance.js) from:
//   AGEING BANNER MONITORING (PROMO MONITORING - FOR BANNERS spreadsheet): a log with a row per laptop and date —
//     ITEM DESCRIPTION, INV, CASH, ORIGINAL PRICE, BUNDLE DESCRIPTION (the freebies, one per line), BUNDLE WORTH,
//     DATE AND TIME, and CASH PRICE (the price shown), OLD PRICE (the struck-out BEFORE price) and SAVE. A row without
//     CASH PRICE / OLD PRICE uses CASH / ORIGINAL PRICE; without SAVE, the difference. Each laptop's latest row is used.
//     Columns are found by their headers.
//   PERIPHEALS (the main spreadsheet): A the freebie's name, B its picture (a Drive link); section rows have no link.
// A freebie is matched to PERIPHEALS by its name without the "FREEBIES-" start and "(PWP)" / "(hard bundling)".

const AGEING_MONITORING_SHEET = 'AGEING BANNER MONITORING';
const AGEING_MONITORING_RANGE = 'A:Z';
const PERIPHERALS_SHEETS = ['PERIPHEALS', 'PERIPHERALS'];
const PERIPHERALS_RANGE = 'A:B';
// PROMO MONITORING - FOR BANNERS (also where PROMO IMAGES' IMPORTRANGE comes from).
const DEFAULT_PROMO_MONITORING_SPREADSHEET_ID = '14bifpc2LNP5qsJIXxiqny2IDpiuHQPeQaVL5-ScOPf4';

const text = (value) => (value === null || value === undefined ? '' : String(value).trim());
const headerKey = (value) => text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
const itemKey = (value) => text(value).toUpperCase().replace(/\s+/g, ' ');

// [field, test on the header key]; the first column that passes is used.
const FIELDS = [
  ['item', (h) => h === 'ITEMDESCRIPTION'],
  ['stock', (h) => h === 'INV' || h.startsWith('INVENTORY')],
  ['cash', (h) => h === 'CASH'],
  ['before', (h) => h.startsWith('ORIGINALPRICE')],
  ['price', (h) => h === 'CASHPRICE'],
  ['oldPrice', (h) => h === 'OLDPRICE'],
  ['save', (h) => h === 'SAVE' || h === 'SAVINGS'],
  ['freebies', (h) => h === 'BUNDLEDESCRIPTION'],
  ['worth', (h) => h === 'BUNDLEWORTH'],
  ['date', (h) => h.startsWith('DATEANDTIME') || h === 'DATE']
];

function amount(value) {
  const n = Number(text(value).replace(/[₱,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// "7/18/2026 13:35" → a number to compare (0 when blank).
function when(value) {
  const m = text(value).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  return m ? Date.UTC(+m[3], m[1] - 1, +m[2], +(m[4] || 0), +(m[5] || 0)) : 0;
}

const pictureKey = (name) => text(name).toUpperCase().replace(/^FREEBIES?-/, '').replace(/\((PWP|HARD BUNDLING)\)|\(\d+\)/g, '')
  .replace(/[^A-Z0-9]+/g, ' ').trim();
// "FREEBIES-MSE MSI M88 BLACK (PWP)" → "MSI M88 BLACK" (what the banner shows when there is no picture).
const freebieLabel = (name) => text(name).replace(/^FREEBIES?-/i, '').replace(/^(MSE|KB|HS|ACC|ADA|FLA|MON|SODIMM|FURNITURE)[- ]/i, '')
  .replace(/\s*\((pwp|hard bundling)\)/gi, '').trim();
// A bundle lists its freebies one per line (or joined by "/" before the next one's code, as in ".../ADA-A4TECH").
const splitFreebies = (value) => text(value).split(/\n|\/(?=[A-Z]{2,}-)/).map((part) => part.trim()).filter(Boolean);

// PERIPHEALS values → Map(picture key → link).
function peripheralPictures(values = []) {
  const pictures = new Map();
  for (const row of values) {
    const name = text((row || [])[0]);
    const link = text((row || [])[1]);
    if (!name || !/^https?:\/\//i.test(link)) continue;
    const key = pictureKey(name);
    if (key && !pictures.has(key)) pictures.set(key, link);
  }
  return pictures;
}

function findPicture(pictures, name) {
  const key = pictureKey(name);
  if (!key) return '';
  if (pictures.has(key)) return pictures.get(key);
  for (const [other, link] of pictures) if (other.includes(key) || key.includes(other)) return link;
  return '';
}

// AGEING BANNER MONITORING values (header in row 1) + PERIPHEALS values → collection ageing_monitoring: one row per
// laptop (its latest), with freebies as JSON [{ name, label, picture }]. Throws when ITEM DESCRIPTION is not found.
function ageingMonitoringCollection(values = [], peripheralValues = []) {
  const header = values[0] || [];
  const columns = {};
  for (const [field, test] of FIELDS) {
    const index = header.findIndex((cell, i) => test(headerKey(cell)) && !Object.values(columns).includes(i));
    if (index !== -1) columns[field] = index;
  }
  if (columns.item === undefined) throw new Error('AGEING BANNER MONITORING: the ITEM DESCRIPTION header was not found');
  const cell = (row, field) => (columns[field] === undefined ? '' : (row || [])[columns[field]]);
  const latest = new Map();
  values.slice(1).forEach((row, order) => {
    const item = text(cell(row, 'item'));
    if (!item) return;
    const key = itemKey(item);
    const date = when(cell(row, 'date'));
    const current = latest.get(key);
    // A later date wins; on the same date (or none) the lower row, the one added last.
    if (!current || date >= current.date) latest.set(key, { row, date, order });
  });
  const pictures = peripheralPictures(peripheralValues);
  const rows = [...latest.values()].sort((a, b) => a.order - b.order).map(({ row }) => {
    const cash = amount(cell(row, 'price')) || amount(cell(row, 'cash'));
    const before = amount(cell(row, 'oldPrice')) || amount(cell(row, 'before'));
    const save = amount(cell(row, 'save')) || (before > cash ? before - cash : 0);
    return {
      item_code: text(cell(row, 'item')).replace(/\s+/g, ' '),
      stock: String(amount(cell(row, 'stock'))),
      cash: String(cash || ''),
      before: String(before || ''),
      save: String(save || ''),
      worth: String(amount(cell(row, 'worth')) || ''),
      freebies: JSON.stringify(splitFreebies(cell(row, 'freebies')).map((name) => ({ name, label: freebieLabel(name), picture: findPicture(pictures, name) }))),
      date: text(cell(row, 'date'))
    };
  }).filter((row) => row.cash);
  return {
    collection: 'ageing_monitoring',
    columns: ['item_code', 'stock', 'cash', 'before', 'save', 'worth', 'freebies', 'date'],
    rows: rows.map((data, index) => ({ id: `item_${String(index + 1).padStart(4, '0')}`, data }))
  };
}

// Reads both sheets with the Sheets client. mainTitles: the main spreadsheet's tab names (for PERIPHEALS).
async function readAgeingMonitoring(sheets, { promoSpreadsheetId = DEFAULT_PROMO_MONITORING_SPREADSHEET_ID, mainSpreadsheetId, mainTitles = [] }) {
  const tab = (name) => `'${name.replace(/'/g, "''")}'`;
  const monitoring = await sheets.spreadsheets.values.get({
    spreadsheetId: promoSpreadsheetId,
    range: `${tab(AGEING_MONITORING_SHEET)}!${AGEING_MONITORING_RANGE}`,
    valueRenderOption: 'FORMATTED_VALUE'
  });
  const peripheralsTitle = mainTitles.find((name) => PERIPHERALS_SHEETS.includes(name.trim().toUpperCase()));
  let peripherals = [];
  if (peripheralsTitle) {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: mainSpreadsheetId,
      range: `${tab(peripheralsTitle)}!${PERIPHERALS_RANGE}`,
      valueRenderOption: 'FORMATTED_VALUE'
    });
    peripherals = response.data.values || [];
  }
  return ageingMonitoringCollection(monitoring.data.values || [], peripherals);
}

// rows: the ageing_monitoring table → Map(item key → { cash, before, save, worth, stock, freebies: [{ label, picture }] }).
function clearanceByItem(rows = [], imageUrl = (value) => value) {
  const result = new Map();
  for (const row of rows) {
    let freebies = [];
    try { freebies = JSON.parse(row.freebies || '[]'); } catch { freebies = []; }
    result.set(itemKey(row.item_code), {
      cash: amount(row.cash),
      before: amount(row.before),
      save: amount(row.save),
      worth: amount(row.worth),
      stock: amount(row.stock),
      freebies: (Array.isArray(freebies) ? freebies : []).map((f) => ({ label: text(f.label) || text(f.name), picture: f.picture ? imageUrl(text(f.picture)) : '' }))
    });
  }
  return result;
}

module.exports = {
  AGEING_MONITORING_SHEET, DEFAULT_PROMO_MONITORING_SPREADSHEET_ID,
  ageingMonitoringCollection, readAgeingMonitoring, clearanceByItem, splitFreebies, freebieLabel
};
