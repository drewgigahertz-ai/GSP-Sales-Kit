// Prices straight from the sheet where they are edited, NEW PRICING MATRIX V3 (server side). GST PRICING's NEW
// PRICING is an IMPORTRANGE copy of it; reading the original gives price changes the time they were made (within
// the minute of the price check) and none of the copy's "Loading…" / #REF! reloads.
//
// Columns are found by their headers (row 1: the price group, row 2: the column), so inserted or moved columns do
// not matter. Only the columns below are read: the matrix also holds costs, profits and margins, which never leave it.
// The result is laid out like GST PRICING's NEW PRICING (banner-data.js pricesCollection reads it unchanged):
//   A BRANCH (blank: the matrix has none), B ITEM DESCRIPTION, C PROMO TITLE,
//   D–G no bundle: CASH PRICE, SRP 3 months, 12MOS, HOME CREDIT, H–K with bundle: the same,
//   L BUNDLE CODE, M TOTAL BUNDLE COST, N TOTAL BUNDLE SRP, O–Q vendor freebies 1–3, R TOTAL PROMO (C & O & P & Q),
//   then (not in NEW PRICING) the other payment terms: S–X no bundle, Y–AD with bundle, see TERM_COLUMNS.

const PRICE_MATRIX_SHEET = 'NEW PRICING MATRIX V3';
const DEFAULT_PRICE_MATRIX_SPREADSHEET_ID = '1y4IQ4B1HyrK6kmBZcxMy-t3z7FxZX8bp6aIeKTWl4D8';
const HEADER_RANGE = 'A1:ZZ2';

// [name, price group ('' = any), start of the column header]; headers are compared in capitals, letters and digits only.
const COLUMNS = [
  ['item', '', 'ITEMDESCRIPTION'],
  ['promoTitle', '', 'PROMOTITLE'],
  ['cashNoBundle', 'NOBUNDLE', 'CASHPRICE'],
  ['srpNoBundle', 'NOBUNDLE', 'SRP3MONTHS'],
  ['twelveNoBundle', 'NOBUNDLE', '12MOS'],
  ['homeCreditNoBundle', 'NOBUNDLE', 'HOMECREDIT'],
  ['cashBundle', 'WITHBUNDLE', 'CASHPRICE'],
  ['srpBundle', 'WITHBUNDLE', 'SRP3MONTHS'],
  ['twelveBundle', 'WITHBUNDLE', '12MOS'],
  ['homeCreditBundle', 'WITHBUNDLE', 'HOMECREDIT'],
  ['bundleCode', 'WITHBUNDLE', 'BUNDLECODE'],
  ['bundleCost', 'WITHBUNDLE', 'TOTALBUNDLECOST'],
  ['bundleSrp', 'WITHBUNDLE', 'TOTALBUNDLESRP'],
  ['freebie1', '', '1VENDORFREEBIES'],
  ['freebie2', '', '2VENDORFREEBIES'],
  ['freebie3', '', '3VENDORFREEBIES']
];
// Readable names for the "not found" warning.
const LABELS = {
  item: 'ITEM DESCRIPTION', promoTitle: 'PROMO TITLE',
  cashNoBundle: 'NO BUNDLE → CASH PRICE', srpNoBundle: 'NO BUNDLE → SRP 3 months', twelveNoBundle: 'NO BUNDLE → 12MOS',
  homeCreditNoBundle: 'NO BUNDLE → HOME CREDIT', cashBundle: 'WITH BUNDLE → CASH PRICE', srpBundle: 'WITH BUNDLE → SRP 3 months',
  twelveBundle: 'WITH BUNDLE → 12MOS', homeCreditBundle: 'WITH BUNDLE → HOME CREDIT', bundleCode: 'WITH BUNDLE → BUNDLE CODE',
  bundleCost: 'WITH BUNDLE → TOTAL BUNDLE COST', bundleSrp: 'WITH BUNDLE → TOTAL BUNDLE SRP',
  freebie1: '1. VENDOR FREEBIES', freebie2: '2. VENDOR FREEBIES', freebie3: '3. VENDOR FREEBIES'
};
// The output columns B–Q in order (A is the blank BRANCH, R is built).
const OUTPUT = ['item', 'promoTitle', 'cashNoBundle', 'srpNoBundle', 'twelveNoBundle', 'homeCreditNoBundle',
  'cashBundle', 'srpBundle', 'twelveBundle', 'homeCreditBundle', 'bundleCode', 'bundleCost', 'bundleSrp',
  'freebie1', 'freebie2', 'freebie3'];
const OUTPUT_HEADER = ['BRANCH', 'ITEM DESCRIPTION', 'PROMO TITLE', 'CASH PRICE', 'SRP', '12MOS', 'HOME CREDIT',
  'CASH PRICE', 'SRP', '12MOS', 'HOME CREDIT', 'BUNDLE CODE', 'TOTAL BUNDLE COST', 'TOTAL BUNDLE SRP',
  'FREEBIE 1', 'FREEBIE 2', 'FREEBIE 3', 'TOTAL PROMO'];

// The other payment terms (the Quotation's Payment term dropdown), no bundle and with bundle: selling prices only.
// They are optional: a term whose column is not found is left blank (the prices above still load). They are added
// after R, in this order: S–X no bundle, Y–AD with bundle.
const TERM_COLUMNS = [
  ['m6', 'SRP6MONTHS'],
  ['m9', 'SRP9MONTHS'],
  ['m24', '24MOSHSBC'],
  ['m18', '18MOS'],
  ['bdo24', 'BDO24MOS'],
  ['m24b', '24MOSRCBC']
];
const EXTRA = [
  ...TERM_COLUMNS.map(([name, start]) => [`${name}NoBundle`, 'NOBUNDLE', start]),
  ...TERM_COLUMNS.map(([name, start]) => [`${name}Bundle`, 'WITHBUNDLE', start])
];
const EXTRA_HEADER = [
  ...TERM_COLUMNS.map(([name]) => `${name.toUpperCase()} NO BUNDLE`),
  ...TERM_COLUMNS.map(([name]) => `${name.toUpperCase()} WITH BUNDLE`)
];

const headerKey = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// 0 → 'A', 26 → 'AA'.
function columnLetters(index) {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

// Header rows (row 1: groups, filled to the right like merged cells; row 2: columns) → { name: column index }, and
// the names not found.
function locateColumns(groupRow = [], columnRow = [], columns = COLUMNS) {
  const width = Math.max(groupRow.length, columnRow.length);
  const groups = [];
  let group = '';
  for (let i = 0; i < width; i++) {
    if (headerKey(groupRow[i])) group = headerKey(groupRow[i]);
    groups.push(group);
  }
  const found = {};
  for (const [name, wanted, start] of columns) {
    for (let i = 0; i < width; i++) {
      if (wanted && !groups[i].includes(wanted)) continue;
      if (headerKey(columnRow[i]).startsWith(start)) {
        found[name] = i;
        break;
      }
    }
  }
  return { found, missing: columns.map(([name]) => name).filter((name) => found[name] === undefined) };
}

// Reads the matrix with the Sheets client: only the header rows, then only the needed columns. Returns values laid
// out like NEW PRICING (header row first). Throws when the tab or a column cannot be found.
async function readPriceMatrix(sheets, spreadsheetId) {
  const tab = `'${PRICE_MATRIX_SHEET.replace(/'/g, "''")}'`;
  const head = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!${HEADER_RANGE}`, valueRenderOption: 'FORMATTED_VALUE' });
  const [groupRow = [], columnRow = []] = head.data.values || [];
  const { found, missing } = locateColumns(groupRow, columnRow);
  if (missing.length) throw new Error(`Price matrix: ${missing.map((name) => LABELS[name]).join(', ')} not found`);
  const extra = locateColumns(groupRow, columnRow, EXTRA).found;
  const extraNames = EXTRA.map(([name]) => name).filter((name) => extra[name] !== undefined);

  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: [...OUTPUT.map((name) => found[name]), ...extraNames.map((name) => extra[name])]
      .map((index) => `${tab}!${columnLetters(index)}3:${columnLetters(index)}`),
    majorDimension: 'COLUMNS',
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  const all = (response.data.valueRanges || []).map((range) => (range.values && range.values[0]) || []);
  const columns = all.slice(0, OUTPUT.length);
  const extraColumns = Object.fromEntries(extraNames.map((name, i) => [name, all[OUTPUT.length + i]]));
  const length = Math.max(0, ...all.map((column) => column.length));
  const rows = [[...OUTPUT_HEADER, ...EXTRA_HEADER]];
  const cell = (column, r) => (!column || column[r] === undefined ? '' : column[r]);
  for (let r = 0; r < length; r++) {
    const cells = columns.map((column) => cell(column, r));
    const [, promoTitle] = cells;
    const freebies = cells.slice(-3);
    rows.push(['', ...cells, [promoTitle, ...freebies].map((value) => String(value ?? '')).join(''),
      ...EXTRA.map(([name]) => cell(extraColumns[name], r))]);
  }
  return rows;
}

module.exports = { TERM_COLUMNS, PRICE_MATRIX_SHEET, DEFAULT_PRICE_MATRIX_SPREADSHEET_ID, readPriceMatrix, locateColumns, columnLetters };
