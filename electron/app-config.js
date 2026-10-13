// SalesKit Server addresses and token, baked into the installer from electron/embedded-config.json
// (not committed to git). Environment variables override them.
let embedded = {};
try {
  embedded = require('./embedded-config.json');
} catch {}

function setting(envName, embeddedValue) {
  const value = process.env[envName];
  return value !== undefined && value !== '' ? value : String(embeddedValue || '');
}

function cleanUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function getConfig() {
  // SALESKIT_SERVER_URL may hold several addresses separated by commas.
  const fromEnv = process.env.SALESKIT_SERVER_URL ? process.env.SALESKIT_SERVER_URL.split(',') : null;
  const serverUrls = [...new Set((fromEnv || [embedded.serverUrl, ...(embedded.serverUrls || [])]).map(cleanUrl).filter(Boolean))];
  return {
    serverUrls,
    serverUrl: serverUrls[0] || '',
    serverToken: setting('SALESKIT_SERVER_TOKEN', embedded.serverToken)
  };
}

module.exports = { getConfig };
