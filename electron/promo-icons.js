// Promo pictures (server side), from the PROMO IMAGES tab of the main spreadsheet (an IMPORTRANGE of PROMO
// MONITORING - FOR BANNERS → PROMO ICONS): "Promos" (the promo title and its freebies, joined with " + ") and
// "Icon Link". Columns are found by those headers. The Banner page picks each laptop's promo picture here first
// (see banner-data.js), matching the price matrix's TOTAL PROMO (title + freebies) while ignoring spacing, "+" and
// punctuation; DB PHOTOS is used for a promo not found here. While the tab is still loading nothing is taken, so the
// last synced pictures stay.

const PROMO_IMAGES_SHEET = 'PROMO IMAGES';
const PROMO_IMAGES_RANGE = 'A:Z';
const HEADER_ROWS = 6;

function text(value) {
  const result = value === null || value === undefined ? '' : String(value).trim();
  return result.startsWith('#') ? '' : result;
}

// "MIX & MATCH PROMO + 1-Year …" and "MIX & MATCH PROMO1-Year …" (TOTAL PROMO) give the same key.
const promoKey = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Sheet values → collection promo_icons (name, link). Throws while the tab is still loading or has no promos.
function promoIconsCollection(values = []) {
  let nameColumn = -1;
  let linkColumn = -1;
  let headerRow = -1;
  values.slice(0, HEADER_ROWS).forEach((row, index) => {
    (row || []).forEach((cell, column) => {
      const key = promoKey(cell);
      if (key === 'PROMOS' && nameColumn === -1) nameColumn = column;
      if (key === 'ICONLINK' && linkColumn === -1) {
        linkColumn = column;
        headerRow = index;
      }
    });
  });
  if (/^(LOADING|#REF|#ERROR|#N\/A)/i.test(String((values[0] || [])[0] ?? '').trim())) throw new Error('PROMO IMAGES is still loading');
  if (nameColumn === -1 || linkColumn === -1) throw new Error('PROMO IMAGES: "Promos" or "Icon Link" header not found');
  const rows = values.slice(headerRow + 1).flatMap((row, index) => {
    const name = text((row || [])[nameColumn]).replace(/\s+/g, ' ');
    return name ? [{ id: `item_${String(headerRow + index + 2).padStart(4, '0')}`, data: { name, link: text(row[linkColumn]) } }] : [];
  });
  if (!rows.length) throw new Error('PROMO IMAGES has no promos');
  return { collection: 'promo_icons', columns: ['name', 'link'], rows };
}

module.exports = { PROMO_IMAGES_SHEET, PROMO_IMAGES_RANGE, promoIconsCollection, promoKey };
