// Runs before `npm run release`: a client built without the server address would cut every
// updated laptop off from the SalesKit Server, so refuse to publish one.
const fs = require('node:fs');
const path = require('node:path');

const configPath = path.join(__dirname, '..', 'electron', 'embedded-config.json');

function fail(message) {
  console.error(`\nRelease stopped: ${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(configPath)) {
  fail('electron/embedded-config.json is missing. Copy the client config from SalesKit Server into that file.');
}

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch {
  fail('electron/embedded-config.json is not valid JSON.');
}

const serverUrls = [...new Set([config.serverUrl, ...(config.serverUrls || [])].filter(Boolean))];
if (!serverUrls.length || !serverUrls.every((url) => /^https?:\/\/[^/\s]+/i.test(url))) {
  fail('electron/embedded-config.json needs a serverUrl like "http://192.168.30.209:3000" (and valid serverUrls, if any).');
}
if (!config.serverToken || config.serverToken.length < 16) {
  fail('electron/embedded-config.json needs the serverToken from SalesKit Server.');
}
if (!process.env.GH_TOKEN) {
  fail('GH_TOKEN is not set, so the installer cannot be uploaded to GitHub.');
}

const { version } = require('../package.json');
console.log(`Release check passed: SalesKit ${version} → ${serverUrls.join(', ')}`);
