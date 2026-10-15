// Banner page data (server side): reads the LAPTOP RAW, BANNER SPECS, DB PHOTOS and BANNER PRICES sheets,
// keeps only what a banner shows, and builds one entry per laptop for SalesKit.
// BANNER PRICES also holds profit and margin columns; only the item code, promo and the two selling prices
// are kept, so they never reach the database viewer or the laptops.

const BANNER_SHEETS = {
  banner_laptops: 'LAPTOP RAW',
  banner_specs: 'BANNER SPECS',
  banner_photos: 'DB PHOTOS',
  banner_prices: 'BANNER PRICES'
};

// Shown under the banner, in this order: [title, BANNER PRICES column, is a price].
const PRICE_DETAILS = [
  ['CWB', 'CG', true],
  ['3WB', 'CH', true],
  ['HCB', 'CI', true],
  ['CF', 'CO', false],
  ['B1', 'CP', false],
  ['B2', 'CQ', false],
  ['CNB', 'CK', true],
  ['3NB', 'CL', true],
  ['HCNB', 'CM', true]
];

// 'A' → 0, 'CG' → 84.
function columnIndex(letters) {
  return [...letters].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function detailColumn(title) {
  return `detail_${title.toLowerCase()}`;
}

const SPEC_GUIDES = ['PROCESSOR', 'STORAGE', 'GRAPHICS', 'RESOLUTION', 'MEMORY', 'OS'];

// BANNER PRICES: headers are on row 3, items start on row 4. Columns are found by their row-3 header,
// with the sheet's current positions (CE, CG, CS) as a fallback.
const PRICE_HEADER_ROW = 2;
const PRICE_COLUMNS = {
  twelveMonths: { header: '12 MONTHS', fallback: 82 },
  cash: { header: 'CASH', fallback: 84 }, // first "cash" column: the "with bundle" set
  promo: { header: 'PROMO', fallback: 96 }
};

function text(value) {
  const result = value === null || value === undefined ? '' : String(value).trim();
  return result.startsWith('#N/A') || result.startsWith('#REF!') || result === 'undefined' || result === 'null' ? '' : result;
}

// Item codes and picture names are matched without regard to case, spacing or line breaks.
function matchKey(value) {
  return text(value).normalize('NFKC').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function header(value) {
  return text(value).replace(/\s+/g, ' ').toUpperCase();
}

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[₱,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function collection(name, columns, rows) {
  return {
    collection: name,
    columns,
    rows: rows.map((data, index) => ({ id: `item_${String(index + 1).padStart(4, '0')}`, data }))
  };
}

function laptopsCollection(values) {
  const headers = (values[0] || []).map(header);
  const at = (row, name) => text(row[headers.indexOf(name)]);
  const rows = values.slice(1).flatMap((row) => {
    const itemCode = at(row, 'ITEMCODE').replace(/\s+/g, ' ');
    if (!itemCode || !(at(row, 'BRAND') || at(row, 'MODEL') || at(row, 'PART NUMBER'))) return [];
    return [{
      item_code: itemCode,
      brand: at(row, 'BRAND'),
      brand_pic: at(row, 'BRAND PIC'),
      model: at(row, 'MODEL'),
      part_number: at(row, 'PART NUMBER'),
      brand_model: at(row, 'BRAND AND MODEL'),
      ...Object.fromEntries([1, 2, 3, 4].flatMap((n) => [
        [`uksp${n}`, at(row, `UKSP ${n} NAME`)],
        [`uksp${n}_pic`, at(row, `UKSP ${n} PIC`)]
      ]))
    }];
  });
  return collection('banner_laptops', ['item_code', 'brand', 'brand_pic', 'model', 'part_number', 'brand_model',
    'uksp1', 'uksp1_pic', 'uksp2', 'uksp2_pic', 'uksp3', 'uksp3_pic', 'uksp4', 'uksp4_pic'], rows);
}

function specsCollection(values) {
  const headers = (values[0] || []).map(header);
  const itemIndex = headers.indexOf('ITEM CODE');
  const guideIndex = headers.indexOf('GUIDE:');
  const valueIndex = headers.indexOf('SPECS:');
  const rows = values.slice(1).flatMap((row) => {
    const itemCode = text(row[itemIndex]).replace(/\s+/g, ' ');
    const guide = text(row[guideIndex]).replace(/:$/, '').toUpperCase();
    const value = text(row[valueIndex]);
    return itemCode && guide && value ? [{ item_code: itemCode, guide, value }] : [];
  });
  return collection('banner_specs', ['item_code', 'guide', 'value'], rows);
}

// DB PHOTOS has three name/picture pairs side by side: spec pictures (SPECS → PH IMG), brand logos
// (BRAND → PH IMG 2) and promo pictures (PROMO → PROMO IMG), plus a single/double layout marker.
function photosCollection(values) {
  const headers = (values[0] || []).map(header);
  const body = values.slice(1);
  const pairs = [
    ['spec', headers.indexOf('SPECS'), headers.indexOf('PH IMG')],
    ['brand', headers.indexOf('BRAND'), headers.indexOf('PH IMG 2')],
    ['promo', headers.indexOf('PROMO'), headers.indexOf('PROMO IMG')]
  ];
  const triggerIndex = Array.from({ length: Math.max(0, ...body.map((row) => row.length)) }, (_, index) => index)
    .find((index) => body.some((row) => /^(single|double)$/i.test(text(row[index])))
      && body.every((row) => !text(row[index]) || /^(single|double)$/i.test(text(row[index])))) ?? -1;
  const seen = new Set();
  const rows = [];
  for (const row of body) {
    for (const [kind, nameIndex, linkIndex] of pairs) {
      if (nameIndex < 0) continue;
      const name = text(row[nameIndex]);
      const key = `${kind}|${matchKey(name)}`;
      if (!name || seen.has(key)) continue;
      seen.add(key);
      rows.push({
        kind,
        name,
        link: linkIndex >= 0 ? text(row[linkIndex]) : '',
        trigger: kind === 'promo' && triggerIndex >= 0 ? text(row[triggerIndex]).toLowerCase() : ''
      });
    }
  }
  return collection('banner_photos', ['kind', 'name', 'link', 'trigger'], rows);
}

function pricesCollection(values) {
  const headers = (values[PRICE_HEADER_ROW] || []).map(header);
  const column = ({ header: name, fallback }) => {
    const index = headers.indexOf(name);
    return index >= 0 ? index : fallback;
  };
  const twelveIndex = column(PRICE_COLUMNS.twelveMonths);
  const cashIndex = column(PRICE_COLUMNS.cash);
  const promoIndex = column(PRICE_COLUMNS.promo);
  const seen = new Set();
  const rows = [];
  for (const row of values.slice(PRICE_HEADER_ROW + 1)) {
    const itemCode = text(row[0]).replace(/\s+/g, ' ');
    const cash = number(row[cashIndex]);
    const twelveMonths = number(row[twelveIndex]);
    // A laptop can appear under several promo sections; the first row with a price is used.
    if (!itemCode || (cash === null && twelveMonths === null) || seen.has(matchKey(itemCode))) continue;
    seen.add(matchKey(itemCode));
    rows.push({
      item_code: itemCode,
      promo_title: text(row[1]).replace(/\s+/g, ' '),
      promo: text(row[promoIndex]),
      cash: cash === null ? '' : String(cash),
      twelve_months: twelveMonths === null ? '' : String(twelveMonths),
      ...Object.fromEntries(PRICE_DETAILS.map(([title, letters]) => [detailColumn(title), text(row[columnIndex(letters)])]))
    });
  }
  return collection('banner_prices', ['item_code', 'promo_title', 'promo', 'cash', 'twelve_months',
    ...PRICE_DETAILS.map(([title]) => detailColumn(title))], rows);
}

const NORMALIZERS = {
  banner_laptops: laptopsCollection,
  banner_specs: specsCollection,
  banner_photos: photosCollection,
  banner_prices: pricesCollection
};

// valuesBySheet: { 'LAPTOP RAW': [[...]], ... } → collections for database.replaceSheetsData.
function normalizeBannerSheets(valuesBySheet) {
  const result = {};
  for (const [name, sheetName] of Object.entries(BANNER_SHEETS)) {
    if (valuesBySheet[sheetName]) result[name] = NORMALIZERS[name](valuesBySheet[sheetName]);
  }
  return result;
}

// rows: { laptops, specs, photos, prices } from the banner tables. imageUrl turns a Drive link into an image address.
function buildBannerData(rows, imageUrl = (value) => value) {
  const photos = new Map();
  for (const photo of rows.photos || []) {
    const key = `${photo.kind}|${matchKey(photo.name)}`;
    if (!photos.has(key)) photos.set(key, photo);
  }
  const photo = (kind, name) => (name ? photos.get(`${kind}|${matchKey(name)}`) : null) || null;
  const picture = (link, kind, name) => imageUrl(text(link) || (photo(kind, name) || {}).link || '') || '';

  const specsByItem = new Map();
  for (const spec of rows.specs || []) {
    const key = matchKey(spec.item_code);
    if (!specsByItem.has(key)) specsByItem.set(key, {});
    const specs = specsByItem.get(key);
    if (SPEC_GUIDES.includes(spec.guide) && !specs[spec.guide]) specs[spec.guide] = spec.value;
  }
  const pricesByItem = new Map((rows.prices || []).map((price) => [matchKey(price.item_code), price]));

  const seen = new Set();
  const items = [];
  for (const laptop of rows.laptops || []) {
    const key = matchKey(laptop.item_code);
    if (seen.has(key)) continue;
    seen.add(key);
    const price = pricesByItem.get(key);
    // Promo picture: by PROMO TITLE first, then by the promo column (CS) when the title has no picture.
    let promo = null;
    if (price) {
      const candidates = [price.promo_title, price.promo].filter((name) => name && matchKey(name) !== 'no promo');
      const match = candidates.map((name) => photo('promo', name)).find((row) => row && row.link);
      if (match) promo = { name: match.name, picture: imageUrl(match.link), trigger: match.trigger || '' };
      else if (candidates.length) promo = { name: candidates[0], picture: '', trigger: '' };
    }
    items.push({
      itemCode: laptop.item_code,
      brand: laptop.brand,
      brandModel: laptop.brand_model || [laptop.brand, laptop.model].filter(Boolean).join(' '),
      partNumber: laptop.part_number,
      brandPicture: picture(laptop.brand_pic, 'brand', laptop.brand),
      specs: specsByItem.get(key) || {},
      cash: price ? number(price.cash) : null,
      twelveMonths: price ? number(price.twelve_months) : null,
      hasPrice: Boolean(price),
      // { title, value, isPrice } for the strip under the banner.
      priceDetails: PRICE_DETAILS.map(([title, , isPrice]) => {
        const raw = price ? text(price[detailColumn(title)]) : '';
        return { title, value: isPrice ? number(raw) : raw, isPrice };
      }),
      promo,
      features: [1, 2, 3, 4]
        .map((n) => ({ name: text(laptop[`uksp${n}`]), picture: picture(laptop[`uksp${n}_pic`], 'spec', laptop[`uksp${n}`]) }))
        .filter((feature) => feature.name)
    });
  }
  items.sort((a, b) => a.itemCode.localeCompare(b.itemCode));
  return { items };
}

module.exports = { BANNER_SHEETS, normalizeBannerSheets, buildBannerData, matchKey };
