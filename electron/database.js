const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

let connection = null;
let activePath = null;
const { buildBannerData } = require('./banner-data');
const { createFeatureBannerResolver } = require('./feature-banners');

const SHEET_TABLES = new Set([
  'banner_laptops',
  'banner_specs',
  'banner_photos',
  'banner_prices',
  'features_banner',
  'ageing_banner',
  'specs',
  'criteria_segment_application',
  'dv_transposed',
  'uksp_transposed',
  'uksp_banner',
  'reco_table',
  'logo'
]);

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function getStatus() {
  return {
    connected: Boolean(connection),
    path: activePath,
    tableCount: connection ? listTables().length : 0
  };
}

function openDatabase(filePath, { create = false } = {}) {
  const resolvedPath = path.resolve(filePath);
  if (create) {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  } else {
    const fileInfo = fs.statSync(resolvedPath);
    if (!fileInfo.isFile()) throw new Error('Choose a SQLite database file.');
  }

  const nextConnection = new Database(resolvedPath, { fileMustExist: !create });
  nextConnection.pragma('busy_timeout = 5000');

  if (connection) connection.close();
  connection = nextConnection;
  activePath = resolvedPath;
  return getStatus();
}

function listTables() {
  if (!connection) return [];

  const tables = connection.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__saleskit_%' ORDER BY name"
  ).all();

  return tables.map(({ name }) => ({
    name,
    rowCount: connection.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`).get().count
  }));
}

function getTableData(tableName, options = {}) {
  if (!connection) throw new Error('Open a database before browsing tables.');

  const table = listTables().find(({ name }) => name === tableName);
  if (!table) throw new Error('That table is not available in the selected database.');

  const limit = Math.min(100, Math.max(1, Math.trunc(Number(options.limit) || 30)));
  const offset = Math.max(0, Math.trunc(Number(options.offset) || 0));
  const search = String(options.search || '').trim();
  const tableIdentifier = quoteIdentifier(table.name);
  const columns = connection.prepare(`PRAGMA table_info(${tableIdentifier})`).all().map(({ name }) => name);
  const searchClause = search && columns.length
    ? ` WHERE ${columns.map((column) => `CAST(${quoteIdentifier(column)} AS TEXT) LIKE ?`).join(' OR ')}`
    : '';
  const searchValues = search && columns.length
    ? columns.map(() => `%${search}%`)
    : [];
  const total = connection.prepare(`SELECT COUNT(*) AS count FROM ${tableIdentifier}${searchClause}`)
    .get(...searchValues).count;
  const rows = connection.prepare(
    `SELECT * FROM ${tableIdentifier}${searchClause} LIMIT ? OFFSET ?`
  ).all(...searchValues, limit, offset);

  return { table: table.name, columns, rows, total, limit, offset };
}

function getRows(tableName) {
  const table = listTables().find(({ name }) => name === tableName);
  if (!table) return [];

  const columns = connection.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all();
  const hasOrderIndex = columns.some(({ name }) => name === 'order_index');
  const order = hasOrderIndex ? ` ORDER BY CAST(${quoteIdentifier('order_index')} AS INTEGER)` : '';
  return connection.prepare(`SELECT * FROM ${quoteIdentifier(tableName)}${order}`).all();
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function normalizeImageUrl(value) {
  const raw = text(value);
  if (!raw || raw.startsWith('data:image/')) return raw;

  const driveId = raw.match(/(?:drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?.*?id=)|[?&]id=)([\w-]{15,})/i);
  return driveId ? `https://drive.google.com/thumbnail?id=${driveId[1]}&sz=w1000` : raw;
}

function cleanSku(value) {
  return text(value).replace(/^lap[-_\s]*/i, '').trim();
}

function canonicalSku(value) {
  return cleanSku(value).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function inferHierarchy(segment, rawHierarchy) {
  const raw = text(rawHierarchy);
  const numeric = Number.parseInt(raw, 10);
  if (numeric >= 1 && numeric <= 5) return numeric;

  const value = text(segment).toLowerCase();
  if (value.includes('aaa') || value.includes('hardcore')) return 5;
  if (value.includes('casual gamer')) return 4;
  if (value.includes('creator')) return 3;
  if (value.includes('productivity')) return 2;
  if (value.includes('entry') || value.includes('essential')) return 1;
  return 3;
}

function parseTagValue(raw) {
  const value = text(raw).toLowerCase();
  if (value.includes('3') || value.includes('exceed') || value.includes('top')) return 3;
  if (value.includes('2') || value.includes('meet') || value.includes('standard')) return 2;
  if (value.includes('1') || value.includes('budget') || value.includes('entry')) return 1;
  return 0;
}

function parseSkuSpecs(itemDesc, cpuValue, graphicsValue, panelValue) {
  const sku = text(itemDesc);
  let cpu = text(cpuValue);
  let graphics = text(graphicsValue);
  if (/^R[3579]-/i.test(cpu)) cpu = `AMD Ryzen ${cpu.slice(1)}`;
  else if (/^CORE\s/i.test(cpu)) cpu = `Intel ${cpu.replace(/^CORE/i, 'Core')}`;
  else if (/^I[3579]-/i.test(cpu)) cpu = `Intel ${cpu}`;
  if (/^RTX\s*\d/i.test(graphics)) graphics = `NVIDIA GeForce ${graphics}`;

  const storageMatch = sku.match(/\b(\d+(?:\.\d+)?\s*(?:TB|GB))\s*(?:SSD|NVME|PCIE)\b/i);
  const memoryMatches = [...sku.matchAll(/\b(\d{1,3})\s*GB\b/gi)];
  let memory = '';
  for (const match of memoryMatches.reverse()) {
    const preceding = sku.slice(0, match.index);
    const following = sku.slice(match.index + match[0].length);
    if (/\/\s*$/.test(preceding) || /^\s*(?:SSD|NVME|PCIE)\b/i.test(following)) continue;
    const capacity = Number(match[1]);
    if (capacity > 0 && capacity <= 128) {
      memory = `${capacity}GB`;
      break;
    }
  }

  const displayToken = sku.match(/\b(?:FHD\+?|WUXGA|WQXGA|QHD\+?|UHD|OLED|\d(?:\.\d)?K|\d{3,4}\s*[x×]\s*\d{3,4})\b/i);
  const panelSize = text(panelValue);
  const display = [panelSize, displayToken ? displayToken[0].toUpperCase() : ''].filter(Boolean).join(' ');
  return {
    cpu,
    graphics,
    storage: storageMatch ? `${storageMatch[1].replace(/\s/g, '')} SSD` : '',
    memory,
    display
  };
}

function makeSpecsMap(rows) {
  const specsMap = {};
  const specsBySku = {};

  for (const row of rows) {
    const itemDesc = text(row['ITEM DESCRIPTION']);
    if (!itemDesc) continue;

    const brand = cleanSku(itemDesc).split(/\s+/)[0] || '';
    const model = text(row.MODEL);
    const title = model && model.toLowerCase().includes(brand.toLowerCase())
      ? model
      : [brand, model].filter(Boolean).join(' ');
    const parsedSpecs = parseSkuSpecs(itemDesc, row.CPU, row.GRAPHICS, row['PANEL SIZE']);
    const cpu = parsedSpecs.cpu;
    const graphics = parsedSpecs.graphics;
    const storage = parsedSpecs.storage || (/\D/.test(text(row.STORAGE)) ? text(row.STORAGE) : '');
    const memory = parsedSpecs.memory || (/\D/.test(text(row.MEMORY)) ? text(row.MEMORY) : '');
    const resolution = /\D/.test(text(row.RESOLUTION)) ? text(row.RESOLUTION) : '';
    const panelSize = text(row['PANEL SIZE']);
    const priceValue = text(row.PRICE);
    const priceNumber = Number(priceValue.replace(/[^\d.]/g, ''));
    const price = priceValue && Number.isFinite(priceNumber)
      ? priceNumber.toLocaleString('en-US')
      : priceValue;
    const specs = [];
    if (cpu) specs.push(`Processor: ${cpu}`);
    if (graphics) specs.push(`Graphics: ${graphics}`);
    if (storage) specs.push(`Storage: ${storage}`);
    if (memory) specs.push(`Memory: ${memory}`);
    if (parsedSpecs.display) specs.push(`Display: ${parsedSpecs.display}`);
    else if (resolution && panelSize) specs.push(`Display: ${panelSize} (${resolution})`);
    else if (panelSize) specs.push(`Panel size: ${panelSize}`);
    else if (resolution) specs.push(`Resolution: ${resolution}`);

    const specObj = {
      itemDesc,
      cleanSku: cleanSku(itemDesc),
      image: normalizeImageUrl(row['Image URL']),
      modelCode: text(row['Model Code']),
      brand,
      model,
      title: title || itemDesc,
      cpu,
      graphics,
      storage,
      memory,
      resolution,
      panelSize,
      price,
      specs,
      specRanks: {
        cpu: Number(row['CPU HIERARCHY']) || 0,
        graphics: Number(row['GRAPHICS HIERARCHY']) || 0,
        // Columns O-Q repeat the headers of H-J (specs), so the sync names them "STORAGE (2)" and so on.
        storage: Number(row['STORAGE (2)']) || Number(row.STORAGE) || 0,
        memory: Number(row['MEMORY (2)']) || Number(row.MEMORY) || 0,
        resolution: Number(row['RESOLUTION (2)']) || Number(row.RESOLUTION) || 0
      }
    };

    const keys = [itemDesc.toLowerCase(), cleanSku(itemDesc).toLowerCase(), specObj.modelCode.toLowerCase()].filter(Boolean);
    for (const key of keys) specsMap[key] = specObj;
    specsBySku[canonicalSku(itemDesc)] = specObj;
  }

  return { specsMap, specsBySku };
}

function makeCriteriaData(rows, specsBySku, appHierarchyMap) {
  const excluded = new Set(['id', 'sku', 'hierarchy', 'tag', 'tier', 'customer segmentation', 'order_index']);
  const locations = rows.length
    ? Object.keys(rows[0]).filter((column) => !excluded.has(column.toLowerCase()))
    : [];

  const laptops = rows.map((row) => {
    const sku = text(row.SKU);
    if (!sku) return null;

    const spec = specsBySku[canonicalSku(sku)] || {};
    const stocksByLocation = {};
    let totalStock = 0;
    for (const location of locations) {
      const quantity = Number.parseInt(text(row[location]).replace(/[^\d-]/g, ''), 10) || 0;
      stocksByLocation[location] = Math.max(0, quantity);
      totalStock += stocksByLocation[location];
    }

    return {
      sku,
      cleanSku: cleanSku(sku),
      modelCode: spec.modelCode || '',
      title: spec.title || cleanSku(sku),
      brand: spec.brand || '',
      hierarchy: inferHierarchy(row['CUSTOMER SEGMENTATION'], row.HIERARCHY),
      tag: parseTagValue(row.TAG || row.TIER || row.tag || row.tier) || 2,
      price: spec.price || '',
      image: spec.image || '',
      specs: spec.specs || [],
      specRanks: spec.specRanks || {},
      rawSpecs: spec,
      stocksByLocation,
      totalStock
    };
  }).filter(Boolean);

  for (const [appName, hierarchy] of Object.entries(appHierarchyMap)) {
    appHierarchyMap[appName.toLowerCase()] = hierarchy;
  }

  return { laptops, appHierarchyMap, locations };
}

function makeApplicationMatrix(rows) {
  const excludedColumns = new Set(['id', 'applicationuse', 'orderindex']);
  const appColumnsByCanonicalName = new Map();
  const canonicalAppName = (value) => String(value).replace(/[^a-z0-9]/gi, '').toLowerCase();
  const applicationUse = (row) => text(row['Application / Use'] || row.Application___Use || row.Application_Use);
  const getAppCell = (row, name) => {
    const direct = row[name];
    if (direct !== undefined && direct !== null && text(direct) !== '') return direct;
    const sanitized = name.replace(/[^a-zA-Z0-9_]/g, '_');
    return row[sanitized] === undefined ? '' : row[sanitized];
  };
  const appNames = [];

  if (rows.length) {
    for (const column of Object.keys(rows[0])) {
      const canonical = canonicalAppName(column);
      if (excludedColumns.has(canonical)) continue;
      const existing = appColumnsByCanonicalName.get(canonical);
      const underscoreCount = (column.match(/_/g) || []).length;
      const existingUnderscoreCount = existing ? (existing.match(/_/g) || []).length : Infinity;
      if (!existing) {
        appColumnsByCanonicalName.set(canonical, column);
        appNames.push(column);
      } else if (underscoreCount < existingUnderscoreCount) {
        appColumnsByCanonicalName.set(canonical, column);
        appNames[appNames.indexOf(existing)] = column;
      }
    }
  }

  const numberRow = rows.find((row) => applicationUse(row).toLowerCase() === 'number') || {};
  const imageRow = rows.find((row) => applicationUse(row).toLowerCase() === 'images') || {};
  const productRows = rows.filter((row) => /^LAP[-_\s]/i.test(applicationUse(row)));
  const skuHeaders = productRows.map((row, index) => {
    const rawSku = text(row['Application / Use']);
    return {
      colIndex: index,
      colLetter: '',
      rawSku,
      cleanSku: cleanSku(rawSku),
      canonicalSku: canonicalSku(rawSku)
    };
  });
  const allAppsMap = {};
  const appSkuMap = {};
  const canonicalAppMap = {};
  const applications = [];
  const appToTier = {};

  for (const name of appNames) {
    const canonicalName = name.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const hierarchy = Number.parseInt(text(numberRow[name]), 10) || 1;
    const tierLabel = ['ENTRY-LEVEL', 'PRODUCTIVITY', 'CREATORS', 'CASUAL GAMERS', 'AAA GAMERS'][hierarchy - 1] || 'ENTRY-LEVEL';
    const values = {};

    for (const row of productRows) {
      const rawSku = applicationUse(row);
      const value = text(getAppCell(row, name));
      if (!value || value.startsWith('#')) continue;
      values[canonicalSku(rawSku)] = value;
      values[cleanSku(rawSku).toLowerCase()] = value;
      values[rawSku.toLowerCase()] = value;
    }

    const app = {
      name,
      rawName: name,
      cleanName: name,
      canonicalName: canonicalAppName(name),
      hierarchy,
      tierLabel,
      icon: normalizeImageUrl(getAppCell(imageRow, name)),
      values
    };
    applications.push(app);
    allAppsMap[name.toLowerCase()] = values;
    allAppsMap[canonicalName] = values;
    appSkuMap[name.toLowerCase()] = values;
    appSkuMap[canonicalName] = values;
    canonicalAppMap[canonicalName] = name;
    appToTier[name] = hierarchy;
  }

  return {
    sheetName: 'DV',
    allAppsMap,
    canonicalAppMap,
    appSkuMap,
    applications,
    allAppsList: appNames,
    appToTier,
    tierMap: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {} },
    skuHeaders
  };
}

// UKSP TRANSPOSED has one row per SKU (the SKU is in the FEATURES column) and one column per feature.
function makeUkspData(rows, modelBySku = {}) {
  const excludedColumns = new Set(['id', 'features', 'order_index']);
  const features = rows.length
    ? Object.keys(rows[0]).filter((column) => !excludedColumns.has(column.toLowerCase()))
    : [];
  const skuRows = rows.filter((row) => text(row.FEATURES));

  return {
    features,
    skus: skuRows.map((row, index) => {
      const sku = text(row.FEATURES);
      return {
        sku,
        model: modelBySku[canonicalSku(sku)] || '',
        colIndex: index + 1,
        features: Object.fromEntries(features.map((feature) => [feature, text(row[feature])]))
      };
    })
  };
}

// UKSP BANNER cells hold short names from FEATURES BANNER (comma-separated for several banners) or a Drive link.
// features[feature] is the first banner (what SalesKit 1.0.8 and older show); featureBanners[feature] lists all.
function makeUkspBannerData(rows, featureBannerRows = []) {
  const resolve = createFeatureBannerResolver(featureBannerRows, normalizeImageUrl);
  const excludedColumns = new Set(['id', 'sku', 'model', 'order_index']);
  const features = rows.length
    ? Object.keys(rows[0]).filter((column) => !excludedColumns.has(column.toLowerCase()))
    : [];

  return {
    features,
    skus: rows.map((row) => {
      const banners = Object.fromEntries(features.map((feature) => [feature, resolve(row[feature])]));
      return {
        sku: text(row.SKU),
        model: text(row.Model),
        features: Object.fromEntries(features.map((feature) => [feature, banners[feature][0] ? banners[feature][0].url : ''])),
        featureBanners: Object.fromEntries(features.filter((feature) => banners[feature].length).map((feature) => [feature, banners[feature]]))
      };
    }).filter((laptop) => laptop.sku)
  };
}

function makeLogoData(rows) {
  const row = rows.find((item) => item.id === 'logo') || rows[0] || {};
  return {
    applicationLogoUrl: normalizeImageUrl(row.application_logo || row['Application Logo']),
    headerLogoUrl: normalizeImageUrl(row.header_logo || row['Upper left logo']),
    bannerLogoUrl: normalizeImageUrl(row.banner_logo)
  };
}

function getInitialData() {
  if (!connection) throw new Error('Open a database before loading SalesKit data.');

  const specRows = getRows('specs');
  const { specsMap, specsBySku } = makeSpecsMap(specRows);
  const applicationMatrix = makeApplicationMatrix(getRows('dv_transposed'));
  const criteriaSegmentData = makeCriteriaData(
    getRows('criteria_segment_application'),
    specsBySku,
    Object.fromEntries(applicationMatrix.applications.map(({ name, hierarchy }) => [name.toLowerCase(), hierarchy]))
  );
  const ukspBannerData = makeUkspBannerData(getRows('uksp_banner'), getRows('features_banner'));
  const modelBySku = Object.fromEntries(Object.entries(specsBySku).map(([sku, spec]) => [sku, spec.title]));
  ukspBannerData.skus.forEach(({ sku, model }) => {
    if (model) modelBySku[canonicalSku(sku)] = model;
  });
  const ukspPerSkuData = makeUkspData(getRows('uksp_transposed'), modelBySku);
  const logoData = makeLogoData(getRows('logo'));
  const recoTableData = getRows('reco_table');
  const appsLogoMap = Object.fromEntries(applicationMatrix.applications.map(({ name, icon }) => [name, icon]));
  const skuImageMap = Object.fromEntries(Object.values(specsBySku).map((spec) => [spec.cleanSku, spec.image]));
  const skuBrandMap = Object.fromEntries(Object.values(specsBySku).map((spec) => [spec.cleanSku, spec.brand]));
  const skuModelMap = Object.fromEntries(Object.values(specsBySku).map((spec) => [spec.cleanSku, spec.title]));

  return {
    ...logoData,
    skuList: criteriaSegmentData.laptops.map(({ cleanSku: sku }) => sku),
    skuImageMap,
    skuBrandMap,
    skuModelMap,
    skuFeaturesMap: {},
    skuBenefitsMap: {},
    appsList: applicationMatrix.allAppsList,
    appsBenefitMap: {},
    appsLogoMap,
    appsIconBase64Map: {},
    appsDataList: applicationMatrix.applications.map(({ name, hierarchy, icon, tierLabel }) => ({ name, hierarchy, icon, tierLabel })),
    featuresList: ukspPerSkuData.features,
    featureBenefitMap: {},
    featureIconMap: {},
    locationsList: criteriaSegmentData.locations,
    specsMap,
    criteriaSegmentData: { ...criteriaSegmentData, specsMap },
    recoTableData,
    ukspPerSkuData,
    ukspBannerData,
    appUkspData: applicationMatrix,
    dvApplicationsPerSkuData: applicationMatrix,
    bannerData: buildBannerData({
      laptops: getRows('banner_laptops'),
      specs: getRows('banner_specs'),
      photos: getRows('banner_photos'),
      prices: getRows('banner_prices'),
      ageing: getRows('ageing_banner')
    }, normalizeImageUrl),
    sheetStatus: {
      skuCount: criteriaSegmentData.laptops.length,
      specsCount: specRows.length,
      appCount: applicationMatrix.applications.length,
      featuresCount: ukspPerSkuData.features.length
    }
  };
}

function sheetTableName(collectionId) {
  const name = String(collectionId).replace(/-/g, '_');
  if (!name || name.includes('\0') || name.startsWith('__saleskit_')) {
    throw new Error(`Unsupported spreadsheet table name: ${collectionId}`);
  }
  return name;
}

function serializeSheetValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function replaceSheetsData(sheets) {
  if (!connection) throw new Error('Open a database before importing spreadsheet data.');
  if (!sheets || typeof sheets !== 'object') throw new Error('Spreadsheet data must be an object.');

  let updatedCount = 0;
  let deletedCount = 0;
  let changed = false;
  const commit = connection.transaction(() => {
    for (const sheet of Object.values(sheets)) {
      const tableName = sheetTableName(sheet.collection);
      if (!SHEET_TABLES.has(tableName)) throw new Error(`Unsupported spreadsheet table: ${tableName}`);

      const columns = [...new Set((sheet.columns || [])
        .map((column) => String(column).trim())
        .filter((column) => column && column.toLowerCase() !== 'id'))];
      const rows = (sheet.rows || []).filter((row) => row && row.id).map((row) => ({
        id: String(row.id),
        data: Object.fromEntries(columns.map((column) => [column, serializeSheetValue(row.data?.[column])]))
      }));
      const exists = connection.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
      ).get(tableName);
      const currentRows = exists
        ? connection.prepare(`SELECT * FROM ${quoteIdentifier(tableName)}`).all()
        : [];
      const currentColumns = exists
        ? connection.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all().map(({ name }) => name)
        : [];
      const desiredColumns = ['id', ...columns];
      const sameColumns = currentColumns.length === desiredColumns.length &&
        desiredColumns.every((column) => currentColumns.includes(column));
      const currentById = new Map(currentRows.map((row) => [String(row.id), row]));
      const sameRows = sameColumns && currentRows.length === rows.length && rows.every(({ id, data }) => {
        const current = currentById.get(id);
        return current && columns.every((column) => current[column] === data[column]);
      });
      if (sameRows) continue;

      changed = true;
      const incomingIds = new Set(rows.map(({ id }) => id));
      updatedCount += rows.filter(({ id, data }) => {
        const current = currentById.get(id);
        return !sameColumns || !current || columns.some((column) => current[column] !== data[column]);
      }).length;
      deletedCount += currentRows.filter(({ id }) => !incomingIds.has(String(id))).length;

      connection.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`);
      const definitions = desiredColumns.map((column) => `${quoteIdentifier(column)} TEXT${column === 'id' ? ' PRIMARY KEY' : ''}`);
      connection.exec(`CREATE TABLE ${quoteIdentifier(tableName)} (${definitions.join(', ')})`);
      if (rows.length) {
        const insert = connection.prepare(
          `INSERT INTO ${quoteIdentifier(tableName)} (${desiredColumns.map(quoteIdentifier).join(', ')}) ` +
          `VALUES (${desiredColumns.map(() => '?').join(', ')})`
        );
        for (const { id, data } of rows) {
          insert.run(id, ...columns.map((column) => data[column]));
        }
      }
    }
  });

  commit();
  return { changeCount: updatedCount + deletedCount, updatedCount, deletedCount, changed };
}

function getImageUrls() {
  const data = getInitialData();
  const urls = new Set();
  const add = (url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) urls.add(url);
  };

  Object.values(data.specsMap).forEach((spec) => add(spec.image));
  Object.values(data.skuImageMap).forEach(add);
  Object.values(data.appsLogoMap).forEach(add);
  add(data.applicationLogoUrl);
  add(data.headerLogoUrl);
  data.appsDataList.forEach((app) => add(app.icon));
  (data.ukspBannerData?.skus || []).forEach((laptop) => {
    Object.values(laptop.features || {}).forEach(add);
  });
  return [...urls];
}

function mapCachedImageUrls(data, resolveImageUrl) {
  const map = (value) => typeof value === 'string' ? resolveImageUrl(value) : value;
  Object.values(data.specsMap || {}).forEach((spec) => { spec.image = map(spec.image); });
  Object.entries(data.skuImageMap || {}).forEach(([key, value]) => { data.skuImageMap[key] = map(value); });
  Object.entries(data.appsLogoMap || {}).forEach(([key, value]) => { data.appsLogoMap[key] = map(value); });
  data.headerLogoUrl = map(data.headerLogoUrl);
  Object.values(data.appsDataList || []).forEach((app) => { app.icon = map(app.icon); });
  Object.values(data.appUkspData?.applications || []).forEach((app) => { app.icon = map(app.icon); });
  (data.ukspBannerData?.skus || []).forEach((laptop) => {
    Object.entries(laptop.features || {}).forEach(([feature, url]) => {
      laptop.features[feature] = map(url);
    });
  });
  Object.values(data.criteriaSegmentData?.laptops || []).forEach((laptop) => {
    laptop.image = map(laptop.image);
    if (laptop.rawSpecs) laptop.rawSpecs.image = map(laptop.rawSpecs.image);
  });
  return data;
}

// SalesKit Server user accounts. The "__saleskit_" prefix keeps this table out of the Google Sheets sync,
// the Data tab and the client API, while database backups still include it.
const USERS_TABLE = '__saleskit_users';

function ensureUsersTable() {
  if (!connection) throw new Error('Open a database before using accounts.');
  connection.exec(`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(USERS_TABLE)} (username TEXT PRIMARY KEY, data TEXT NOT NULL)`);
}

function loadUsers() {
  ensureUsersTable();
  return Object.fromEntries(connection.prepare(`SELECT username, data FROM ${quoteIdentifier(USERS_TABLE)}`).all()
    .map(({ username, data }) => [username, JSON.parse(data)]));
}

function saveUser(user) {
  ensureUsersTable();
  connection.prepare(`INSERT OR REPLACE INTO ${quoteIdentifier(USERS_TABLE)} (username, data) VALUES (?, ?)`)
    .run(user.username, JSON.stringify(user));
}

function deleteUser(username) {
  ensureUsersTable();
  connection.prepare(`DELETE FROM ${quoteIdentifier(USERS_TABLE)} WHERE username = ?`).run(username);
}

// Branch codes (BR column of RECO TABLE), for assigning users to a branch.
function listBranches() {
  if (!connection || !listTables().some(({ name }) => name === 'reco_table')) return [];
  return connection.prepare(`SELECT DISTINCT TRIM(${quoteIdentifier('BR')}) AS branch FROM reco_table`).all()
    .map(({ branch }) => String(branch || '').toUpperCase())
    .filter(Boolean)
    .sort();
}

// Copies the open database to `destination` while it stays in use.
async function backupDatabase(destination) {
  if (!connection) throw new Error('Open a database before backing it up.');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await connection.backup(destination);
  return destination;
}

function closeDatabase() {
  if (connection) connection.close();
  connection = null;
  activePath = null;
}

module.exports = {
  backupDatabase,
  closeDatabase,
  deleteUser,
  getImageUrls,
  getInitialData,
  getStatus,
  getTableData,
  listBranches,
  listTables,
  loadUsers,
  mapCachedImageUrls,
  openDatabase,
  replaceSheetsData,
  saveUser
};