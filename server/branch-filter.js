// Trims the SalesKit data to one branch before it is sent to a branch-locked user, so other branches'
// stock never reaches their laptop. Accounts with branch "ALL" or "HO" (head office) receive everything.
const ALL_BRANCHES = 'ALL';
const FULL_ACCESS_BRANCHES = [ALL_BRANCHES, 'HO'];

function sameBranch(a, b) {
  return String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
}

function hasFullAccess(branch) {
  return FULL_ACCESS_BRANCHES.some((code) => sameBranch(branch, code));
}

// The stock a laptop has at `branch` (location names are compared without regard to case).
function stockAt(stocksByLocation, branch) {
  const key = Object.keys(stocksByLocation || {}).find((name) => sameBranch(name, branch));
  return key ? Number(stocksByLocation[key]) || 0 : 0;
}

function filterDataForBranch(data, branch) {
  if (!branch || hasFullAccess(branch)) return data;
  const code = String(branch).trim().toUpperCase();

  const criteria = data.criteriaSegmentData || {};
  const laptops = (criteria.laptops || []).map((laptop) => {
    const stock = stockAt(laptop.stocksByLocation, code);
    return { ...laptop, stocksByLocation: { [code]: stock }, totalStock: stock };
  });

  // RECO TABLE: only this branch's rows, without head office (HO) or OA stock.
  const recoTableData = (data.recoTableData || [])
    .filter((row) => sameBranch(row.BR, code))
    .map((row) => ({ ...row, 'HO STOCK': '', 'OA STOCK': '' }));

  return {
    ...data,
    lockedBranch: code,
    locationsList: [code],
    criteriaSegmentData: { ...criteria, laptops, locations: [code] },
    recoTableData
  };
}

module.exports = { ALL_BRANCHES, hasFullAccess, filterDataForBranch };
