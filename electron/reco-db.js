// Reco Table recommendations with alternatives (server side), from the DB sheet's J–P block:
//   J: TAG (EXCEED / MEET / BUDGET, or ALTERNATIVE EXCEED / MEET / BUDGET), K: ITEM DESCRIPTION, L: segment
//   (short), M: BRANCH, N: segment (target market), O: hierarchy (1–5), P: tag number (3 / 2 / 1).
// Read by range: row 1 has blank and repeated headers there (ITEM DESCRIPTION and BRANCH are also in A–F).

const RECO_DB_SHEET = 'DB';
const RECO_DB_RANGE = 'J2:P';

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

// Sheet values (J2:P) → collection for database.replaceSheetsData (table reco_db).
function recoDbCollection(values = []) {
  // Ids keep the sheet row (J2 is row 2), so the Data health tab can point to it.
  const rows = values.flatMap((row, index) => {
    const data = {
      tag: text(row[0]).toUpperCase(),
      item: text(row[1]),
      segment: text(row[2]),
      branch: text(row[3]).toUpperCase(),
      target_market: text(row[4]),
      hierarchy: text(row[5]),
      tag_number: text(row[6])
    };
    return data.tag && data.item && data.branch ? [{ id: `item_${String(index + 2).padStart(4, '0')}`, data }] : [];
  });
  return {
    collection: 'reco_db',
    columns: ['tag', 'item', 'segment', 'branch', 'target_market', 'hierarchy', 'tag_number'],
    rows
  };
}

module.exports = { RECO_DB_SHEET, RECO_DB_RANGE, recoDbCollection };
