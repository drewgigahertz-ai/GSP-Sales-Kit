// Feature banners (server side). The FEATURES BANNER sheet lists every banner once:
//   A: UKSP (feature), B: SHORT NAME, C: DRIVE BANNER (Google Drive link).
// UKSP BANNER cells name the banners for each laptop and feature by SHORT NAME, comma-separated when there
// are several (a cell may also still hold a Drive link directly).

const FEATURES_BANNER_SHEET = 'FEATURES BANNER';

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

// Short names are matched without regard to case, spacing or line breaks.
function nameKey(value) {
  return text(value).normalize('NFKC').replace(/ /g, ' ').replace(/\s+/g, ' ').toLowerCase();
}

// Sheet values → collection for database.replaceSheetsData (table features_banner).
function featuresBannerCollection(values = []) {
  const headers = (values[0] || []).map((value) => text(value).toUpperCase());
  const at = (row, name, fallback) => {
    const index = headers.indexOf(name);
    return text(row[index >= 0 ? index : fallback]);
  };
  const rows = values.slice(1).flatMap((row) => {
    const shortName = at(row, 'SHORT NAME', 1);
    return shortName ? [{ uksp: at(row, 'UKSP', 0), short_name: shortName, banner: at(row, 'DRIVE BANNER', 2) }] : [];
  });
  return {
    collection: 'features_banner',
    columns: ['uksp', 'short_name', 'banner'],
    rows: rows.map((data, index) => ({ id: `item_${String(index + 1).padStart(4, '0')}`, data }))
  };
}

// rows: the features_banner table. Returns resolve(cell) → [{ name, url }] in the cell's order.
function createFeatureBannerResolver(rows, imageUrl = (value) => value) {
  const byName = new Map();
  for (const row of rows || []) {
    const key = nameKey(row.short_name);
    if (key && row.banner && !byName.has(key)) byName.set(key, { name: text(row.short_name), url: imageUrl(text(row.banner)) });
  }
  return (cell) => text(cell).split(',').map((part) => part.trim()).filter(Boolean).flatMap((part) => {
    if (/^https?:\/\//i.test(part)) return [{ name: '', url: imageUrl(part) }];
    const banner = byName.get(nameKey(part));
    return banner && banner.url ? [banner] : [];
  });
}

module.exports = { FEATURES_BANNER_SHEET, featuresBannerCollection, createFeatureBannerResolver };
