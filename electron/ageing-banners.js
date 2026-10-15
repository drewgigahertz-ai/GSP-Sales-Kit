// Ageing banners (server side) for the Banner page. The AGEING BANNER sheet lists ready-made marketing
// banners: A = ITEM DESCRIPTION (item code), G = MARKETING REMARKS (LINKS) (Drive link),
// H = DATE AND TIME. When a laptop is listed more than once, the row with the latest date is used.

const AGEING_BANNER_SHEET = 'AGEING BANNER';

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

// "7/10/2026 11:07" (month/day/year, as the sheet shows it) → milliseconds; 0 when it cannot be read.
function parseDate(value) {
  const match = text(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return 0;
  const [, month, day, year, hour = '0', minute = '0', second = '0'] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)).getTime();
}

// Sheet values → collection for database.replaceSheetsData (table ageing_banner), one row per laptop.
function ageingBannerCollection(values = []) {
  const headers = (values[0] || []).map((value) => text(value).toUpperCase());
  const column = (name, fallback) => {
    const index = headers.indexOf(name);
    return index >= 0 ? index : fallback;
  };
  const itemIndex = column('ITEM DESCRIPTION', 0);
  const linkIndex = column('MARKETING REMARKS (LINKS)', 6);
  const dateIndex = column('DATE AND TIME', 7);
  const latest = new Map();
  values.slice(1).forEach((row) => {
    const itemCode = text(row[itemIndex]).replace(/\s+/g, ' ');
    const banner = text(row[linkIndex]);
    if (!itemCode || !/^https?:\/\//i.test(banner)) return;
    const key = itemCode.toLowerCase();
    const at = parseDate(row[dateIndex]);
    const current = latest.get(key);
    // Latest date wins; with equal (or unreadable) dates, the lower row wins.
    if (!current || at >= current.at) latest.set(key, { item_code: itemCode, banner, updated_at: text(row[dateIndex]), at });
  });
  const rows = [...latest.values()].map(({ item_code, banner, updated_at }) => ({ item_code, banner, updated_at }));
  return {
    collection: 'ageing_banner',
    columns: ['item_code', 'banner', 'updated_at'],
    rows: rows.map((data, index) => ({ id: `item_${String(index + 1).padStart(4, '0')}`, data }))
  };
}

module.exports = { AGEING_BANNER_SHEET, ageingBannerCollection, parseDate };
