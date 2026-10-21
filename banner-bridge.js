// BANNER tab: shows banner.html in a frame and passes it the banner data (bannerData from the server),
// the pictures saved on this laptop, and "Refresh data" requests. The frame has no access to the app
// itself, so everything goes through window messages, which are only accepted from that frame.
(function () {
  let latestBannerData = null;
  let homeBranch = '';
  let refreshTimer = null;

  function frame() {
    return document.getElementById('bannerPageFrame');
  }

  // Logos from the LOGO sheet, as saved on this laptop when available: C2 is the Banner logo (shown in its
  // own colors); B2, the white header logo, is used in the banner blue when C2 is empty or cannot be shown.
  function logo() {
    const data = window.SERVER_INITIAL_DATA || {};
    return { banner: data.bannerLogoUrl || '', header: data.headerLogoUrl || '' };
  }

  function send(message) {
    const target = frame();
    if (target && target.contentWindow) target.contentWindow.postMessage(message, '*');
  }

  // Called by the page whenever SalesKit data is loaded or refreshed. branch: the account's home branch
  // (empty for HO and ALL accounts).
  window.updateBannerPage = function (bannerData, branch) {
    latestBannerData = bannerData || { items: [] };
    homeBranch = branch || '';
    send({ channel: 'saleskit-banner-data', data: latestBannerData, logo: logo(), homeBranch });
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
      send({ channel: 'saleskit-banner-status', message: `Updated ${new Date().toLocaleTimeString()}`, busy: false });
    }
  };

  // The frame fills the window below the navigation.
  window.fitBannerFrame = function () {
    const target = frame();
    if (!target || !target.offsetParent) return;
    const top = target.getBoundingClientRect().top;
    target.style.height = `${Math.max(420, window.innerHeight - top - 16)}px`;
  };
  window.addEventListener('resize', window.fitBannerFrame);

  async function savedPicture(url) {
    if (!/^https:\/\//i.test(url || '')) return url || '';
    if (!window.saleskit || typeof window.saleskit.cacheImage !== 'function') return url;
    try {
      return (await window.saleskit.cacheImage(url)) || url;
    } catch {
      return url;
    }
  }

  window.addEventListener('message', async (event) => {
    const target = frame();
    if (!target || event.source !== target.contentWindow || !event.data) return;
    const { channel } = event.data;
    if (channel === 'saleskit-banner-ready') {
      if (latestBannerData) send({ channel: 'saleskit-banner-data', data: latestBannerData, logo: logo(), homeBranch });
    } else if (channel === 'saleskit-banner-hotkey') {
      // Ctrl+1 / Ctrl+2 pressed while the Banner page has the keyboard (see hotkeys.js).
      if (typeof window.runSalesKitHotkey === 'function') window.runSalesKitHotkey(event.data.keys || {});
    } else if (channel === 'saleskit-banner-activity') {
      // What the Banner page shows, for the server's Devices tab (see activity-tracker.js).
      window.bannerPageScreen = event.data.activity || null;
      if (typeof window.reportScreen === 'function') window.reportScreen();
    } else if (channel === 'saleskit-banner-image') {
      const url = await savedPicture(String(event.data.url || ''));
      send({ channel: 'saleskit-banner-image', requestId: event.data.requestId, url });
    } else if (channel === 'saleskit-banner-refresh') {
      if (typeof window.refreshAllData !== 'function') return;
      send({ channel: 'saleskit-banner-status', message: 'Refreshing…', busy: true });
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        send({ channel: 'saleskit-banner-status', message: 'Could not refresh. Check the connection to the server.', busy: false });
      }, 90 * 1000);
      window.refreshAllData({ silent: false });
    }
  });
})();
