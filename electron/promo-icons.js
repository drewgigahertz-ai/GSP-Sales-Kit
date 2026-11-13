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

const isLink = (value) => /^https?:\/\//i.test(String(value || '').trim());

// A cell from spreadsheets.get rowData → the web address it holds: the link behind a file chip (a Drive file
// inserted with @ or by pasting), a linked text, or the text itself when it is a link; '' otherwise.
function linkFromCell(cell = {}) {
  for (const run of cell.chipRuns || []) {
    const uri = run && run.chip && run.chip.richLinkProperties && run.chip.richLinkProperties.uri;
    if (isLink(uri)) return uri;
  }
  if (isLink(cell.hyperlink)) return cell.hyperlink;
  for (const run of cell.textFormatRuns || []) {
    const uri = run && run.format && run.format.link && run.format.link.uri;
    if (isLink(uri)) return uri;
  }
  return isLink(cell.formattedValue) ? String(cell.formattedValue).trim() : '';
}

// rowData of a tab with "Promos" and "Icon Link" headers → Map(promoKey(name) → link) of the rows with a link.
function linksByPromo(rowData = []) {
  const rows = rowData.map((row) => (row && row.values) || []);
  let nameColumn = -1;
  let linkColumn = -1;
  let headerRow = -1;
  rows.slice(0, HEADER_ROWS).forEach((cells, index) => cells.forEach((cell, column) => {
    const key = promoKey(cell && cell.formattedValue);
    if (key === 'PROMOS' && nameColumn === -1) nameColumn = column;
    if (key === 'ICONLINK' && linkColumn === -1) {
      linkColumn = column;
      headerRow = index;
    }
  }));
  const links = new Map();
  if (nameColumn === -1 || linkColumn === -1) return links;
  for (const cells of rows.slice(headerRow + 1)) {
    const key = promoKey(cells[nameColumn] && cells[nameColumn].formattedValue);
    const link = linkFromCell(cells[linkColumn]);
    if (key && link && !links.has(key)) links.set(key, link);
  }
  return links;
}

// =IMPORTRANGE("<spreadsheet link or id>", "<tab>!<range>") → { spreadsheetId, range }, or null.
function importRangeSource(formula) {
  const match = String(formula || '').match(/IMPORTRANGE\s*\(\s*"([^"]+)"\s*[,;]\s*"([^"]+)"\s*\)/i);
  if (!match) return null;
  const id = (match[1].match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/) || [])[1] || (/^[A-Za-z0-9_-]{20,}$/.test(match[1]) ? match[1] : '');
  const bang = match[2].lastIndexOf('!');
  if (!id || bang < 1) return null;
  const tab = match[2].slice(0, bang).replace(/^'|'$/g, '');
  const range = match[2].slice(bang + 1).toUpperCase();
  return { spreadsheetId: id, range: `'${tab.replace(/'/g, "''")}'!${range}` };
}

const ROW_FIELDS = 'sheets(data(rowData(values(formattedValue,hyperlink,chipRuns,textFormatRuns))))';

// Reads PROMO IMAGES into the promo_icons collection. A picture put in as a file chip shows only the file name
// ("11-11-26_MIX & MATCH PROMO.png"), and IMPORTRANGE copies just that name, so the link behind it is read from
// PROMO IMAGES itself and from the tab its IMPORTRANGE comes from (PROMO MONITORING → PROMO ICONS). An Icon Link
// that is still not a web address is left blank, so the Banner uses the promo's other pictures instead of a broken
// one. warn(message): names the promos left without a picture.
async function readPromoIcons(sheets, spreadsheetId, title, warn = () => {}) {
  const tab = `'${title.replace(/'/g, "''")}'`;
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!${PROMO_IMAGES_RANGE}`, valueRenderOption: 'FORMATTED_VALUE' });
  const collection = promoIconsCollection(response.data.values || []);
  const unresolved = () => collection.rows.filter((row) => row.data.link && !isLink(row.data.link));
  if (unresolved().length) {
    const found = new Map();
    const add = (links) => { for (const [key, link] of links) if (!found.has(key)) found.set(key, link); };
    try {
      const own = await sheets.spreadsheets.get({ spreadsheetId, ranges: [`${tab}!${PROMO_IMAGES_RANGE}`], fields: ROW_FIELDS });
      add(linksByPromo(own.data.sheets[0].data[0].rowData));
      const formula = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A1`, valueRenderOption: 'FORMULA' });
      const source = importRangeSource(((formula.data.values || [])[0] || [])[0]);
      if (source) {
        const imported = await sheets.spreadsheets.get({ spreadsheetId: source.spreadsheetId, ranges: [source.range], fields: ROW_FIELDS });
        add(linksByPromo(imported.data.sheets[0].data[0].rowData));
      }
    } catch (error) {
      warn(`PROMO IMAGES: could not read the links behind file names (${error.message})`);
    }
    const left = [];
    for (const row of unresolved()) {
      row.data.link = found.get(promoKey(row.data.name)) || '';
      if (!row.data.link) left.push(row.data.name);
    }
    if (left.length) warn(`PROMO IMAGES: ${left.length} promo${left.length > 1 ? 's have' : ' has'} a file name instead of a picture link (${left.slice(0, 3).join('; ')}${left.length > 3 ? '; …' : ''})`);
  }
  return collection;
}

module.exports = { PROMO_IMAGES_SHEET, PROMO_IMAGES_RANGE, promoIconsCollection, promoKey, readPromoIcons, linkFromCell, linksByPromo, importRangeSource };
