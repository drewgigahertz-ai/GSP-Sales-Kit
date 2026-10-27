// Branch details for the Flyers page (server side), from the LOGO sheet:
//   E: BRANCH, F: PIC (the branch's logo), G: store name, H: BRANCH (again, beside the address), I: ADDRESS.
// The logo and the address lists may be in different orders, so each is looked up by its own branch column.

const BRANCH_DETAILS_RANGE = 'E2:I';

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

// =IMAGE("https://…") or =HYPERLINK("https://…") → the link; anything else as it is.
function imageLink(value) {
  const match = text(value).match(/^=(?:IMAGE|HYPERLINK)\s*\(\s*"([^"]+)"/i);
  return match ? match[1] : text(value);
}

// values: LOGO!E2:I as shown; formulas: the same range as formulas (for =IMAGE pictures in F).
function branchDetailsCollection(values = [], formulas = []) {
  const rows = values.flatMap((row, index) => {
    const data = {
      branch: text(row[0]),
      logo: imageLink((formulas[index] || [])[1] || row[1]),
      store_name: text(row[2]),
      address_branch: text(row[3]),
      address: text(row[4])
    };
    return data.branch || data.address_branch ? [data] : [];
  });
  return {
    collection: 'branch_details',
    columns: ['branch', 'logo', 'store_name', 'address_branch', 'address'],
    rows: rows.map((data, index) => ({ id: `item_${String(index + 1).padStart(4, '0')}`, data }))
  };
}

// rows: the branch_details table → { BRANCH: { logo, storeName, address } }, branch codes in capitals.
function makeBranchDetails(rows, imageUrl = (value) => value) {
  const details = {};
  const entry = (branch) => {
    const key = text(branch).toUpperCase();
    if (!key) return null;
    if (!details[key]) details[key] = { logo: '', storeName: '', address: '' };
    return details[key];
  };
  for (const row of rows || []) {
    const byLogo = entry(row.branch);
    if (byLogo && !byLogo.logo && row.logo) byLogo.logo = imageUrl(text(row.logo));
    if (byLogo && !byLogo.storeName && row.store_name) byLogo.storeName = text(row.store_name);
    const byAddress = entry(row.address_branch);
    if (byAddress && !byAddress.address && row.address) byAddress.address = text(row.address);
  }
  return details;
}

module.exports = { BRANCH_DETAILS_RANGE, branchDetailsCollection, makeBranchDetails };
