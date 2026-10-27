// Saving files made in the page (the Flyers page's PDF, or its pages as PNG pictures): one Save dialog; with
// several files, the others are saved beside the first, numbered ("Flyer-ALB-page2.png").
const fs = require('node:fs');
const path = require('node:path');

const TYPES = {
  'application/pdf': { extension: 'pdf', filter: 'PDF document' },
  'image/png': { extension: 'png', filter: 'Images' },
  'image/jpeg': { extension: 'jpg', filter: 'Images' }
};

function decode(dataUrl) {
  const match = /^data:([a-z0-9./+-]+);base64,(.+)$/i.exec(String(dataUrl || ''));
  const type = match && TYPES[match[1].toLowerCase()];
  if (!type) throw new Error('This file type cannot be saved.');
  return { type, buffer: Buffer.from(match[2], 'base64') };
}

function safeName(name, fallback) {
  return String(name || '').replace(/[\\/:*?"<>|]+/g, '_').trim() || fallback;
}

// files: [{ name, dataUrl }] (names without extension), all of one type.
function registerFileSave({ ipcMain, dialog, app, getWindow }) {
  ipcMain.handle('files:save', async (_event, files) => {
    if (!Array.isArray(files) || !files.length) throw new Error('Nothing to save.');
    const decoded = files.map((file) => ({ name: safeName(file && file.name, 'file'), ...decode(file && file.dataUrl) }));
    const { extension, filter } = decoded[0].type;
    const result = await dialog.showSaveDialog(getWindow(), {
      title: decoded.length > 1 ? `Save ${decoded.length} pages` : 'Save',
      defaultPath: path.join(app.getPath('downloads'), `${decoded[0].name}.${extension}`),
      filters: [{ name: filter, extensions: [extension] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const folder = path.dirname(result.filePath);
    const base = path.basename(result.filePath, path.extname(result.filePath));
    const saved = decoded.map((file, index) => {
      const target = index === 0 ? result.filePath : path.join(folder, `${base}-page${index + 1}.${file.type.extension}`);
      fs.writeFileSync(target, file.buffer);
      return target;
    });
    return { canceled: false, files: saved };
  });
}

module.exports = { registerFileSave };
