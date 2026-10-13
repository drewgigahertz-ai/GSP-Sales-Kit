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

function createLocalApi({ database, token = '', onRequest = null, getDataVersion = () => null }) {
  return http.createServer(async (request, response) => {
    if (onRequest) {
      response.on('finish', () => onRequest({
        method: request.method,
        path: new URL(request.url, 'http://localhost').pathname,
        status: response.statusCode,
        address: request.socket.remoteAddress || '',
        client: {
          name: headerText(request, 'x-saleskit-client'),
          user: headerText(request, 'x-saleskit-user'),
          version: headerText(request, 'x-saleskit-version')
        }
      }));
    }
    if (!authorized(request, token)) {
      sendJson(response, 401, { error: 'Unauthorized.' });
      return;
    }

    const url = new URL(request.url, 'http://localhost');
    try {
      if (request.method === 'GET' && url.pathname === '/api/status') {
        const status = database.getStatus();
        sendJson(response, 200, { connected: status.connected, tableCount: status.tableCount });
      } else if (request.method === 'GET' && url.pathname === '/api/version') {
        sendJson(response, 200, { dataVersion: getDataVersion() });
      } else if (request.method === 'GET' && url.pathname === '/api/initial-data') {
        sendJson(response, 200, database.getInitialData());
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