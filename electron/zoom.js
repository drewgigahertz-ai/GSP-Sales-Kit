const fs = require('node:fs');

// Zoom for the whole SalesKit window (Reco Table, Sales Kit, Banner, Flyers, presentation): Ctrl+Plus / Ctrl+Minus,
// Ctrl+0 for 100%, Ctrl + mouse wheel, and the − 100% + buttons in the header (zoom-control.js). 50%–200% in steps of
// 10%. Remembered on this laptop. Downloads keep their size (they are drawn at a fixed scale).
const MIN = 0.5;
const MAX = 2;
const STEP = 0.1;

function createZoom({ filePath, getWindow }) {
  let factor = 1;
  try {
    const saved = Number(JSON.parse(fs.readFileSync(filePath, 'utf8')).factor);
    if (Number.isFinite(saved)) factor = saved;
  } catch {}

  const clamp = (value) => Math.min(MAX, Math.max(MIN, Math.round(value * 10) / 10));
  factor = clamp(factor);

  function apply() {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.setZoomFactor(factor);
    window.webContents.send('zoom:changed', factor);
  }

  function set(next) {
    factor = clamp(next);
    try {
      fs.writeFileSync(filePath, JSON.stringify({ factor }));
    } catch {}
    apply();
    return factor;
  }

  // in / out / reset, or a number (the factor).
  function change(how) {
    if (how === 'in') return set(factor + STEP);
    if (how === 'out') return set(factor - STEP);
    if (how === 'reset') return set(1);
    return set(Number(how) || 1);
  }

  // Hooks the window: the keys (also while a Banner or Flyers frame has the keyboard), Ctrl + wheel, and the
  // remembered zoom on every page load.
  function attach(window) {
    const contents = window.webContents;
    contents.on('did-finish-load', apply);
    contents.on('zoom-changed', (_event, direction) => change(direction === 'in' ? 'in' : 'out'));
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
      const key = input.key;
      if (key === '+' || key === '=' || input.code === 'NumpadAdd') change('in');
      else if (key === '-' || key === '_' || input.code === 'NumpadSubtract') change('out');
      else if (key === '0' || input.code === 'Numpad0') change('reset');
      else return;
      event.preventDefault();
    });
  }

  return { attach, change, get: () => factor };
}

module.exports = { createZoom };
