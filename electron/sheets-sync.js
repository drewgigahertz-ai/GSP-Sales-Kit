const SHEETS = [
  'SPECS',
  'Criteria Segment-Application',
  'DV TRANSPOSED',
  'UKSP TRANSPOSED',
  'UKSP Banner',
  'RECO TABLE'
];
const DEFAULT_SPREADSHEET_ID = '1qACk3I6yMwmIYauQFlcM3yryRcyIrx3bLYqmJZ2wVFE';

function collectionName(sheetName) {
  return sheetName.toLowerCase().trim().replace(/[\/\s]+/g, '_');
}

function normalizeSheetValues(sheetName, values = []) {
  if (!values.length) return { collection: collectionName(sheetName), columns: [], rows: [] };

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
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${quotedName}!A:ZZ`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    });
    result[collectionName(sheetName)] = normalizeSheetValues(sheetName, response.data.values || []);
    onProgress({ phase: 'sheets', completed: index + 1, total: SHEETS.length, sheet: sheetName });
  }

  return result;
}

module.exports = { DEFAULT_SPREADSHEET_ID, SHEETS, fetchSpreadsheetData, normalizeSheetValues };