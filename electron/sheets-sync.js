const SHEETS = [
  'SPECS',
  'Criteria Segment-Application',
  'DV TRANSPOSED',
  'APPLICATION DESCRIPTION',
  'UKSP TRANSPOSED',
  'UKSP Banner',
  'RECO TABLE',
  'LOGO'
];
// Sheets whose first header cell is left blank in the spreadsheet.
const FIRST_COLUMN_HEADERS = {
  'APPLICATION DESCRIPTION': 'SKU'
};
const DEFAULT_SPREADSHEET_ID = '1qACk3I6yMwmIYauQFlcM3yryRcyIrx3bLYqmJZ2wVFE';
const { BANNER_SHEETS, normalizeBannerSheets } = require('./banner-data');

function collectionName(sheetName) {
  return sheetName.toLowerCase().trim().replace(/[\/\s]+/g, '_');
}

function normalizeSheetValues(sheetName, values = []) {
  if (!values.length) return { collection: collectionName(sheetName), columns: [], rows: [] };
  const firstColumnHeader = FIRST_COLUMN_HEADERS[sheetName];
  if (firstColumnHeader && !String(values[0][0] ?? '').trim()) {
    values = [[firstColumnHeader, ...values[0].slice(1)], ...values.slice(1)];
  }

  const columns = [...new Set(values[0].map((value) => String(value ?? '').trim()).filter(Boolean))];
  const headerIndexes = columns.map((column) => values[0].findIndex((value) => String(value ?? '').trim() === column));
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

async function fetchSpreadsheetData({ credentialsPath, spreadsheetId = DEFAULT_SPREADSHEET_ID }, onProgress = () => {}) {
  if (!credentialsPath) throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS to a Sheets API service-account JSON file.');
  if (!spreadsheetId) throw new Error('Set SALESKIT_SPREADSHEET_ID to the source spreadsheet ID.');

  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const result = {};

  for (let index = 0; index < SHEETS.length; index++) {
    const sheetName = SHEETS[index];
    const quotedName = `'${sheetName.replace(/'/g, "''")}'`;
    if (sheetName === 'LOGO') {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${quotedName}!A2:B2`,
        valueRenderOption: 'FORMULA',
        dateTimeRenderOption: 'FORMATTED_STRING'
      });
      const [applicationLogo = '', headerLogo = ''] = response.data.values?.[0] || [];
      const resolveImageFormula = (value) => {
        const formula = String(value || '').trim();
        const match = formula.match(/^=(?:IMAGE|HYPERLINK)\s*\(\s*"([^"]+)"/i);
        return match ? match[1] : formula;
      };
      result[collectionName(sheetName)] = {
        collection: collectionName(sheetName),
        columns: ['application_logo', 'header_logo'],
        rows: [{
          id: 'logo',
          data: {
            application_logo: resolveImageFormula(applicationLogo),
            header_logo: resolveImageFormula(headerLogo)
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
  const bannerValues = {};
  for (const sheetName of Object.values(BANNER_SHEETS)) {
    const title = titles.find((name) => name.trim().toUpperCase() === sheetName);
    if (!title) continue;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${title.replace(/'/g, "''")}'!A:CZ`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    });
    bannerValues[sheetName] = response.data.values || [];
    onProgress({ phase: 'sheets', completed: SHEETS.length, total: SHEETS.length, sheet: sheetName });
  }
  Object.assign(result, normalizeBannerSheets(bannerValues));

  return result;
}

module.exports = { DEFAULT_SPREADSHEET_ID, SHEETS, fetchSpreadsheetData, normalizeSheetValues };