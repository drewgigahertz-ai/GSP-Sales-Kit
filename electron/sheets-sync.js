const SHEETS = [
  'SPECS',
  'Criteria Segment-Application',
  'DV TRANSPOSED',
  'UKSP TRANSPOSED',
  'UKSP Banner',
  'RECO TABLE',
  'LOGO'
];
// Sheets whose repeated headers are separate columns (see normalizeSheetValues).
const KEEP_REPEATED_HEADERS = new Set(['SPECS']);
// Sheets whose first header cell is left blank in the spreadsheet.
const FIRST_COLUMN_HEADERS = {};
const DEFAULT_SPREADSHEET_ID = '1qACk3I6yMwmIYauQFlcM3yryRcyIrx3bLYqmJZ2wVFE';
// NEW PRICING lives in its own spreadsheet ("GST PRICING"), which is much faster to read than the main one.
const DEFAULT_PRICING_SPREADSHEET_ID = '1lUYiVdyuYMBZ0t3m0tkwxb35-2yyojI9Azu6CKJtuw0';
// A Google request that takes longer fails (the sync is then retried on schedule) instead of waiting forever,
// which happens while a slow spreadsheet is still recalculating its formulas.
const REQUEST_TIMEOUT_MS = 3 * 60 * 1000;
const { BANNER_SHEETS, normalizeBannerSheets } = require('./banner-data');
const { FEATURES_BANNER_SHEET, featuresBannerCollection } = require('./feature-banners');
const { AGEING_BANNER_SHEET, ageingBannerCollection } = require('./ageing-banners');
const { USABILITY_SHEET, usabilityCollection } = require('./app-usability');

function collectionName(sheetName) {
  return sheetName.toLowerCase().trim().replace(/[\/\s]+/g, '_');
}

function normalizeSheetValues(sheetName, values = []) {
  if (!values.length) return { collection: collectionName(sheetName), columns: [], rows: [] };
  const firstColumnHeader = FIRST_COLUMN_HEADERS[sheetName];
  if (firstColumnHeader && !String(values[0][0] ?? '').trim()) {
    values = [[firstColumnHeader, ...values[0].slice(1)], ...values.slice(1)];
  }

  // Database column names ignore case, so a header used twice would clash and fail the whole sync; the first
  // one is kept. In SPECS the same header again is real data (STORAGE, MEMORY and RESOLUTION are specs in
  // H-J and ranks in O-Q), so there it is kept as "STORAGE (2)", "STORAGE (3)", ...
  const firstSpelling = new Map();
  const repeats = new Map();
  const taken = new Set();
  const columns = [];
  const headerIndexes = [];
  values[0].forEach((value, index) => {
    const column = String(value ?? '').trim();
    if (!column) return;
    const key = column.toLowerCase();
    let name = column;
    if (firstSpelling.has(key)) {
      if (!KEEP_REPEATED_HEADERS.has(sheetName) || firstSpelling.get(key) !== column) return;
      const count = (repeats.get(key) || 1) + 1;
      repeats.set(key, count);
      name = `${column} (${count})`;
      if (taken.has(name.toLowerCase())) return;
    } else {
      firstSpelling.set(key, column);
    }
    taken.add(name.toLowerCase());
    columns.push(name);
    headerIndexes.push(index);
  });
  const rows = values.slice(1).flatMap((cells, index) => {
    const data = Object.fromEntries(columns.map((column, columnIndex) => [
      column,
      cells[headerIndexes[columnIndex]] ?? ''
    ]));
    if (!Object.values(data).some((value) => value !== '' && value !== null)) return [];

    return [{
      id: `item_${String(index + 2).padStart(4, '0')}`,
      data
    }];
  });

  return { collection: collectionName(sheetName), columns, rows };
}

// pricingSpreadsheetId (optional): where the NEW PRICING tab is read from; the main spreadsheet is used when it
// is empty or has no such tab.
async function fetchSpreadsheetData({ credentialsPath, spreadsheetId = DEFAULT_SPREADSHEET_ID, pricingSpreadsheetId = '' }, onProgress = () => {}) {
  if (!credentialsPath) throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS to a Sheets API service-account JSON file.');
  if (!spreadsheetId) throw new Error('Set SALESKIT_SPREADSHEET_ID to the source spreadsheet ID.');

  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  const sheets = google.sheets({ version: 'v4', auth, timeout: REQUEST_TIMEOUT_MS });
  const result = {};

  for (let index = 0; index < SHEETS.length; index++) {
    const sheetName = SHEETS[index];
    const quotedName = `'${sheetName.replace(/'/g, "''")}'`;
    if (sheetName === 'LOGO') {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${quotedName}!A2:C2`,
        valueRenderOption: 'FORMULA',
        dateTimeRenderOption: 'FORMATTED_STRING'
      });
      // A2: application (window) logo, B2: header logo, C2: logo on the Banner page.
      const [applicationLogo = '', headerLogo = '', bannerLogo = ''] = response.data.values?.[0] || [];
      const resolveImageFormula = (value) => {
        const formula = String(value || '').trim();
        const match = formula.match(/^=(?:IMAGE|HYPERLINK)\s*\(\s*"([^"]+)"/i);
        return match ? match[1] : formula;
      };
      result[collectionName(sheetName)] = {
        collection: collectionName(sheetName),
        columns: ['application_logo', 'header_logo', 'banner_logo'],
        rows: [{
          id: 'logo',
          data: {
            application_logo: resolveImageFormula(applicationLogo),
            header_logo: resolveImageFormula(headerLogo),
            banner_logo: resolveImageFormula(bannerLogo)
          }
        }]
      };
      onProgress({ phase: 'sheets', completed: index + 1, total: SHEETS.length, sheet: sheetName });
      continue;
    }
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${quotedName}!A:ZZ`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    });
    result[collectionName(sheetName)] = normalizeSheetValues(sheetName, response.data.values || []);
    onProgress({ phase: 'sheets', completed: index + 1, total: SHEETS.length, sheet: sheetName });
  }

  // Banner page sheets. A missing tab is skipped (the Banner page then has no data) instead of failing the sync.
  const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(title))' });
  const titles = (metadata.data.sheets || []).map((sheet) => sheet.properties.title);
  let pricingTitles = [];
  if (pricingSpreadsheetId && pricingSpreadsheetId !== spreadsheetId) {
    try {
      const pricing = await sheets.spreadsheets.get({ spreadsheetId: pricingSpreadsheetId, fields: 'sheets(properties(title))' });
      pricingTitles = (pricing.data.sheets || []).map((sheet) => sheet.properties.title);
    } catch (error) {
      onProgress({ phase: 'warning', message: `Pricing spreadsheet could not be read (${error.message}); using the main spreadsheet.` });
    }
  }
  const bannerValues = {};
  for (const sheetName of Object.values(BANNER_SHEETS)) {
    const pricingTitle = sheetName === BANNER_SHEETS.banner_prices
      ? pricingTitles.find((name) => name.trim().toUpperCase() === sheetName)
      : null;
    const title = pricingTitle || titles.find((name) => name.trim().toUpperCase() === sheetName);
    if (!title) continue;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: pricingTitle ? pricingSpreadsheetId : spreadsheetId,
      range: `'${title.replace(/'/g, "''")}'!A:CZ`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    });
    bannerValues[sheetName] = response.data.values || [];
    onProgress({ phase: 'sheets', completed: SHEETS.length, total: SHEETS.length, sheet: sheetName });
  }
  Object.assign(result, normalizeBannerSheets(bannerValues));

  // Feature banners by short name (see feature-banners.js); skipped like the Banner sheets when missing.
  const featuresBannerTitle = titles.find((name) => name.trim().toUpperCase() === FEATURES_BANNER_SHEET);
  if (featuresBannerTitle) {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${featuresBannerTitle.replace(/'/g, "''")}'!A:C`,
      valueRenderOption: 'FORMATTED_VALUE'
    });
    result.features_banner = featuresBannerCollection(response.data.values || []);
  }

  // Ready-made ageing banners for the Banner page (see ageing-banners.js); skipped when the tab is missing.
  const ageingBannerTitle = titles.find((name) => name.trim().toUpperCase() === AGEING_BANNER_SHEET);
  if (ageingBannerTitle) {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${ageingBannerTitle.replace(/'/g, "''")}'!A:H`,
      valueRenderOption: 'FORMATTED_VALUE'
    });
    result.ageing_banner = ageingBannerCollection(response.data.values || []);
  }

  // Who each application is for (see app-usability.js); skipped when the tab is missing.
  const usabilityTitle = titles.find((name) => name.trim().toUpperCase() === USABILITY_SHEET);
  if (usabilityTitle) {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${usabilityTitle.replace(/'/g, "''")}'!A:C`,
      valueRenderOption: 'FORMATTED_VALUE'
    });
    result.usability = usabilityCollection(response.data.values || []);
  }

  return result;
}

// One sheet's values (A:Z), for the quick price check (see server/price-watch.js).
async function fetchSheetValues({ credentialsPath, spreadsheetId = DEFAULT_SPREADSHEET_ID }, sheetName) {
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({ keyFile: credentialsPath, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth, timeout: REQUEST_TIMEOUT_MS });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName.replace(/'/g, "''")}'!A:Z`,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  return response.data.values || [];
}

module.exports = { DEFAULT_SPREADSHEET_ID, DEFAULT_PRICING_SPREADSHEET_ID, SHEETS, fetchSpreadsheetData, fetchSheetValues, normalizeSheetValues };