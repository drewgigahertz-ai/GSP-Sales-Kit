// Reads the laptop's brand and model from Windows (e.g. "Dell Inc." / "Latitude 5420"), once per start.
const { execFile } = require('node:child_process');

// Values manufacturers leave in when they do not fill the field in.
const PLACEHOLDER = /^(system (manufacturer|product name)|to be filled by o\.?e\.?m\.?|default string|not applicable|none|o\.?e\.?m\.?)$/i;

function clean(value) {
  const text = String(value || '').replace(/[^\x20-\x7e]/g, '').trim();
  return PLACEHOLDER.test(text) ? '' : text.slice(0, 60);
}

let pending = null;

function getDeviceInfo() {
  if (pending) return pending;
  pending = new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ make: '', model: '' });
      return;
    }
    const script = '$c = Get-CimInstance Win32_ComputerSystem; "$($c.Manufacturer)|$($c.Model)"';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 8000, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve({ make: '', model: '' });
        return;
      }
      const [make, model] = String(stdout).trim().split('|');
      resolve({ make: clean(make), model: clean(model) });
    });
  });
  return pending;
}

module.exports = { getDeviceInfo };
