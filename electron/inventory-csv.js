// Branch stock from the inventory CSV uploaded to the server PC (Z:): "Stock Status - YYYYMMDD.csv", one row per
// branch and item: Branch, Item Code, Item Description, Qty. The newest file (by the date in its name) is read on
// every sync and every hour, and replaces LAPTOP DB's branch stock columns (database.js). A demo unit
// ("LAP-… - DEMO" / "LAP-… - D") counts as a unit of its laptop. Units of 0 or less are left out.
const fs = require('node:fs');
const path = require('node:path');

const FILE_PATTERN = /^Stock Status\s*-\s*(\d{4})(\d{2})(\d{2})\.csv$/i;

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
// An item's key: capitals, single spaces, without a trailing "- DEMO" / "- D" (the demo unit of the same laptop).
const itemKey = (value) => clean(value).toUpperCase().replace(/\s*-\s*(DEMO|D)$/, '').trim();

// The newest "Stock Status - YYYYMMDD.csv" in folder or one folder down: { file, asOf: 'YYYY-MM-DD', modified }
// or null. Throws when the folder cannot be read (Z: not connected).
function findNewestCsv(folder) {
  const found = [];
  const look = (dir, depth) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isFile()) {
        const match = entry.name.match(FILE_PATTERN);
        if (match) found.push({ file: full, asOf: `${match[1]}-${match[2]}-${match[3]}` });
      } else if (entry.isDirectory() && depth > 0) {
        try { look(full, depth - 1); } catch { /* a folder we may not open */ }
      }
    }
  };
  look(folder, 1);
  if (!found.length) return null;
  found.sort((a, b) => b.asOf.localeCompare(a.asOf) || fileTime(b.file) - fileTime(a.file));
  return { ...found[0], modified: fileTime(found[0].file) };
}
function fileTime(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

// One CSV line → its cells ("a","b,c" quoted cells with "" for a quote).
function csvCells(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { cells.push(cell); cell = ''; } else cell += c;
  }
  cells.push(cell);
  return cells;
}

// The CSV's laptops ("LAP-…" items): Map(itemKey → { item, stock: { BRANCH: units } }), and every branch in the file.
function parseInventoryCsv(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) throw new Error('the inventory CSV is empty');
  const header = csvCells(lines[0]).map((cell) => clean(cell).toUpperCase().replace(/[^A-Z]/g, ''));
  const col = (name) => header.indexOf(name);
  const [branchAt, itemAt, qtyAt] = [col('BRANCH'), col('ITEMDESCRIPTION'), col('QTY')];
  if (branchAt < 0 || itemAt < 0 || qtyAt < 0) throw new Error('the inventory CSV has no Branch / Item Description / Qty columns');
  const laptops = new Map();
  const branches = new Set();
  for (const line of lines.slice(1)) {
    const cells = csvCells(line);
    const branch = clean(cells[branchAt]).toUpperCase();
    const item = clean(cells[itemAt]);
    if (!branch || !item) continue;
    branches.add(branch);
    if (!/^LAP\s*-/i.test(item)) continue;
    const units = Math.round(Number(String(cells[qtyAt]).replace(/[^\d.-]/g, '')) || 0);
    if (units <= 0) continue;
    const key = itemKey(item);
    if (!laptops.has(key)) laptops.set(key, { item: item.replace(/\s*-\s*(DEMO|D)$/i, ''), stock: {} });
    const stock = laptops.get(key).stock;
    stock[branch] = (stock[branch] || 0) + units;
  }
  return { laptops, branches: [...branches].sort() };
}

// The newest CSV in folder as the inventory_stock collection (one row per laptop, plus the file's date and name),
// with a summary for the server's log and dashboard.
function readInventoryCsv(folder) {
  if (!clean(folder)) throw new Error('no inventory folder is set');
  let newest;
  try {
    newest = findNewestCsv(folder);
  } catch (error) {
    const why = error.code === 'ENOENT' ? 'not found: is the drive connected?' : error.code === 'EACCES' || error.code === 'EPERM' ? 'no permission to open it' : error.code || error.message;
    throw new Error(`cannot open ${folder} (${why})`);
  }
  if (!newest) throw new Error(`no "Stock Status - YYYYMMDD.csv" in ${folder}`);
  const { laptops, branches } = parseInventoryCsv(fs.readFileSync(newest.file, 'utf8'));
  const name = path.basename(newest.file);
  const rows = [...laptops.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, laptop], index) => ({
    id: `item_${String(index + 1).padStart(5, '0')}`,
    data: { item_key: key, item: laptop.item, stock: JSON.stringify(laptop.stock), as_of: newest.asOf, file: name }
  }));
  return {
    collection: { collection: 'inventory_stock', columns: ['item_key', 'item', 'stock', 'as_of', 'file'], rows },
    summary: { file: name, asOf: newest.asOf, modified: newest.modified, laptops: rows.length, branches }
  };
}

// inventory_stock rows → Map(itemKey → { BRANCH: units }) and the file's date ('' when there are none).
function inventoryStock(rows = []) {
  const byItem = new Map();
  let asOf = '';
  for (const row of rows) {
    let stock = {};
    try { stock = JSON.parse(row.stock || '{}') || {}; } catch { /* a broken row has no stock */ }
    byItem.set(clean(row.item_key), stock);
    if (row.as_of && row.as_of > asOf) asOf = row.as_of;
  }
  return { byItem, asOf };
}

module.exports = { FILE_PATTERN, itemKey, findNewestCsv, parseInventoryCsv, readInventoryCsv, inventoryStock };
