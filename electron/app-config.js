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
    serverToken: setting('SALESKIT_SERVER_TOKEN', embedded.serverToken),
    ...appCheckConfig(serverUrls)
  };
}

// App Check Server (app tests from the admin page, see app-check.js): its own address(es) in appCheckUrl, or else
// the SalesKit Server's computer on port 3100. No token in the config turns App Check off on this laptop.
const APP_CHECK_PORT = 3100;
function appCheckConfig(serverUrls) {
  const appCheckToken = setting('SALESKIT_APPCHECK_TOKEN', embedded.appCheckToken);
  const given = setting('SALESKIT_APPCHECK_URL', embedded.appCheckUrl).split(',').map(cleanUrl).filter(Boolean);
  const derived = serverUrls.map((url) => {
    try {
      const address = new URL(url);
      address.port = String(APP_CHECK_PORT);
      return cleanUrl(address.origin);
    } catch {
      return '';
    }
  }).filter(Boolean);
  const appCheckUrls = appCheckToken ? [...new Set(given.length ? given : derived)] : [];
  return { appCheckUrls, appCheckToken };
}

module.exports = { getConfig };
