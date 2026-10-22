const http = require('node:http');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

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
// onActivity({ user, address, client, activity }) (optional): what a signed-in SalesKit is showing (POST /api/activity).
// getInitialPayload(user, { dedupe }) (optional): { etag, gzip } of the prepared data for that user. Then
//   /api/initial-data answers "304 Not Modified" to a matching If-None-Match, sends gzip when accepted,
//   and /api/version includes the user's dataTag (the ETag), so laptops only download when their data changed.
// priceChanges (optional): { latestId(), since(id), subscribe(listener) → unsubscribe } (server/price-watch.js).
//   GET /api/price-changes?since=<id> lists the changes a laptop missed; GET /api/events stays open and sends
//   each new price change the moment it happens (Server-Sent Events).
function createLocalApi({ database, token = '', onRequest = null, getDataVersion = () => null, getLatestClientVersion = () => null, getInitialPayload = null, onActivity = null, accounts = null, priceChanges = null }) {
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

      if (request.method === 'POST' && url.pathname === '/api/activity') {
        const activity = await readJsonBody(request, 2048);
        if (onActivity) {
          onActivity({
            user,
            address,
            client: { name: headerText(request, 'x-saleskit-client') },
            activity: activity && typeof activity === 'object' ? activity : {}
          });
        }
        sendJson(response, 200, { ok: true });
      } else if (request.method === 'GET' && url.pathname === '/api/price-changes' && priceChanges) {
        sendJson(response, 200, { latestId: priceChanges.latestId(), events: priceChanges.since(url.searchParams.get('since')) });
      } else if (request.method === 'GET' && url.pathname === '/api/events' && priceChanges) {
        openEventStream(request, response, priceChanges);
      } else if (request.method === 'GET' && url.pathname === '/api/status') {
        const status = database.getStatus();
        sendJson(response, 200, { connected: status.connected, tableCount: status.tableCount });
      } else if (request.method === 'GET' && url.pathname === '/api/version') {
        const result = { dataVersion: getDataVersion(), latestClientVersion: getLatestClientVersion() };
        if (getInitialPayload) result.dataTag = getInitialPayload(user, payloadOptions(request)).etag;
        sendJson(response, 200, result);
      } else if (request.method === 'GET' && url.pathname === '/api/initial-data' && getInitialPayload) {
        sendPayload(request, response, getInitialPayload(user, payloadOptions(request)));
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

// Keeps the response open and writes each price change as an event; a comment every 25 seconds keeps
// proxies and firewalls from closing an idle connection.
function openEventStream(request, response, priceChanges) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  response.write(`event: hello\ndata: ${JSON.stringify({ latestId: priceChanges.latestId() })}\n\n`);
  const unsubscribe = priceChanges.subscribe((event) => {
    response.write(`event: prices\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const keepAlive = setInterval(() => response.write(': ping\n\n'), 25 * 1000);
  const close = () => {
    clearInterval(keepAlive);
    unsubscribe();
  };
  request.on('close', close);
  response.on('error', close);
}

// What the SalesKit app supports (X-SalesKit-Features): 'dedupe' (1.0.6+), 'branch-modes' (1.0.11+: branch
// accounts get every branch's stock, locked to their branch in SMT and unlocked in OSD inside the app).
function payloadOptions(request) {
  const features = headerText(request, 'x-saleskit-features').split(',').map((item) => item.trim());
  return { dedupe: features.includes('dedupe'), branchModes: features.includes('branch-modes') };
}

function sendPayload(request, response, payload) {
  const headers = { 'Cache-Control': 'no-cache', ETag: payload.etag, Vary: 'Accept-Encoding' };
  if (request.headers['if-none-match'] === payload.etag) {
    response.writeHead(304, headers);
    response.end();
    return;
  }
  headers['Content-Type'] = 'application/json; charset=utf-8';
  const gzip = /\bgzip\b/i.test(request.headers['accept-encoding'] || '');
  const body = gzip ? payload.gzip : zlib.gunzipSync(payload.gzip);
  if (gzip) headers['Content-Encoding'] = 'gzip';
  headers['Content-Length'] = body.length;
  response.writeHead(200, headers);
  response.end(body);
}

module.exports = { createLocalApi };
