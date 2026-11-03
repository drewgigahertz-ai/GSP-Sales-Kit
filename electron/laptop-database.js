// Laptop specs (server side), from the LAPTOP DB tab of the main spreadsheet: one sheet for the Flyers page (name,
// part number, specs) and the Banner page (specs, in place of BANNER SPECS).
//   A: LAPTOP (item description), B: BRAND, C: EOL STATUS, D: REMARKS, E: MTM (part number), F: MODEL,
//   G–L: PROCESSOR, GRAPHICS, STORAGE, MEMORY, RESOLUTION, OS, M–P: KSP 1–4 (not used).
// The header rows at the top (repeated today) are skipped wherever they are; the laptops follow them.

const LAPTOP_DATABASE_SHEET = 'LAPTOP DB';
const LAPTOP_DATABASE_RANGE = 'A:L';
// [Banner guide, column index]: the Banner page's spec rows (see banner-data.js SPEC_GUIDES).
const BANNER_GUIDES = [['PROCESSOR', 6], ['GRAPHICS', 7], ['STORAGE', 8], ['MEMORY', 9], ['RESOLUTION', 10], ['OS', 11]];

function text(value) {
  const result = value === null || value === undefined ? '' : String(value).trim();
  return result.startsWith('#') ? '' : result;
}

// A header row: "LAPTOP" / "ITEM DESCRIPTION" / a link in A, or PROCESSOR / QUICK SPECS in G.
function isHeader(row) {
  const first = text(row[0]).toUpperCase();
  const specs = text(row[6]).toUpperCase();
  return first === 'LAPTOP' || first === 'ITEM DESCRIPTION' || /^HTTPS?:\/\//.test(first)
    || specs === 'PROCESSOR' || specs === 'QUICK SPECS';
}

// Sheet values (A:L, from row 1) → collection for database.replaceSheetsData (table laptop_database).
function laptopDatabaseCollection(values = []) {
  // Ids keep the sheet row, so a laptop can be found in the sheet (Data health tab).
  const rows = values.flatMap((row, index) => {
    if (isHeader(row)) return [];
    const data = {
      item: text(row[0]).replace(/\s+/g, ' '),
      brand: text(row[1]),
      eol_status: text(row[2]).toUpperCase(),
      mtm: text(row[4]),
      model: text(row[5]),
      processor: text(row[6]),
      graphics: text(row[7]),
      storage: text(row[8]),
      memory: text(row[9]),
      resolution: text(row[10]),
      os: text(row[11])
    };
    return data.item ? [{ id: `item_${String(index + 1).padStart(4, '0')}`, data }] : [];
  });
  return {
    collection: 'laptop_database',
    columns: ['item', 'brand', 'eol_status', 'mtm', 'model', 'processor', 'graphics', 'storage', 'memory', 'resolution', 'os'],
    rows
  };
}

// The same sheet values → the Banner page's spec rows (table banner_specs: item_code, guide, value), as BANNER
// SPECS gave them.
function bannerSpecsCollection(values = []) {
  const rows = values.flatMap((row) => {
    if (isHeader(row)) return [];
    const itemCode = text(row[0]).replace(/\s+/g, ' ');
    if (!itemCode) return [];
    return BANNER_GUIDES.flatMap(([guide, column]) => (text(row[column]) ? [{ item_code: itemCode, guide, value: text(row[column]) }] : []));
  });
  return {
    collection: 'banner_specs',
    columns: ['item_code', 'guide', 'value'],
    rows: rows.map((data, index) => ({ id: `item_${String(index + 1).padStart(4, '0')}`, data }))
  };
}

// Database rows → what the Flyers page needs, one entry per laptop (the first row of a laptop listed twice).
function makeLaptopDatabase(rows = []) {
  const seen = new Set();
  return rows.flatMap((row) => {
    const id = text(row.item).replace(/\s+/g, ' ').toUpperCase();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{
      item: text(row.item),
      brand: text(row.brand),
      model: text(row.model),
      partNumber: text(row.mtm),
      endOfLife: /^(END OF LIFE|EOL)$/.test(text(row.eol_status)),
      specs: {
        Processor: text(row.processor),
        Graphics: text(row.graphics),
        Storage: text(row.storage),
        Memory: text(row.memory),
        Resolution: text(row.resolution),
        OS: text(row.os)
      }
    }];
  });
}

module.exports = { LAPTOP_DATABASE_SHEET, LAPTOP_DATABASE_RANGE, laptopDatabaseCollection, bannerSpecsCollection, makeLaptopDatabase };
