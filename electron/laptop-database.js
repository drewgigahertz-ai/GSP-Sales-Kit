// Flyers page laptop specs (server side), from the LAPTOP DATABASE tab of the pricing spreadsheet (GST PRICING):
//   A: LAPTOP (item description), B: BRAND, C: EOL STATUS, D: REMARKS, E: MTM (part number), F: MODEL,
//   G–L: PROCESSOR, GRAPHICS, STORAGE, MEMORY, RESOLUTION, OS, M–P: KSP 1–4 (not used), Q: MODEL AND MTM.
// Read by range: rows 1–5 are titles and headers; the laptops start on row 6.

const LAPTOP_DATABASE_SHEET = 'LAPTOP DATABASE';
const LAPTOP_DATABASE_RANGE = 'A6:L';
const FIRST_ROW = 6;

function text(value) {
  const result = value === null || value === undefined ? '' : String(value).trim();
  return result.startsWith('#') ? '' : result;
}

// Sheet values (A6:L) → collection for database.replaceSheetsData (table laptop_database).
function laptopDatabaseCollection(values = []) {
  // Ids keep the sheet row, so a laptop can be found in the sheet.
  const rows = values.flatMap((row, index) => {
    const data = {
      item: text(row[0]),
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
    return data.item ? [{ id: `item_${String(index + FIRST_ROW).padStart(4, '0')}`, data }] : [];
  });
  return {
    collection: 'laptop_database',
    columns: ['item', 'brand', 'eol_status', 'mtm', 'model', 'processor', 'graphics', 'storage', 'memory', 'resolution', 'os'],
    rows
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

module.exports = { LAPTOP_DATABASE_SHEET, LAPTOP_DATABASE_RANGE, laptopDatabaseCollection, makeLaptopDatabase };
