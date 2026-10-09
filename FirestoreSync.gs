// Legacy Firestore writer. The desktop host now pulls directly from Google Sheets.
// Run disableFirestoreSyncTriggers() once to remove installed legacy triggers.

var CONFIG = {
  PROJECT_ID: "saleskit-db",
  HEADER_ROW: 1,
  DATA_START_ROW: 2,
  MAX_EDIT_ROWS_PER_RUN: 75,
  TARGET_SHEETS: [
    "SPECS",
    "Criteria Segment-Application",
    "DV TRANSPOSED",
    "UKSP TRANSPOSED",
    "RECO TABLE"
  ]
};

function disableFirestoreSyncTriggers() {
  var handlers = [
    "syncAllSheetsToFirestore",
    "syncSpecsToFirestore",
    "syncCriteriaSegmentToFirestore",
    "syncDvTransposedToFirestore",
    "syncUkspTransposedToFirestore",
    "syncRecoTableToFirestore",
    "syncEditedRowToFirestore"
  ];
  var removed = 0;

  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });

  Logger.log("Removed " + removed + " legacy Firestore sync triggers. No spreadsheet or Firestore data was deleted.");
}

function getFirestore_() {
  var props = PropertiesService.getScriptProperties();
  var email = (props.getProperty("FIREBASE_EMAIL") || "").trim();
  var key = props.getProperty("FIREBASE_KEY");
  if (!email || !key) throw new Error("Missing FIREBASE_EMAIL or FIREBASE_KEY in Script Properties.");
  return FirestoreApp.getFirestore(email, normalizePrivateKey_(key), CONFIG.PROJECT_ID);
}

function normalizePrivateKey_(raw) {
  var key = String(raw).trim().replace(/^["']+/, "").replace(/["',]+$/, "").replace(/\\n/g, "\n");
  var body = key.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s+/g, "");
  if (!body || !/^[A-Za-z0-9+\/=]+$/.test(body)) {
    throw new Error("FIREBASE_KEY doesn't look like a valid private key. Re-copy the private_key value.");
  }
  return "-----BEGIN PRIVATE KEY-----\n" + body.match(/.{1,64}/g).join("\n") + "\n-----END PRIVATE KEY-----\n";
}

function isTargetSheet_(sheetName) {
  var name = String(sheetName).trim().toLowerCase();
  return CONFIG.TARGET_SHEETS.some(function (target) {
    return target.trim().toLowerCase() === name;
  });
}

function collectionNameFor_(sheetName) {
  return sheetName.toLowerCase().trim().replace(/[\/\s]+/g, "_");
}

function documentIdFor_(rowNumber) {
  return "item_" + ("0000" + rowNumber).slice(-4);
}

function documentPathFor_(collection, rowNumber) {
  return collection + "/" + documentIdFor_(rowNumber);
}

function normalizeValue_(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function makeRowData_(headers, values) {
  var data = {};
  for (var c = 0; c < headers.length; c++) {
    var rawHeader = String(headers[c]).trim();
    if (rawHeader) data[rawHeader] = normalizeValue_(values[c]);
  }
  return data;
}

function hashData_(data) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(data))
    .map(function (value) { return (value < 0 ? value + 256 : value).toString(16); })
    .join("");
}

function writeDoc_(firestore, path, data) {
  try {
    firestore.updateDocument(path, data);
    return true;
  } catch (updateError) {
    try {
      firestore.createDocument(path, data);
      return true;
    } catch (createError) {
      Logger.log("Write failed for " + path + ": " + createError);
      return false;
    }
  }
}

function writeChangeLog_(firestore, collection, documentId, data) {
  var eventId = "event_" + Utilities.getUuid().replace(/-/g, "");
  firestore.createDocument("__saleskit_change_log/" + eventId, {
    collection: collection,
    documentId: documentId,
    operation: "upsert",
    data: data,
    changedAtMs: Date.now()
  });
}

function writeSyncedDocument_(firestore, collection, rowNumber, data) {
  var documentId = documentIdFor_(rowNumber);
  if (!writeDoc_(firestore, collection + "/" + documentId, data)) {
    throw new Error("Firestore document write failed: " + collection + "/" + documentId);
  }
  writeChangeLog_(firestore, collection, documentId, data);
  return documentId;
}

function testFirestoreWrite() {
  var firestore = getFirestore_();
  if (!writeDoc_(firestore, "test_collection/test_doc", {
    hello: "world",
    timestamp: new Date().toISOString()
  })) throw new Error("Test document write failed.");
  Logger.log("Successfully wrote to test_collection/test_doc. Check Firestore.");
}

function syncEditedRowToFirestore(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    Logger.log("Skipped edit sync because another Firestore sync is running.");
    return;
  }

  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    var sheetName = sheet.getName();
    var startRow = e.range.getRow();
    var numRows = e.range.getNumRows();
    var startCol = e.range.getColumn();
    var numCols = e.range.getNumColumns();
    if (!isTargetSheet_(sheetName) || startRow + numRows - 1 < CONFIG.DATA_START_ROW) return;

    if (startRow < CONFIG.DATA_START_ROW) {
      numRows -= CONFIG.DATA_START_ROW - startRow;
      startRow = CONFIG.DATA_START_ROW;
      if (numRows <= 0) return;
    }

    var firestore = getFirestore_();
    var collection = collectionNameFor_(sheetName);
    var headers = sheet.getRange(CONFIG.HEADER_ROW, startCol, 1, numCols).getValues()[0];
    var values = sheet.getRange(startRow, startCol, numRows, numCols).getValues();
    var lastCol = sheet.getLastColumn();
    var allHeaders = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
    var properties = PropertiesService.getScriptProperties();
    var syncedRows = 0;
    var deferredRows = 0;

    for (var r = 0; r < numRows; r++) {
      var data = makeRowData_(headers, values[r]);
      if (!Object.keys(data).length) continue;
      if (syncedRows >= CONFIG.MAX_EDIT_ROWS_PER_RUN) {
        deferredRows++;
        continue;
      }

      var rowNumber = startRow + r;
      var documentId = writeSyncedDocument_(firestore, collection, rowNumber, data);
      var fullRow = sheet.getRange(rowNumber, 1, 1, lastCol).getValues()[0];
      properties.setProperty("hash_" + collection + "_" + rowNumber, hashData_(makeRowData_(allHeaders, fullRow)));
      syncedRows++;
      Logger.log("SYNCED: " + collection + "/" + documentId + " and recorded change event.");
    }

    if (deferredRows) Logger.log("Deferred " + deferredRows + " edited rows to the hourly sync.");
  } catch (err) {
    Logger.log("ERROR: " + err + "\n" + (err.stack || ""));
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function syncSingleSheetToFirestore_(sheetName) {
  var collection = collectionNameFor_(sheetName);
  var lastStartKey = "syncLastStart_" + collection;
  var leaseKey = "syncLeaseUntil_" + collection;
  var runStartedAt = Date.now();
  var leaseUntil = runStartedAt + 7 * 60 * 1000;
  var properties = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  var shouldRun = false;

  if (!lock.tryLock(30000)) {
    Logger.log("Skipped " + sheetName + " schedule check because the sync gate is busy.");
    return;
  }
  try {
    var activeLease = Number(properties.getProperty(leaseKey)) || 0;
    var lastStart = Number(properties.getProperty(lastStartKey)) || 0;
    if (activeLease > runStartedAt) {
      Logger.log("Skipped " + sheetName + " because its previous run is still active.");
    } else if (runStartedAt - lastStart < 20 * 60 * 1000) {
      Logger.log("Skipped " + sheetName + "; next sync is due in " + Math.ceil((20 * 60 * 1000 - (runStartedAt - lastStart)) / 60000) + " minutes.");
    } else {
      properties.setProperties({
        [lastStartKey]: String(runStartedAt),
        [leaseKey]: String(leaseUntil)
      }, false);
      shouldRun = true;
    }
  } finally {
    lock.releaseLock();
  }

  if (!shouldRun) return;

  try {
    syncWholeSheet_(sheetName);
  } finally {
    if (lock.tryLock(30000)) {
      try {
        if (properties.getProperty(leaseKey) === String(leaseUntil)) {
          properties.deleteProperty(leaseKey);
        }
      } finally {
        lock.releaseLock();
      }
    }
  }
}

function initializeFirestoreSyncHashes() {
  var properties = PropertiesService.getScriptProperties();
  var hashUpdates = {};

  CONFIG.TARGET_SHEETS.forEach(function (sheetName) {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) return;

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < CONFIG.DATA_START_ROW || lastCol < 1) return;

    var collection = collectionNameFor_(sheetName);
    var headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
    var values = sheet.getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, lastCol).getValues();
    for (var r = 0; r < values.length; r++) {
      var data = makeRowData_(headers, values[r]);
      var hasContent = Object.keys(data).some(function (key) {
        return data[key] !== "" && data[key] !== null;
      });
      if (hasContent) hashUpdates["hash_" + collection + "_" + (CONFIG.DATA_START_ROW + r)] = hashData_(data);
    }
  });

  if (Object.keys(hashUpdates).length) properties.setProperties(hashUpdates, false);
  Logger.log("Initialized hashes for " + Object.keys(hashUpdates).length + " existing rows; no Firestore documents were read or written.");
}

function syncWholeSheet_(sheetName) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    Logger.log("Sheet not found: " + sheetName);
    return;
  }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < CONFIG.DATA_START_ROW || lastCol < 1) return;

  var firestore = getFirestore_();
  var collection = collectionNameFor_(sheetName);
  var headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
  var values = sheet.getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, lastCol).getValues();
  var properties = PropertiesService.getScriptProperties();
  var previousHashes = properties.getProperties();
  var startedAt = Date.now();
  var written = 0;
  var skipped = 0;

  for (var r = 0; r < values.length; r++) {
    var data = makeRowData_(headers, values[r]);
    var hasContent = Object.keys(data).some(function (key) {
      return data[key] !== "" && data[key] !== null;
    });
    if (!hasContent) continue;

    var rowNumber = CONFIG.DATA_START_ROW + r;
    var cacheKey = "hash_" + collection + "_" + rowNumber;
    var currentHash = hashData_(data);
    if (previousHashes[cacheKey] === currentHash) {
      skipped++;
      continue;
    }

    writeSyncedDocument_(firestore, collection, rowNumber, data);
    properties.setProperty(cacheKey, currentHash);
    written++;
  }

  var elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
  Logger.log("Sync summary [" + sheetName + "]: " + written + " written/updated, " + skipped + " skipped (unchanged), completed in " + elapsedSeconds + " seconds.");
}

function createTimeDrivenSyncTrigger() {
  var handlers = [
    "syncAllSheetsToFirestore",
    "syncSpecsToFirestore",
    "syncCriteriaSegmentToFirestore",
    "syncDvTransposedToFirestore",
    "syncUkspTransposedToFirestore",
    "syncRecoTableToFirestore"
  ];
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(trigger);
  });

  var sheetHandlers = [
    "syncSpecsToFirestore",
    "syncCriteriaSegmentToFirestore",
    "syncDvTransposedToFirestore",
    "syncUkspTransposedToFirestore",
    "syncRecoTableToFirestore"
  ];
  sheetHandlers.forEach(function (handler, index) {
    ScriptApp.newTrigger(handler)
      .timeBased()
      .everyMinutes(10)
      .create();
  });

  Logger.log("Created five sheet-specific triggers. Each sheet sync runs at most once every 20 minutes; different sheets may sync concurrently.");
}

function createEditTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "syncEditedRowToFirestore") ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("syncEditedRowToFirestore").forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  Logger.log("Edit trigger created.");
}