// Laptops (server side), from the LAPTOP DB tab of the main spreadsheet: the one sheet for
//   - the Banner page: its list of laptops (in place of LAPTOP RAW), names, part numbers, specs (in place of BANNER
//     SPECS) and features (KSP 1–4, each with its picture from the UKSP ICON tab),
//   - the Reco Table, Sales Kit and Flyers: each laptop's picture, model, part number and specs (in place of SPECS;
//     SPECS still gives the spec ranks behind the Best / Better / Good colours, and anything LAPTOP DB lacks).
// Columns are found by their headers (ITEM DESCRIPTION, BRAND, EOL STATUS, MTM, MODEL, PROCESSOR … OS, KSP 1–4),
// so inserted or moved columns do not matter. The laptop picture is the column headed IMAGE / PICTURE / PHOTO, or
// else the column just before ITEM DESCRIPTION (headerless today: column A).
// Inventory: each column after the last of those headed with a branch code (ALB, ALSA, … HO, … VMLC) is that
// branch's stock of the laptop; new branch columns are picked up by themselves.
// The laptops come from an IMPORTRANGE, which repeats its own header rows; those are skipped wherever they are.
// While the IMPORTRANGE is still loading ("Loading…", #REF!) nothing is taken, so the last synced laptops stay.

const LAPTOP_DATABASE_SHEET = 'LAPTOP DB';
const LAPTOP_DATABASE_RANGE = 'A:CZ';
const UKSP_ICON_SHEET = 'UKSP ICON';
const UKSP_ICON_RANGE = 'A:B';
// Header rows are looked for in the first rows of the sheet.
const HEADER_ROWS = 6;

// [field, header (capitals, letters and digits only), exact or the start of the header]
const FIELDS = [
  ['item', 'ITEMDESCRIPTION', 'start'],
  ['brand', 'BRAND', 'exact'],
  ['eol', 'EOLSTATUS', 'start'],
  ['mtm', 'MTM', 'exact'],
  ['model', 'MODEL', 'exact'],
  ['processor', 'PROCESSOR', 'exact'],
  ['graphics', 'GRAPHICS', 'exact'],
  ['storage', 'STORAGE', 'exact'],
  ['memory', 'MEMORY', 'exact'],
  ['resolution', 'RESOLUTION', 'exact'],
  ['os', 'OS', 'exact'],
  ['ksp1', 'KSP1', 'exact'],
  ['ksp2', 'KSP2', 'exact'],
  ['ksp3', 'KSP3', 'exact'],
  ['ksp4', 'KSP4', 'exact']
];
// The Banner page's spec rows (see banner-data.js SPEC_GUIDES): [guide, field].
const BANNER_GUIDES = [['PROCESSOR', 'processor'], ['GRAPHICS', 'graphics'], ['STORAGE', 'storage'], ['MEMORY', 'memory'],
  ['RESOLUTION', 'resolution'], ['OS', 'os']];

function text(value) {
  const result = value === null || value === undefined ? '' : String(value).trim();
  return result.startsWith('#') ? '' : result;
}

const headerKey = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const nameKey = (value) => text(value).replace(/\s+/g, ' ').toUpperCase();

// { field: column index } from the header rows; throws when ITEM DESCRIPTION is not found.
function locateColumns(values) {
  const top = values.slice(0, HEADER_ROWS);
  const found = {};
  for (const [field, header, how] of FIELDS) {
    for (const row of top) {
      const index = (row || []).findIndex((cell) => (how === 'exact' ? headerKey(cell) === header : headerKey(cell).startsWith(header)));
      if (index !== -1) {
        found[field] = index;
        break;
      }
    }
  }
  if (found.item === undefined) throw new Error('LAPTOP DB: ITEM DESCRIPTION header not found');
  let picture = -1;
  for (const row of top) {
    picture = (row || []).findIndex((cell) => /^(IMAGE|PICTURE|PHOTO|LAPTOPIMAGE|LAPTOPPICTURE)/.test(headerKey(cell)));
    if (picture !== -1) break;
  }
  found.picture = picture !== -1 ? picture : found.item - 1;
  // Branch stock columns: right of the last field found, headed (row 1) with a branch code.
  const last = Math.max(...FIELDS.map(([field]) => (found[field] === undefined ? -1 : found[field])));
  found.stock = [];
  ((top[0]) || []).forEach((cell, index) => {
    const code = text(cell).toUpperCase();
    if (index > last && /^[A-Z0-9][A-Z0-9 -]{0,19}$/.test(code)) found.stock.push([index, code]);
  });
  return found;
}

const stockNumber = (value) => {
  const number = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};

// A header row of the imported block: "LAPTOP" / "ITEM DESCRIPTION" / a link in the item column.
function isHeaderItem(value) {
  const item = text(value).toUpperCase();
  return item === 'LAPTOP' || item === 'ITEM DESCRIPTION' || /^HTTPS?:\/\//.test(item);
}

// Sheet values (A:AZ, from row 1) → [{ row, item, picture, brand, eol, mtm, model, processor, …, os, ksp1–4 }].
// Throws while the sheet is still loading or has no laptops, so the caller keeps the last synced data.
function parseLaptopDb(values = []) {
  const columns = locateColumns(values);
  const loading = values.some((row) => /^(Loading|#REF!|#ERROR!|#N\/A)/i.test(String((row || [])[columns.item] ?? '').trim()));
  if (loading) throw new Error('LAPTOP DB is still loading (its IMPORTRANGE has not finished)');
  const laptops = values.flatMap((row, index) => {
    if (index < 2 || !row) return [];
    const item = text(row[columns.item]).replace(/\s+/g, ' ');
    if (!item || isHeaderItem(item) || headerKey(row[columns.processor]) === 'PROCESSOR') return [];
    const laptop = { row: index + 1, item, picture: columns.picture >= 0 ? text(row[columns.picture]) : '' };
    for (const [field] of FIELDS) {
      if (field !== 'item') laptop[field] = columns[field] === undefined ? '' : text(row[columns[field]]);
    }
    laptop.eol = laptop.eol.toUpperCase();
    // { BRANCH: units } of the branches with stock.
    laptop.stock = Object.fromEntries(columns.stock.map(([index, code]) => [code, stockNumber(row[index])]).filter(([, units]) => units > 0));
    return [laptop];
  });
  if (!laptops.length) throw new Error('LAPTOP DB has no laptops');
  return laptops;
}

const rowId = (laptop) => `item_${String(laptop.row).padStart(4, '0')}`;

// → collection laptop_database (Flyers page, Data health, the SPECS replacement). Ids keep the sheet row.
function laptopDatabaseCollection(laptops) {
  const columns = ['item', 'picture', 'brand', 'eol_status', 'mtm', 'model', 'processor', 'graphics', 'storage', 'memory',
    'resolution', 'os', 'ksp1', 'ksp2', 'ksp3', 'ksp4', 'stock'];
  return {
    collection: 'laptop_database',
    columns,
    rows: laptops.map((laptop) => ({ id: rowId(laptop), data: { ...laptop, eol_status: laptop.eol, stock: JSON.stringify(laptop.stock || {}) } }))
  };
}

// → collection banner_specs (item_code, guide, value), as BANNER SPECS gave them.
function bannerSpecsCollection(laptops) {
  const rows = laptops.flatMap((laptop) => BANNER_GUIDES.flatMap(([guide, field]) => (laptop[field]
    ? [{ item_code: laptop.item, guide, value: laptop[field] }] : [])));
  return {
    collection: 'banner_specs',
    columns: ['item_code', 'guide', 'value'],
    rows: rows.map((data, index) => ({ id: `item_${String(index + 1).padStart(4, '0')}`, data }))
  };
}

// UKSP ICON values (A: UKSP NAME, B: UKSP LINK) → Map(name → picture link); the first of a name listed twice.
function ukspIcons(values = []) {
  const icons = new Map();
  for (const row of values) {
    const name = nameKey((row || [])[0]);
    const link = text((row || [])[1]);
    if (name && name !== 'UKSP NAME' && link && !icons.has(name)) icons.set(name, link);
  }
  return icons;
}

// "LENOVO" + "LENOVO IDEAPAD 3" → "LENOVO IDEAPAD 3"; "ACER" + "ASPIRE LITE" → "ACER ASPIRE LITE".
function brandAndModel(brand, model) {
  if (!model) return brand;
  return brand && !nameKey(model).startsWith(nameKey(brand)) ? `${brand} ${model}` : model;
}

// → collection banner_laptops, as LAPTOP RAW gave it: the Banner page's list. The brand logo is left to DB PHOTOS
// (by brand) and the segment to RECO TABLE; KSP 1–4 are the features, with their UKSP ICON pictures (a KSP without
// one gets DB PHOTOS' spec picture, if any). End-of-life laptops stay listed.
function bannerLaptopsCollection(laptops, iconValues = []) {
  const icons = ukspIcons(iconValues);
  const seen = new Set();
  const rows = laptops.flatMap((laptop) => {
    const key = nameKey(laptop.item);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      item_code: laptop.item,
      brand: laptop.brand,
      brand_pic: '',
      model: laptop.model,
      part_number: laptop.mtm,
      brand_model: brandAndModel(laptop.brand, laptop.model),
      segment: '',
      ...Object.fromEntries([1, 2, 3, 4].flatMap((n) => [
        [`uksp${n}`, laptop[`ksp${n}`]],
        [`uksp${n}_pic`, laptop[`ksp${n}`] ? icons.get(nameKey(laptop[`ksp${n}`])) || '' : '']
      ]))
    }];
  });
  return {
    collection: 'banner_laptops',
    columns: ['item_code', 'brand', 'brand_pic', 'model', 'part_number', 'brand_model', 'segment',
      'uksp1', 'uksp1_pic', 'uksp2', 'uksp2_pic', 'uksp3', 'uksp3_pic', 'uksp4', 'uksp4_pic'],
    rows: rows.map((data, index) => ({ id: `item_${String(index + 1).padStart(4, '0')}`, data }))
  };
}

// The panel size at the start of a resolution ('15.6" FHD (1920x1080)' → '15.6"').
function panelSizeOf(resolution) {
  const match = text(resolution).match(/^(\d{2}(?:\.\d+)?)\s*(?:"|''|”|in\b|inch)/i);
  return match ? `${match[1]}"` : '';
}

// Database rows → rows shaped like the SPECS sheet's (see database.js makeSpecsMap): LAPTOP DB for each laptop in
// it, its spec ranks (and a missing picture) from SPECS; SPECS rows of laptops not in LAPTOP DB stay as they are.
function specsRowsFromLaptopDb(laptopRows = [], specRows = []) {
  const specsByItem = new Map();
  for (const row of specRows) {
    const key = nameKey(row['ITEM DESCRIPTION']);
    if (key && !specsByItem.has(key)) specsByItem.set(key, row);
  }
  const seen = new Set();
  const rows = [];
  for (const laptop of laptopRows) {
    const key = nameKey(laptop.item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const spec = specsByItem.get(key) || {};
    rows.push({
      'ITEM DESCRIPTION': text(laptop.item),
      'Image URL': text(laptop.picture) || text(spec['Image URL']),
      'Model Code': text(laptop.mtm) || text(spec['Model Code']),
      MODEL: text(laptop.model) || text(spec.MODEL),
      CPU: text(laptop.processor) || text(spec.CPU),
      GRAPHICS: text(laptop.graphics) || text(spec.GRAPHICS),
      STORAGE: text(laptop.storage) || text(spec.STORAGE),
      MEMORY: text(laptop.memory) || text(spec.MEMORY),
      RESOLUTION: text(laptop.resolution) || text(spec.RESOLUTION),
      'PANEL SIZE': panelSizeOf(laptop.resolution) || text(spec['PANEL SIZE']),
      // Prices come from NEW PRICING (the price matrix); SPECS' PRICE only for a laptop without one there.
      PRICE: text(spec.PRICE),
      // Spec ranks (Best / Better / Good): SPECS only, for now.
      'CPU HIERARCHY': spec['CPU HIERARCHY'] ?? '',
      'GRAPHICS HIERARCHY': spec['GRAPHICS HIERARCHY'] ?? '',
      'STORAGE (2)': spec['STORAGE (2)'] ?? '',
      'MEMORY (2)': spec['MEMORY (2)'] ?? '',
      'RESOLUTION (2)': spec['RESOLUTION (2)'] ?? ''
    });
  }
  for (const [key, row] of specsByItem) if (!seen.has(key)) rows.push(row);
  return rows;
}

function parseStock(value) {
  try {
    const stock = JSON.parse(value || '{}');
    return stock && typeof stock === 'object' ? stock : {};
  } catch {
    return {};
  }
}

// Database rows → what the Flyers page and the Reco Table need, one entry per laptop (the first row of a laptop listed twice).
function makeLaptopDatabase(rows = []) {
  const seen = new Set();
  return rows.flatMap((row) => {
    const id = nameKey(row.item);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{
      item: text(row.item),
      brand: text(row.brand),
      model: text(row.model),
      partNumber: text(row.mtm),
      endOfLife: /^(END OF LIFE|EOL)$/.test(text(row.eol_status)),
      // { BRANCH: units } from LAPTOP DB's inventory columns (the Reco Table's ALL BRANCHES lists).
      stock: parseStock(row.stock),
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

module.exports = {
  LAPTOP_DATABASE_SHEET, LAPTOP_DATABASE_RANGE, UKSP_ICON_SHEET, UKSP_ICON_RANGE,
  parseLaptopDb, laptopDatabaseCollection, bannerSpecsCollection, bannerLaptopsCollection, specsRowsFromLaptopDb,
  makeLaptopDatabase, ukspIcons, panelSizeOf
};
