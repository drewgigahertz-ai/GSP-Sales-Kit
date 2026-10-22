// Price changes, pushed by the server the moment NEW PRICING changes (server/price-watch.js).
// While someone is signed in, one connection to /api/events stays open; each "prices" event is handed to
// onEvents. After (re)connecting, the changes this laptop missed are fetched from /api/price-changes.
// The id of the last change shown is kept on the laptop, so a change is announced only once. A newly
// installed SalesKit starts from the current change and does not show the history.
// Every price change is shown to every branch (branch-only rows included).
const fs = require('node:fs');
const path = require('node:path');

const RETRY_MIN_MS = 5 * 1000;
const RETRY_MAX_MS = 60 * 1000;

// getConnection(): { urls, headers } for the server, or null while nobody is signed in.
// requestServer(pathname): a JSON request to the server (main.js).
function createPriceStream({ filePath, getConnection, requestServer, onEvents }) {
  let lastSeenId = null;
  try {
    lastSeenId = JSON.parse(fs.readFileSync(filePath, 'utf8')).lastSeenId ?? null;
  } catch {}

  function remember(id) {
    if (lastSeenId !== null && id <= lastSeenId) return;
    lastSeenId = id;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({ lastSeenId }), 'utf8');
    } catch {}
  }

  function deliver(events) {
    const fresh = events.filter((event) => lastSeenId === null || event.id > lastSeenId);
    if (!fresh.length) return;
    remember(Math.max(...fresh.map((event) => event.id)));
    const shown = fresh.filter((event) => (event.changes || []).length);
    if (shown.length) onEvents(shown);
  }

  async function catchUp(latestId) {
    if (lastSeenId === null || latestId < lastSeenId) {
      // First run on this laptop (or a new server): start from now.
      lastSeenId = null;
      remember(latestId);
      return;
    }
    if (latestId === lastSeenId) return;
    const { events = [] } = await requestServer(`/api/price-changes?since=${lastSeenId}`);
    deliver(events);
  }

  let controller = null;
  let stopped = false;

  // Reads Server-Sent Events from the response until the connection ends.
  async function readEvents(response) {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        let type = 'message';
        const data = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) type = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).trim());
        }
        if (!data.length) continue;
        let value;
        try {
          value = JSON.parse(data.join('\n'));
        } catch {
          continue;
        }
        if (type === 'hello') await catchUp(Number(value.latestId) || 0).catch(() => {});
        else if (type === 'prices') deliver([value]);
      }
    }
  }

  async function run() {
    let retryMs = RETRY_MIN_MS;
    while (!stopped) {
      const connection = await getConnection();
      if (!connection) {
        await wait(RETRY_MIN_MS);
        continue;
      }
      let connected = false;
      for (const url of connection.urls) {
        if (stopped) return;
        controller = new AbortController();
        try {
          const response = await fetch(`${url}/api/events`, {
            headers: { ...connection.headers, Accept: 'text/event-stream' },
            signal: controller.signal
          });
          if (!response.ok || !response.body) continue;
          connected = true;
          retryMs = RETRY_MIN_MS;
          await readEvents(response);
          break;
        } catch {
          // Unreachable at this address, or the connection dropped; try the next one / again.
        } finally {
          controller = null;
        }
      }
      if (stopped) return;
      await wait(connected ? RETRY_MIN_MS : retryMs);
      if (!connected) retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    }
  }

  return {
    start() {
      stopped = false;
      run();
    },
    // Signed out or signed in as someone else: reconnect with the new session.
    reconnect() {
      if (controller) controller.abort();
    }
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { createPriceStream };
