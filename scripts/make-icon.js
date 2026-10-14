// Builds the Windows icon (build/icon.ico, used for the .exe, shortcuts, taskbar and installer) from a logo image.
// Run with Electron so its image scaler is available:
//   npx electron scripts/make-icon.js <image file or https URL>
// A larger, square logo (512×512 or more) gives the sharpest result.
const { app, nativeImage, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const OUTPUT_DIR = path.join(__dirname, '..', 'build');

async function loadImage(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await net.fetch(source);
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
    return nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()));
  }
  return nativeImage.createFromPath(path.resolve(source));
}

// Centers the logo on a transparent square so it is never stretched.
function squarePng(image, size) {
  const { width, height } = image.getSize();
  const scale = size / Math.max(width, height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const resized = image.resize({ width: w, height: h, quality: 'best' }).toBitmap(); // BGRA
  const canvas = Buffer.alloc(size * size * 4);
  const left = Math.floor((size - w) / 2);
  const top = Math.floor((size - h) / 2);
  for (let y = 0; y < h; y += 1) {
    resized.copy(canvas, ((top + y) * size + left) * 4, y * w * 4, (y + 1) * w * 4);
  }
  return nativeImage.createFromBitmap(canvas, { width: size, height: size }).toPNG();
}

// ICO file with PNG-compressed entries (supported since Windows Vista).
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + pngs.length * 16;
  pngs.forEach(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((png) => png.data)]);
}

app.whenReady().then(async () => {
  try {
    const source = process.argv[process.argv.length - 1];
    if (!source || source.endsWith('make-icon.js')) throw new Error('Pass the logo image file or URL.');
    const image = await loadImage(source);
    if (image.isEmpty()) throw new Error('The logo could not be read as an image.');
    const pngs = SIZES.map((size) => ({ size, data: squarePng(image, size) }));
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, 'icon.ico'), buildIco(pngs));
    fs.writeFileSync(path.join(OUTPUT_DIR, 'icon.png'), pngs[pngs.length - 1].data);
    console.log(`Wrote build/icon.ico (${SIZES.join(', ')} px) from a ${image.getSize().width}×${image.getSize().height} logo.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  app.quit();
});
