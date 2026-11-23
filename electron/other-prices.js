// Other products for the Quotation page (server side), from GHZ PRICING MATRIX (the price matrix spreadsheet):
//   ATTACHMENT PRICING      accessories (mouse, monitor, headset …): ITEM DESCRIPTION, CATEGORY, PROMO TITLE, and the
//                           10 payment terms twice: ATTACHMENT PRICE (bought with a laptop) and REGULAR PRICE.
//   DESKTOP PRICING SUMMARY desktops / AIOs: ITEM DESCRIPTION, PROGRAM TITLE, cash, 3/6/9/12/18 months, bank 24 months,
//                           Home Credit.
//   PM MOBILE VER 2.5       cellphones, tablets, AIOT, consoles: ITEM GROUP, ITEM DESCRIPTION, PROMO TITLE, cash/SRP,
//                           website/straight, 6/9/12/18 months, the 24-month groups, Home Credit.
// Only selling prices are read: never the cost, support, profit or % columns. Columns are found by their headers (the
// row with ITEM DESCRIPTION; ATTACHMENT PRICING's price set by the group above it), only the needed columns are fetched.
// Each product's prices use the Quotation's term keys (quotation-terms.js): cash, m3, m6, m9, m12, m24, hc, m18, bdo24, m24b.

const headerKey = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const text = (value) => (value === null || value === undefined ? '' : String(value).trim());

function columnLetters(index) {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}
function price(value) {
  const n = typeof value === 'number' ? value : Number(text(value).replace(/[₱,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// The 10 terms as the laptop price matrix names them (ATTACHMENT PRICING uses the same headers).
const MATRIX_TERMS = [
  ['cash', (h) => h.startsWith('CASHPRICE')],
  ['m3', (h) => h.startsWith('SRP3MONTHS')],
  ['m6', (h) => h.startsWith('SRP6MONTHS')],
  ['m9', (h) => h.startsWith('SRP9MONTHS')],
  ['m12', (h) => h.startsWith('12MOS')],
  ['m24', (h) => h.startsWith('24MOSHSBC')],
  ['hc', (h) => h.startsWith('HOMECREDIT')],
  ['m18', (h) => h.startsWith('18MOS')],
  ['bdo24', (h) => h.startsWith('BDO24MOS')],
  ['m24b', (h) => h.startsWith('24MOSRCBC')]
];

const SOURCES = [
  {
    sheet: 'ATTACHMENT PRICING',
    kind: 'attachment',
    fields: [['item', (h) => h === 'ITEMDESCRIPTION'], ['category', (h) => h === 'CATEGORY'], ['promo', (h) => h === 'PROMOTITLE']],
    // price set → [group header test, terms]; withBundle = ATTACHMENT PRICE, noBundle = REGULAR PRICE
    groups: [['withBundle', (g) => g.includes('ATTACHMENTPRICE'), MATRIX_TERMS], ['noBundle', (g) => g.includes('REGULARPRICE'), MATRIX_TERMS]]
  },
  {
    sheet: 'DESKTOP PRICING SUMMARY',
    kind: 'desktop',
    fields: [['item', (h) => h === 'ITEMDESCRIPTION'], ['promo', (h) => h === 'PROGRAMTITLE' || h === 'PROMOTITLE']],
    groups: [['noBundle', null, [
      ['cash', (h) => h === 'CASHPRICE'],
      ['m3', (h) => h.startsWith('SRP3MONTHS')],
      ['m6', (h) => h.startsWith('SRP6MONTHS')],
      ['m9', (h) => h.startsWith('CARDSRP9MOS')],
      ['m12', (h) => h.startsWith('CARDSRP12MOS')],
      ['m18', (h) => h.startsWith('CARDSRP18MOS')],
      ['m24', (h) => h.startsWith('CARDSRPHSBC24MOS')],
      ['m24b', (h) => h.startsWith('CARDSRPRCBC24MOS')],
      ['hc', (h) => h === 'HCCASHPRICE']
    ]]]
  },
  {
    sheet: 'PM MOBILE VER 2.5',
    kind: 'mobile',
    fields: [['item', (h) => h === 'ITEMDESCRIPTION'], ['category', (h) => h === 'ITEMGROUP'], ['promo', (h) => h === 'PROMOTITLE']],
    groups: [['noBundle', null, [
      ['cash', (h) => h === 'CASHSRP' || h === 'CASHPRICE'],
      ['m3', (h) => h.startsWith('WEBSITE')],
      ['m6', (h) => h === '6MOS'],
      ['m9', (h) => h === '9MOS'],
      ['m12', (h) => h === '12MOS'],
      ['m18', (h) => h === '18MOS'],
      ['m24', (h) => h.startsWith('24MOSHSBC')],
      ['m24b', (h) => h.startsWith('24MOSRCBC')],
      ['bdo24', (h) => h.startsWith('BDO24MOS')],
      ['hc', (h) => h === 'HCREGULAR']
    ]]]
  }
];

// Header rows (the first 6 rows) → { header row index, fields: {name: col}, prices: [[set, term, col]] }.
function locate(source, rows) {
  const headerRow = rows.findIndex((row) => (row || []).some((cell) => headerKey(cell) === 'ITEMDESCRIPTION'));
  if (headerRow === -1) throw new Error(`${source.sheet}: the ITEM DESCRIPTION header was not found`);
  const header = rows[headerRow] || [];
  const groupRow = rows[headerRow - 1] || [];
  const groups = [];
  let group = '';
  for (let i = 0; i < Math.max(header.length, groupRow.length); i += 1) {
    if (headerKey(groupRow[i])) group = headerKey(groupRow[i]);
    groups.push(group);
  }
  const fields = {};
  for (const [name, test] of source.fields) {
    const index = header.findIndex((cell) => test(headerKey(cell)));
    if (index !== -1) fields[name] = index;
  }
  if (fields.item === undefined) throw new Error(`${source.sheet}: the ITEM DESCRIPTION header was not found`);
  const prices = [];
  for (const [set, groupTest, terms] of source.groups) {
    for (const [term, test] of terms) {
      const index = header.findIndex((cell, i) => test(headerKey(cell)) && (!groupTest || groupTest(groups[i] || '')));
      if (index !== -1) prices.push([set, term, index]);
    }
  }
  if (!prices.some(([, term]) => term === 'cash')) throw new Error(`${source.sheet}: no cash price column was found`);
  return { headerRow, fields, prices };
}

async function readSource(sheets, spreadsheetId, source) {
  const tab = `'${source.sheet.replace(/'/g, "''")}'`;
  const head = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A1:ZZ6`, valueRenderOption: 'FORMATTED_VALUE' });
  const { headerRow, fields, prices } = locate(source, head.data.values || []);
  const wanted = [...Object.values(fields), ...prices.map(([, , index]) => index)];
  const start = headerRow + 2;
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: wanted.map((index) => `${tab}!${columnLetters(index)}${start}:${columnLetters(index)}`),
    majorDimension: 'COLUMNS',
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  const columns = new Map(wanted.map((index, i) => [index, (((response.data.valueRanges || [])[i] || {}).values || [[]])[0] || []]));
  const length = Math.max(0, ...[...columns.values()].map((column) => column.length));
  const at = (index, r) => (index === undefined ? '' : (columns.get(index) || [])[r]);
  const products = [];
  const seen = new Set();
  for (let r = 0; r < length; r += 1) {
    const item = text(at(fields.item, r)).replace(/\s+/g, ' ');
    const key = item.toUpperCase();
    if (!item || seen.has(key)) continue;
    const terms = {};
    for (const [set, term, index] of prices) {
      const value = price(at(index, r));
      if (value === null) continue;
      if (!terms[set]) terms[set] = {};
      terms[set][term] = value;
    }
    // A row without any cash price (a brand heading, a blank product) is not a product.
    if (!Object.values(terms).some((set) => set.cash != null)) continue;
    seen.add(key);
    const promo = text(at(fields.promo, r));
    products.push({
      item_code: item,
      kind: source.kind,
      category: text(at(fields.category, r)),
      promo: /^no promo$/i.test(promo) ? '' : promo,
      terms: JSON.stringify(terms)
    });
  }
  return products;
}

// All three tabs → collection other_prices. A tab that cannot be read is reported through warn and left out.
async function readOtherPrices(sheets, spreadsheetId, warn = () => {}) {
  const rows = [];
  for (const source of SOURCES) {
    try {
      rows.push(...await readSource(sheets, spreadsheetId, source));
    } catch (error) {
      warn(`${source.sheet}: ${error.message}`);
    }
  }
  return {
    collection: 'other_prices',
    columns: ['item_code', 'kind', 'category', 'promo', 'terms'],
    rows: rows.map((data, index) => ({ id: `item_${String(index + 1).padStart(5, '0')}`, data }))
  };
}

// The other_prices table → [{ item, kind, category, promo, terms }] for the Quotation page.
function otherProducts(rows = []) {
  return rows.map((row) => {
    let terms = {};
    try { terms = JSON.parse(row.terms || '{}') || {}; } catch { terms = {}; }
    return { item: text(row.item_code), kind: text(row.kind), category: text(row.category), promo: text(row.promo), terms };
  }).filter((product) => product.item);
}

module.exports = { readOtherPrices, otherProducts, locate, SOURCES };
