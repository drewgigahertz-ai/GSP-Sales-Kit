// Branch details for the Quotation page (server side), from the "Branch FB/QR" tab of the main spreadsheet. Columns are
// found by their headers (row 1), so moved or added columns do not matter:
//   BRANCHES (branch code) · FB LINKS (the FB page's name) · FB QR LINK · VIBER QR LINK · TIN NUMBER · MANAGER ·
//   MANAGER NUMBER
// Rows with a blank branch are skipped. On the quotation these come before the LOGO sheet's quotation columns.

const BRANCH_QR_SHEET = 'BRANCH FB/QR';
const BRANCH_QR_RANGE = 'A:Z';

function text(value) {
  const result = value === null || value === undefined ? '' : String(value).trim();
  return result.startsWith('#') ? '' : result;
}
const headerKey = (value) => text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');

// [field, test on the header key]; the first column that passes is used.
const FIELDS = [
  ['branch', (h) => h === 'BRANCHES' || h === 'BRANCH' || h === 'BRANCHCODE'],
  ['fb_name', (h) => h === 'FBLINKS' || h === 'FBLINK' || h === 'FBPAGE'],
  ['fb_qr', (h) => h === 'FBQRLINK'],
  ['viber_qr', (h) => h === 'VIBERQRLINK'],
  ['tin', (h) => h.startsWith('TIN')],
  ['manager', (h) => h === 'MANAGER' || h === 'BRANCHMANAGER'],
  ['manager_no', (h) => h.startsWith('MANAGERNUMBER') || h.startsWith('MANAGERNO') || h === 'MANAGERCONTACT']
];

// Sheet values (header in row 1) → collection branch_qr. Throws when the BRANCHES header is not there.
function branchQrCollection(values = []) {
  const header = values[0] || [];
  const columns = {};
  for (const [field, test] of FIELDS) {
    const index = header.findIndex((cell, i) => test(headerKey(cell)) && !Object.values(columns).includes(i));
    if (index !== -1) columns[field] = index;
  }
  if (columns.branch === undefined) throw new Error('Branch FB/QR: the BRANCHES header was not found');
  const seen = new Set();
  const rows = values.slice(1).flatMap((row) => {
    const branch = text((row || [])[columns.branch]).toUpperCase();
    if (!branch || seen.has(branch)) return [];
    seen.add(branch);
    const data = { branch };
    for (const [field] of FIELDS.slice(1)) data[field] = columns[field] === undefined ? '' : text(row[columns[field]]);
    // "TIN 213-671-080-00013" → "213-671-080-00013" (the quotation adds "TIN:" itself).
    data.tin = data.tin.replace(/^TIN(?:\s*(?:NO\.?|NUMBER))?\s*[:#.-]?\s*(?=\d)/i, '');
    // A QR "link" that is not a web address (a file name, a note) is not a picture.
    for (const field of ['fb_qr', 'viber_qr']) if (!/^https?:\/\//i.test(data[field])) data[field] = '';
    return [data];
  });
  return {
    collection: 'branch_qr',
    columns: FIELDS.map(([field]) => field),
    rows: rows.map((data, index) => ({ id: `item_${String(index + 1).padStart(4, '0')}`, data }))
  };
}

module.exports = { BRANCH_QR_SHEET, BRANCH_QR_RANGE, branchQrCollection };
