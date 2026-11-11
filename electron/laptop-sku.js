// Laptop SKU: which laptop (product) a branch laptop is, typed in once by branch staff (laptop-sku-prompt.js).
// It is the laptop's name on the SalesKit Server (Devices tab, App Tests page) and is compared there with the
// brand and model Windows reports (device-info.js).
// Used by the SalesKit app (the saved SKU and the list to pick from) and by the SalesKit Server (the comparison).
const fs = require('node:fs');
const { brandName } = require('./device-info');

const clean = (value, max = 40) => String(value ?? '').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
// SKUs compared without case or spaces ("82kb 00ab" = "82KB00AB").
const skuKey = (sku) => clean(sku, 60).toUpperCase().replace(/\s+/g, '');

// The SKU saved on this laptop: { sku, setAt, setBy } in <userData>/laptop-sku.json.
function createLaptopSkuStore(filePath) {
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { /* not set yet */ }
  return {
    get: () => (saved && saved.sku ? saved : null),
    set(sku, setBy = '') {
      const value = clean(sku, 60);
      if (!value) throw new Error('Enter the laptop SKU.');
      saved = { sku: value, setAt: new Date().toISOString(), setBy: clean(setBy, 60) };
      fs.writeFileSync(filePath, JSON.stringify(saved, null, 2));
      return saved;
    }
  };
}

// Every SKU in SalesKit's data with its brand and model: LAPTOP DB (item, brand, model, part number) and the
// Reco Table laptops (SKU, brand, title, model code). [{ sku, brand, model, partNumber }], by SKU.
function skuChoices(data) {
  const bySku = new Map();
  const add = (sku, brand, model, partNumber, segment = '') => {
    const key = skuKey(sku);
    if (!key) return;
    const entry = bySku.get(key) || { sku: clean(sku, 60), brand: '', model: '', partNumber: '', segment: '' };
    entry.brand = entry.brand || clean(brand, 40);
    entry.model = entry.model || clean(model, 80);
    entry.partNumber = entry.partNumber || clean(partNumber, 40);
    // LAPTOP DB's SEGMENT 2 (App Tests: which apps to check).
    entry.segment = entry.segment || clean(segment, 60);
    bySku.set(key, entry);
  };
  for (const laptop of (data && data.laptopDatabase) || []) add(laptop.item, laptop.brand, laptop.model, laptop.partNumber, laptop.segment2);
  const reco = data && data.criteriaSegmentData && data.criteriaSegmentData.laptops;
  for (const laptop of reco || []) add(laptop.cleanSku || laptop.sku, laptop.brand, laptop.title, laptop.modelCode);
  return [...bySku.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

// Words that say nothing about which model it is.
const FILLER = new Set(['laptop', 'notebook', 'pc', 'series', 'gen', 'the', 'with', 'and', 'inch', 'oled', 'touch']);
const words = (text) => String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !FILLER.has(w));
// Model numbers: words with a digit and at least 3 characters ("3511", "14alc05", "15-eg0xxx" → "eg0xxx").
const numbers = (list) => list.filter((w) => /\d/.test(w) && w.length >= 3);

// Does the laptop Windows reports look like the one the SKU is? found: the skuChoices entry, or null.
// { status, ... }: 'none' (no SKU typed), 'unknown' (SKU not in SalesKit's list), 'nodevice' (Windows said
// nothing), 'brand' (another brand), 'model' (same brand, model looks different), 'match'.
function compareSku(sku, found, device = {}) {
  if (!clean(sku, 60)) return { status: 'none' };
  if (!found) return { status: 'unknown' };
  const result = { brand: found.brand, model: found.model };
  const winBrand = brandName(clean(device.make)).toLowerCase();
  const winModel = clean(device.model, 80);
  if (!winBrand && !winModel) return { status: 'nodevice', ...result };
  const skuBrand = brandName(clean(found.brand)).toLowerCase();
  if (winBrand && skuBrand && winBrand !== skuBrand && !skuBrand.includes(winBrand) && !winBrand.includes(skuBrand)) {
    return { status: 'brand', ...result };
  }
  if (!winModel) return { status: 'match', ...result };
  // A model code from Windows ("82KB") is checked against the SKU and part number (Lenovo's start with it).
  if (!/\s/.test(winModel) && !/[a-z]/.test(winModel)) {
    const code = winModel.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const ids = [found.sku, found.partNumber].map((v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
    return { status: ids.some((id) => id && (id.startsWith(code) || id.includes(code))) ? 'match' : 'model', ...result };
  }
  const win = words(winModel);
  const skuWords = new Set(words(`${found.model} ${found.partNumber} ${found.sku}`));
  const winNumbers = numbers(win);
  // The model numbers must agree when Windows gives one ("Inspiron 15 3511" is not "Inspiron 15 3520");
  // otherwise one shared name word is enough ("MateBook D" and "MateBook D 14").
  const shared = winNumbers.length ? winNumbers.some((w) => [...skuWords].some((s) => s === w || s.includes(w) || w.includes(s) && s.length >= 4))
    : win.some((w) => skuWords.has(w));
  return { status: shared ? 'match' : 'model', ...result };
}

module.exports = { createLaptopSkuStore, skuChoices, compareSku, skuKey };
