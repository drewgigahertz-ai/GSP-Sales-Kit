// Keeps dated copies of the SalesKit database so a bad edit in Google Sheets can be undone.
const fs = require('node:fs');
const path = require('node:path');

const BACKUP_NAME = /^mydata-\d{8}-\d{6}-[a-z-]+\.db$/;

function timestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function createBackupStore(directory, database, { keep = 10 } = {}) {
  function filePath(name) {
    if (!BACKUP_NAME.test(String(name))) throw new Error('Unknown backup.');
    const file = path.join(directory, name);
    if (!fs.existsSync(file)) throw new Error('That backup no longer exists.');
    return file;
  }

  function list() {
    let names = [];
    try {
      names = fs.readdirSync(directory).filter((name) => BACKUP_NAME.test(name));
    } catch {}
    return names
      .map((name) => {
        const stats = fs.statSync(path.join(directory, name));
        const reason = name.replace(/^mydata-\d{8}-\d{6}-/, '').replace(/\.db$/, '');
        return { name, size: stats.size, createdAt: stats.mtime.toISOString(), reason };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  function prune() {
    list().slice(keep).forEach(({ name }) => {
      try {
        fs.unlinkSync(path.join(directory, name));
      } catch {}
    });
  }

  // reason: short label such as "before-sync", "manual" or "before-restore".
  async function create(reason) {
    const name = `mydata-${timestamp()}-${reason}.db`;
    await database.backupDatabase(path.join(directory, name));
    prune();
    return name;
  }

  // Copies the open database to a temporary file; call keep() or discard() on the result.
  async function snapshot(reason) {
    const temporary = path.join(directory, `pending-${Date.now()}.db`);
    await database.backupDatabase(temporary);
    return {
      keep() {
        const name = `mydata-${timestamp()}-${reason}.db`;
        fs.renameSync(temporary, path.join(directory, name));
        prune();
        return name;
      },
      discard() {
        try {
          fs.unlinkSync(temporary);
        } catch {}
      }
    };
  }

  return { list, create, snapshot, filePath };
}

module.exports = { createBackupStore };
