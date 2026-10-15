const { powerMonitor } = require('electron');

// Tells the SalesKit Server what this laptop is showing (Devices → "Showing now", and the banner history).
// Only changes are sent, a few hundred bytes each; nothing is sent while nobody is signed in.
// "Idle" when the window is minimized or hidden, or nobody has used the laptop for 5 minutes.
const IDLE_SECONDS = 5 * 60;
const IDLE_CHECK_MS = 30 * 1000;
const SEND_DELAY_MS = 1500;

function createActivityReporter({ send, getWindow, isSignedIn }) {
  let current = null;
  let idle = false;
  let lastSent = '';
  let timer = null;

  function flush() {
    timer = null;
    if (!current || !isSignedIn()) return;
    const report = { ...current, idle };
    const key = JSON.stringify(report);
    if (key === lastSent) return;
    lastSent = key;
    // Older servers do not know /api/activity; that is fine, it is only information.
    send(report).catch(() => { lastSent = ''; });
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(flush, SEND_DELAY_MS);
  }

  setInterval(() => {
    const win = getWindow();
    const hidden = !win || win.isDestroyed() || win.isMinimized() || !win.isVisible();
    const nowIdle = hidden || powerMonitor.getSystemIdleTime() >= IDLE_SECONDS;
    if (nowIdle !== idle) {
      idle = nowIdle;
      schedule();
    }
  }, IDLE_CHECK_MS);

  return {
    // activity: { page, kind, item, detail, fullscreen } from the window.
    set(activity) {
      if (!activity || typeof activity !== 'object') return;
      current = {
        page: String(activity.page || '').slice(0, 160),
        kind: String(activity.kind || '').slice(0, 40),
        item: String(activity.item || '').slice(0, 160),
        detail: String(activity.detail || '').slice(0, 160),
        fullscreen: Boolean(activity.fullscreen)
      };
      schedule();
    },
    // After signing in again, send the current screen even if it did not change.
    reset() {
      lastSent = '';
      schedule();
    }
  };
}

module.exports = { createActivityReporter };
