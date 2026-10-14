const http = require('node:http');
const crypto = require('node:crypto');

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(value));
}

function authorized(request, token) {
  if (!token) return true;
  const authorization = request.headers.authorization || '';
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const expectedBuffer = Buffer.from(token);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

// Client-supplied identity headers are only used for display, so keep them short and printable.
function headerText(request, name) {
  return String(request.headers[name] || '').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 80);
}

function readJsonBody(request, limit = 10 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request is too large.'));
        request.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('Request is not valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

// token: the shared app key every SalesKit sends (keeps scanners out).
// accounts (optional): { login(username, password, address), logout(key), userForSession(key), allowWithoutLogin(),
//   prepareInitialData(data, user), canBrowseTables(user) }
//   When given, data routes also need a signed-in user, sent as the X-SalesKit-Session header.
// getLatestClientVersion: the newest SalesKit release, so open clients start updating within minutes.
function createLocalApi({ database, token = '', onRequest = null, getDataVersion = () => null, getLatestClientVersion = () => null, accounts = null }) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const address = request.socket.remoteAddress || '';
    let user = null;
    let denied = null; // 'token' (wrong app key) or 'login' (not signed in)
    if (onRequest) {
      response.on('finish', () => onRequest({
        method: request.method,
        path: url.pathname,
        status: response.statusCode,
        address,
        user,
        denied,
        client: {
          name: headerText(request, 'x-saleskit-client'),
          user: headerText(request, 'x-saleskit-user'),
          version: headerText(request, 'x-saleskit-version'),
          make: headerText(request, 'x-saleskit-make'),
          model: headerText(request, 'x-saleskit-model')
        }
      }));
    }
    if (!authorized(request, token)) {
      denied = 'token';
      sendJson(response, 401, { error: 'Unauthorized.' });
      return;
    }

    try {
      if (accounts && request.method === 'POST' && url.pathname === '/api/login') {
        const { username, password } = await readJsonBody(request);
        try {
          const result = accounts.login(username, password, address.replace(/^::ffff:/, ''));
          user = result.user;
          const { username: name, displayName, branch } = result.user;
          sendJson(response, 200, { sessionKey: result.sessionKey, user: { username: name, displayName, branch } });
        } catch (error) {
          sendJson(response, error.code === 'locked' ? 429 : 401, { error: error.message, code: error.code || 'invalid' });
        }
        return;
      }
      if (accounts && request.method === 'POST' && url.pathname === '/api/logout') {
        accounts.logout(request.headers['x-saleskit-session']);
        sendJson(response, 200, { ok: true });
        return;
      }

      if (accounts) {
        user = accounts.userForSession(request.headers['x-saleskit-session']);
        if (!user && !accounts.allowWithoutLogin()) {
          denied = 'login';
          sendJson(response, 401, { error: 'Please log in.', code: 'login_required' });
          return;
        }
      }

      if (request.method === 'GET' && url.pathname === '/api/status') {
        const status = database.getStatus();
        sendJson(response, 200, { connected: status.connected, tableCount: status.tableCount });
      } else if (request.method === 'GET' && url.pathname === '/api/version') {
        sendJson(response, 200, { dataVersion: getDataVersion(), latestClientVersion: getLatestClientVersion() });
      } else if (request.method === 'GET' && url.pathname === '/api/initial-data') {
        const data = database.getInitialData();
        sendJson(response, 200, accounts && accounts.prepareInitialData ? accounts.prepareInitialData(data, user) : data);
      } else if ((url.pathname === '/api/tables' || url.pathname === '/api/table-data') &&
          accounts && accounts.canBrowseTables && !accounts.canBrowseTables(user)) {
        // Raw tables hold every branch, so branch-locked users cannot browse them.
        sendJson(response, 403, { error: 'Not available for your account.' });
      } else if (request.method === 'GET' && url.pathname === '/api/tables') {
        sendJson(response, 200, database.listTables());
      } else if (request.method === 'GET' && url.pathname === '/api/table-data') {
        const tableName = url.searchParams.get('table') || '';
        sendJson(response, 200, database.getTableData(tableName, {
          limit: url.searchParams.get('limit'),
          offset: url.searchParams.get('offset'),
          search: url.searchParams.get('search')
        }));
      } else {
        sendJson(response, 404, { error: 'Not found.' });
      }
    } catch (error) {
      sendJson(response, 500, { error: error.message || 'Server request failed.' });
    }
  });
}

module.exports = { createLocalApi };
