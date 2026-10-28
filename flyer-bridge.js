// FLYERS tab: shows flyer.html in a frame and passes it what a branch flyer needs from the SalesKit data:
// RECO TABLE rows (branch, target market, tag, laptop), each laptop's model, picture (SPECS), brand logo
// (DB PHOTOS), specs (BANNER SPECS) and prices (NEW PRICING, regular and per branch), each branch's logo, store
// name and address (LOGO sheet), and the Gigahertz logos. It also saves the pictures on this laptop, saves the
// downloaded PDF / PNG pages, and passes on Refresh data, Ctrl+1–4 and ?. Like the Banner tab, the frame only
// talks through window messages, which are only accepted from that frame.
(function () {
  let latest = null;
  let refreshTimer = null;

  function frame() {
    return document.getElementById('flyerPageFrame');
  }

  function send(message) {
    const target = frame();
    if (target && target.contentWindow) target.contentWindow.postMessage(message, '*');
  }

  const key = (value) => String(value || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const clean = (value) => {
    const text = String(value == null ? '' : value).trim();
    return text.startsWith('#') ? '' : text;
  };
  const price = (view) => (view && view.hasPrice ? { cash: view.cash, twelveMonths: view.twelveMonths } : null);
  // "HP HP LAPTOP" (brand + a model that already starts with it) → "HP LAPTOP".
  const modelName = (value) => clean(value).replace(/^(\S+)\s+\1(?=\s|$)/i, '$1');

  function build(data) {
    const rows = (data.recoTableData || []).map((row) => ({
      branch: clean(row.BR || row.Branch),
      market: clean(row['TARGET MARKET']),
      tag: clean(row.TAG),
      item: clean(row['ITEM DESCRIPTION'])
    })).filter((row) => row.branch && row.item);

    const items = new Map(((data.bannerData && data.bannerData.items) || []).map((item) => [key(item.itemCode), item]));
    const specsMap = data.specsMap || {};
    const laptops = {};
    rows.forEach((row) => {
      const id = key(row.item);
      if (laptops[id]) return;
      const item = items.get(id) || null;
      const lower = row.item.toLowerCase();
      const spec = specsMap[lower] || specsMap[lower.replace(/^lap[-_\s]*/, '')] || null;
      const guide = (item && item.specs) || {};
      laptops[id] = {
        model: modelName(item && item.brandModel) || modelName(spec && spec.title) || row.item,
        partNumber: clean(spec && spec.modelCode),
        picture: (spec && spec.image) || '',
        brandLogo: (item && item.brandPicture) || '',
        specs: {
          Processor: clean(guide.PROCESSOR) || clean(spec && spec.cpu),
          Graphics: clean(guide.GRAPHICS) || clean(spec && spec.graphics),
          Storage: clean(guide.STORAGE) || clean(spec && spec.storage),
          Memory: clean(guide.MEMORY) || clean(spec && spec.memory),
          Resolution: clean(guide.RESOLUTION) || clean(spec && spec.resolution),
          OS: clean(guide.OS)
        },
        prices: price(item),
        branchPrices: Object.fromEntries(Object.entries((item && item.branchPrices) || {})
          .map(([branch, view]) => [key(branch), price(view)]).filter(([, view]) => view))
      };
    });

    return {
      channel: 'saleskit-flyer-data',
      rows,
      laptops,
      branchDetails: data.branchDetails || {},
      // B2: the white header logo; C2: the blue one, used when a branch has no logo of its own.
      logos: { header: data.headerLogoUrl || '', blue: data.bannerLogoUrl || '' },
      homeBranch: data.homeBranch || ''
    };
  }

  // Called by the page whenever SalesKit data is loaded or refreshed.
  window.updateFlyerPage = function (data) {
    latest = build(data || {});
    send(latest);
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
      send({ channel: 'saleskit-flyer-status', message: `Updated ${new Date().toLocaleTimeString()}`, busy: false });
    }
  };

  // The frame fills the window below the navigation.
  window.fitFlyerFrame = function () {
    const target = frame();
    if (!target || !target.offsetParent) return;
    const top = target.getBoundingClientRect().top;
    target.style.height = `${Math.max(420, window.innerHeight - top - 16)}px`;
  };
  window.addEventListener('resize', window.fitFlyerFrame);

  // A picture saved on this laptop (shows offline and can be drawn into downloads), else its address.
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
    if (channel === 'saleskit-flyer-ready') {
      if (latest) send(latest);
    } else if (channel === 'saleskit-flyer-image') {
      const url = await savedPicture(String(event.data.url || ''));
      send({ channel: 'saleskit-flyer-image', requestId: event.data.requestId, url });
    } else if (channel === 'saleskit-flyer-save') {
      if (!window.saleskit || typeof window.saleskit.saveFiles !== 'function') return;
      try {
        const result = await window.saleskit.saveFiles(event.data.files || []);
        if (!result.canceled) {
          const count = result.files.length;
          send({ channel: 'saleskit-flyer-status', message: count > 1 ? `${count} pages saved` : 'Flyer saved', busy: false });
        }
      } catch (error) {
        send({ channel: 'saleskit-flyer-status', message: `Could not save the flyer: ${error.message || error}`, busy: false });
      }
    } else if (channel === 'saleskit-flyer-refresh') {
      if (typeof window.refreshAllData !== 'function') return;
      send({ channel: 'saleskit-flyer-status', message: 'Refreshing…', busy: true });
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        send({ channel: 'saleskit-flyer-status', message: 'Could not refresh. Check the connection to the server.', busy: false });
      }, 90 * 1000);
      window.refreshAllData({ silent: false });
    } else if (channel === 'saleskit-flyer-hotkey') {
      // Ctrl+1–4 pressed while the Flyers page has the keyboard (see hotkeys.js).
      if (typeof window.runSalesKitHotkey === 'function') window.runSalesKitHotkey(event.data.keys || {});
    } else if (channel === 'saleskit-flyer-help') {
      if (typeof window.openHotkeyHelp === 'function') window.openHotkeyHelp('flyers');
    }
  });
})();
