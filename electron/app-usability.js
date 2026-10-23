// Who each application is for (server side). The USABILITY sheet lists:
//   A: Apps, B: Usability (who uses it), C: Description (what it is).
// Applications are matched by name, without regard to case or spacing; shown under the app name on Sales Kit.

const USABILITY_SHEET = 'USABILITY';

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function nameKey(value) {
  return text(value).replace(/\s+/g, ' ').toLowerCase();
}

// Sheet values → collection for database.replaceSheetsData (table usability).
function usabilityCollection(values = []) {
  const rows = values.slice(1).flatMap((row) => {
    const app = text(row[0]);
    return app ? [{ app, usability: text(row[1]), description: text(row[2]) }] : [];
  });
  return {
    collection: 'usability',
    columns: ['app', 'usability', 'description'],
    rows: rows.map((data, index) => ({ id: `item_${String(index + 1).padStart(4, '0')}`, data }))
  };
}

// rows: the usability table. Returns usabilityOf(appName) → { usability, description } or null.
function createUsabilityLookup(rows) {
  const byName = new Map();
  for (const row of rows || []) {
    const key = nameKey(row.app);
    if (key && !byName.has(key)) byName.set(key, { usability: text(row.usability), description: text(row.description) });
  }
  return (name) => byName.get(nameKey(name)) || null;
}

module.exports = { USABILITY_SHEET, usabilityCollection, createUsabilityLookup };
