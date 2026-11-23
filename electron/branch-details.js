// Branch details for the Flyers and Quotation pages (server side), from the LOGO sheet:
//   E: BRANCH, F: PIC (the branch's logo), G: store name, H: BRANCH (again, beside the address), I: ADDRESS.
// The logo and the address lists may be in different orders, so each is looked up by its own branch column.
// Quotation details, in columns after ADDRESS found by their headers (row 1), on the same row as the address:
//   TIN, MOBILE, BRANCH MANAGER, MANAGER NO., VIBER QR (picture link), FB QR (picture link), BANK DETAILS (the BDO
//   account number for checks and transfers) and ACCOUNT NAME (the company the account is under).

const BRANCH_DETAILS_RANGE = 'E1:Z';

// [field, header (capitals, letters and digits only) the column's header starts with]
const QUOTATION_FIELDS = [
  ['tin', 'TIN'],
  ['mobile', 'MOBILE'],
  ['manager', 'BRANCHMANAGER'],
  ['manager_no', 'MANAGERNO'],
  ['viber_qr', 'VIBER'],
  ['fb_qr', 'FB'],
  ['bank_account', 'BANKDETAILS'],
  ['account_name', 'ACCOUNTNAME']
];

// "004028021998" (or "4028025349", when the sheet dropped the leading zeros) → "004028021998": BDO account numbers
// have 12 digits. Anything that is not a number (#N/A, a note) is no account.
function accountNumber(value) {
  const digits = text(value).replace(/[\s-]/g, '');
  if (!/^\d{6,12}$/.test(digits)) return '';
  return digits.padStart(12, '0');
}
function accountName(value) {
  const name = text(value).replace(/\s+/g, ' ');
  return !name || name.startsWith('#') ? '' : name;
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

const headerKey = (value) => text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');

// =IMAGE("https://…") or =HYPERLINK("https://…") → the link; anything else as it is.
function imageLink(value) {
  const match = text(value).match(/^=(?:IMAGE|HYPERLINK)\s*\(\s*"([^"]+)"/i);
  return match ? match[1] : text(value);
}

// values: LOGO!E1:Z as shown; formulas: the same range as formulas (for =IMAGE pictures). Row 1 is the header row
// (an older range without it, starting at E2, still works: it then has no quotation columns).
function branchDetailsCollection(values = [], formulas = []) {
  const hasHeader = headerKey((values[0] || [])[0]) === 'BRANCH';
  const header = hasHeader ? values[0] : [];
  // Quotation columns: after ADDRESS (index 4), so "BRANCH" / "PIC" on the left are never taken for them.
  const columns = {};
  for (const [field, start] of QUOTATION_FIELDS) {
    const index = header.findIndex((cell, i) => i > 4 && headerKey(cell).startsWith(start) && !Object.values(columns).includes(i));
    if (index !== -1) columns[field] = index;
  }
  const body = hasHeader ? values.slice(1) : values;
  const bodyFormulas = hasHeader ? formulas.slice(1) : formulas;
  const rows = body.flatMap((row, index) => {
    const cellFormulas = bodyFormulas[index] || [];
    const data = {
      branch: text(row[0]),
      logo: imageLink(cellFormulas[1] || row[1]),
      store_name: text(row[2]),
      address_branch: text(row[3]),
      address: text(row[4])
    };
    for (const [field] of QUOTATION_FIELDS) {
      const i = columns[field];
      data[field] = i === undefined ? '' : /_qr$/.test(field) ? imageLink(cellFormulas[i] || row[i]) : text(row[i]);
    }
    return data.branch || data.address_branch ? [data] : [];
  });
  return {
    collection: 'branch_details',
    columns: ['branch', 'logo', 'store_name', 'address_branch', 'address', ...QUOTATION_FIELDS.map(([field]) => field)],
    rows: rows.map((data, index) => ({ id: `item_${String(index + 1).padStart(4, '0')}`, data }))
  };
}

// rows: the branch_details table; qrRows: the branch_qr table (Branch FB/QR tab, see branch-qr.js) →
// { BRANCH: { logo, storeName, address, tin, mobile, manager, managerNo, viberQr, fbQr, fbName, bankAccount, accountName } }, branch codes in
// capitals. Branch FB/QR comes first; the LOGO sheet's quotation columns fill what it leaves blank.
function makeBranchDetails(rows, imageUrl = (value) => value, qrRows = []) {
  const details = {};
  const entry = (branch) => {
    const key = text(branch).toUpperCase();
    if (!key) return null;
    if (!details[key]) details[key] = { logo: '', storeName: '', address: '', tin: '', mobile: '', manager: '', managerNo: '', viberQr: '', fbQr: '', fbName: '', bankAccount: '', accountName: '' };
    return details[key];
  };
  for (const row of qrRows || []) {
    const byQr = entry(row.branch);
    if (!byQr) continue;
    if (row.tin) byQr.tin = text(row.tin);
    if (row.manager) byQr.manager = text(row.manager);
    if (row.manager_no) byQr.managerNo = text(row.manager_no);
    if (row.viber_qr) byQr.viberQr = imageUrl(text(row.viber_qr));
    if (row.fb_qr) byQr.fbQr = imageUrl(text(row.fb_qr));
    if (row.fb_name) byQr.fbName = text(row.fb_name);
  }
  for (const row of rows || []) {
    const byLogo = entry(row.branch);
    if (byLogo && !byLogo.logo && row.logo) byLogo.logo = imageUrl(text(row.logo));
    if (byLogo && !byLogo.storeName && row.store_name) byLogo.storeName = text(row.store_name);
    const byAddress = entry(row.address_branch);
    if (byAddress && !byAddress.address && row.address) byAddress.address = text(row.address);
    // The quotation details sit on the address row.
    if (byAddress) {
      if (!byAddress.tin && row.tin) byAddress.tin = text(row.tin);
      if (!byAddress.mobile && row.mobile) byAddress.mobile = text(row.mobile);
      if (!byAddress.manager && row.manager) byAddress.manager = text(row.manager);
      if (!byAddress.managerNo && row.manager_no) byAddress.managerNo = text(row.manager_no);
      if (!byAddress.viberQr && row.viber_qr) byAddress.viberQr = imageUrl(text(row.viber_qr));
      if (!byAddress.fbQr && row.fb_qr) byAddress.fbQr = imageUrl(text(row.fb_qr));
      if (!byAddress.bankAccount && accountNumber(row.bank_account)) byAddress.bankAccount = accountNumber(row.bank_account);
      if (!byAddress.accountName && accountName(row.account_name)) byAddress.accountName = accountName(row.account_name);
    }
  }
  return details;
}

module.exports = { BRANCH_DETAILS_RANGE, branchDetailsCollection, makeBranchDetails };
