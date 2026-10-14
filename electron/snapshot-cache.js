const fs = require('node:fs');
const path = require('node:path');

function isSalesKitSnapshot(data) {
  return Boolean(
    data &&
    typeof data === 'object' &&
    data.criteriaSegmentData &&
    Array.isArray(data.criteriaSegmentData.laptops) &&
    data.specsMap &&
    typeof data.specsMap === 'object'
  );
}

function createSnapshotCache(filePath) {
  const resolvedPath = path.resolve(filePath);

  return {
    exists() {
      return fs.existsSync(resolvedPath);
    },
    load() {
      try {
        const data = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
        return isSalesKitSnapshot(data) ? data : null;
      } catch {
        return null;
      }
    },
    save(data) {
      if (!isSalesKitSnapshot(data)) return false;

      try {
        fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
        const temporaryPath = `${resolvedPath}.tmp`;
        fs.writeFileSync(temporaryPath, JSON.stringify(data), 'utf8');
        fs.renameSync(temporaryPath, resolvedPath);
        return true;
      } catch {
        return false;
      }
    }
  };
}

module.exports = { createSnapshotCache, isSalesKitSnapshot };