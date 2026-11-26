// NON-LAPTOP KSP: the key selling points of desktops, mobiles and accessories, shown as their specs on the Quotation.
//   ITEM DESC  the product's name as in the price matrix (e.g. "MON-ACER SA222Q 21.5 100Hz")
//   KSP        one cell of blocks split by a blank line, each a title line and its description:
//                "100Hz Refresh Rate\nDelivers smooth motion …\n\n1ms Response Time\nEliminates motion blur …"
// The columns are found by their headers (the first rows may hold a title such as "RECOTABLE"). The tab is looked
// for in the main spreadsheet, then the pricing spreadsheet, then the price matrix spreadsheet.

const NON_LAPTOP_KSP_SHEET = 'NON-LAPTOP KSP';
const HEADER_SEARCH_ROWS = 10;

const text = (value) => (value === null || value === undefined ? '' : String(value).trim());
const headerKey = (value) => text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
const itemKey = (value) => text(value).replace(/\s+/g, ' ').toUpperCase();

// "Title\nDescription\n\nTitle\nDescription" → [{ title, text }]. A block of one line is a title alone.
function parseKsp(value) {
  return text(value).replace(/\r\n?/g, '\n').split(/\n\s*\n/)
    .map((block) => block.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length)
    .map((lines) => ({ title: lines[0], text: lines.slice(1).join(' ') }));
}

// The tab's values → rows { item, ksp (JSON of the blocks) }; the first row of an item wins.
function kspRows(values = []) {
  const headerRow = values.slice(0, HEADER_SEARCH_ROWS).findIndex((row) => (row || []).some((cell) => headerKey(cell) === 'KSP'));
  if (headerRow === -1) throw new Error('no KSP header in the first rows');
  const header = values[headerRow].map(headerKey);
  const itemCol = header.findIndex((h) => h === 'ITEMDESC' || h === 'ITEMDESCRIPTION' || h === 'ITEM');
  const kspCol = header.indexOf('KSP');
  if (itemCol === -1) throw new Error('no ITEM DESC header beside KSP');
  const seen = new Set();
  const rows = [];
  for (const row of values.slice(headerRow + 1)) {
    const item = text(row && row[itemCol]).replace(/\s+/g, ' ');
    const blocks = parseKsp(row && row[kspCol]);
    if (!item || !blocks.length || seen.has(itemKey(item))) continue;
    seen.add(itemKey(item));
    rows.push({ item, ksp: JSON.stringify(blocks) });
  }
  return rows;
}

function collection(rows) {
  return {
    collection: 'non_laptop_ksp',
    columns: ['item', 'ksp'],
    rows: rows.map((data, index) => ({ id: `item_${String(index + 1).padStart(5, '0')}`, data }))
  };
}

// sources: [{ spreadsheetId, titles? }] in the order to look. Returns the collection, or null when no spreadsheet
// has the tab (nothing to sync). Throws when the tab is there but cannot be read.
async function readNonLaptopKsp(sheets, sources) {
  for (const source of sources) {
    if (!source || !source.spreadsheetId) continue;
    let titles = source.titles;
    if (!titles) {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: source.spreadsheetId, fields: 'sheets(properties(title))' });
      titles = (meta.data.sheets || []).map((sheet) => sheet.properties.title);
    }
    const title = titles.find((name) => name.trim().toUpperCase() === NON_LAPTOP_KSP_SHEET);
    if (!title) continue;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: source.spreadsheetId,
      range: `'${title.replace(/'/g, "''")}'!A:Z`,
      valueRenderOption: 'FORMATTED_VALUE'
    });
    return collection(kspRows(response.data.values || []));
  }
  return null;
}

// The non_laptop_ksp table → { 'ITEM DESC (upper case)': [{ title, text }] }.
function nonLaptopKsp(rows = []) {
  const out = {};
  for (const row of rows) {
    let blocks = [];
    try { blocks = JSON.parse(row.ksp || '[]'); } catch { blocks = []; }
    if (row.item && blocks.length) out[itemKey(row.item)] = blocks;
  }
  return out;
}

module.exports = { NON_LAPTOP_KSP_SHEET, readNonLaptopKsp, nonLaptopKsp, kspRows, parseKsp, itemKey };
