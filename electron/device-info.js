// Reads the laptop's brand and model from Windows (e.g. "Dell" / "Inspiron 15 3511"), once per start.
// Many brands put a code in the Model field (Lenovo "82KB", Huawei "NBD-WXX9"); the readable name is then taken from
// the product version (Lenovo: "IdeaPad 5 14ALC05") or the model family (Huawei: "MateBook D").
const { execFile } = require('node:child_process');

// Values manufacturers leave in when they do not fill the field in.
const PLACEHOLDER = /^(system (manufacturer|product name|version)|to be filled by o\.?e\.?m\.?|default string|not applicable|none|o\.?e\.?m\.?|n\/?a|x\.x+|[\d.]+|invalid|type1\w*|\w*_\w*_\w*)$/i;

// Short brand names (Windows says "Dell Inc.", "ASUSTeK COMPUTER INC.", "Micro-Star International Co., Ltd.").
const BRANDS = [
  [/^lenovo/i, 'Lenovo'], [/^dell/i, 'Dell'], [/^(hp|hewlett)/i, 'HP'], [/^asus/i, 'ASUS'], [/^acer/i, 'Acer'],
  [/^micro-star|^msi/i, 'MSI'], [/^huawei/i, 'HUAWEI'], [/^gigabyte/i, 'GIGABYTE'], [/^microsoft/i, 'Microsoft'],
  [/^samsung/i, 'Samsung'], [/^apple/i, 'Apple'], [/^razer/i, 'Razer'], [/^infinix/i, 'Infinix'], [/^honor/i, 'HONOR']
];

function clean(value) {
  const text = String(value || '').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
  return PLACEHOLDER.test(text) ? '' : text.slice(0, 60);
}

function brandName(make) {
  const found = BRANDS.find(([pattern]) => pattern.test(make));
  return found ? found[1] : make;
}

// A model code has no spaces and no small letters ("82KB", "NBD-WXX9", "20XWS0B800").
const looksLikeCode = (model) => !/\s/.test(model) && !/[a-z]/.test(model);

function readableModel(make, { model, family, version }) {
  // "Lenovo IdeaPad 5 14ALC05" → "IdeaPad 5 14ALC05" (the brand is shown separately);
  // ASUS "VivoBook_ASUSLaptop X515EA_X515EA" → "VivoBook X515EA".
  const withoutBrand = (text) => text
    .replace(new RegExp(`^(${make.replace(/[^a-z0-9]/gi, '.')}|${brandName(make)})\\s+`, 'i'), '')
    .replace(/_ASUSLaptop/i, '').replace(/_/g, ' ')
    .split(' ').filter((word, i, words) => word && word !== words[i - 1]).join(' ')
    .trim();
  if (model && !looksLikeCode(model)) return withoutBrand(model);
  for (const candidate of [version, family]) {
    if (candidate && /[a-z]/i.test(candidate) && !looksLikeCode(candidate)) return withoutBrand(candidate);
  }
  return model || family || '';
}

let pending = null;

function getDeviceInfo() {
  if (pending) return pending;
  pending = new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ make: '', model: '' });
      return;
    }
    const script = '$c = Get-CimInstance Win32_ComputerSystem; $p = Get-CimInstance Win32_ComputerSystemProduct; '
      + '"$($c.Manufacturer)|$($c.Model)|$($c.SystemFamily)|$($p.Version)"';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 8000, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve({ make: '', model: '' });
        return;
      }
      const [make, model, family, version] = String(stdout).trim().split('|').map(clean);
      resolve({ make: brandName(make), model: readableModel(make, { model, family, version }).slice(0, 60) });
    });
  });
  return pending;
}

module.exports = { getDeviceInfo, readableModel, brandName, clean };
