// Wi-Fi on and off for scheduled checks (app-check.js), like the Wi-Fi button in Windows' Quick Settings: the
// Wi-Fi radio (Windows.Devices.Radios), which needs no administrator rights. When it is turned on again, Windows
// connects to the saved network by itself.
const { execFile } = require('node:child_process');

// PowerShell 5.1 can wait for Windows' radio calls through AsTask.
const PRELUDE = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
[Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime] | Out-Null
$access = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
$radios = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
$wifi = $radios | Where-Object { $_.Kind -eq 'WiFi' } | Select-Object -First 1
if (-not $wifi) { 'none'; exit }
`;

// Why the last Wi-Fi call failed (PowerShell's message), for the check log.
let lastError = '';
function run(script, timeout = 30000) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PRELUDE + script], { timeout, windowsHide: true }, (error, out) => {
      lastError = error ? String(error.stderr || error.message || error).replace(/\s+/g, ' ').trim().slice(0, 200) : '';
      resolve(error ? { error: lastError } : { out: String(out || '').trim().split(/\r?\n/).pop() });
    });
  });
}

// 'on', 'off', 'none' (no Wi-Fi on this laptop) or 'unknown'.
async function wifiState() {
  if (process.platform !== 'win32') return 'unknown';
  const { out } = await run('$wifi.State.ToString().ToLower()');
  return ['on', 'off', 'none'].includes(out) ? out : 'unknown';
}

// Turns Wi-Fi on or off; true when Windows says it is so afterwards.
async function setWifi(on) {
  if (process.platform !== 'win32') return false;
  const want = on ? 'On' : 'Off';
  // Windows answers Allowed, or why not (DeniedByUser: Settings → Privacy → Radios is off for apps;
  // DeniedBySystem: a policy, or airplane mode). The state is read again after a moment.
  const { out } = await run(`$r = Await ($wifi.SetStateAsync([Windows.Devices.Radios.RadioState]::${want})) ([Windows.Devices.Radios.RadioAccessStatus]); Start-Sleep -Milliseconds 800; "$access|$r|" + $wifi.State.ToString().ToLower()`);
  const [access, result, after] = String(out || '').split('|');
  if (after !== want.toLowerCase() && !lastError) lastError = `Windows said ${result || access || 'nothing'}${access && access !== 'Allowed' ? ` (radio access: ${access})` : ''}`;
  return after === want.toLowerCase();
}

module.exports = { wifiState, setWifi, wifiError: () => lastError };
