// FLYERS tab: shows flyer.html in a frame and passes it what a branch flyer needs from the SalesKit data:
// RECO TABLE rows (branch, target market, tag, laptop), each laptop's model, picture (SPECS), brand logo
// (DB PHOTOS), specs (BANNER SPECS) and prices (NEW PRICING, regular and per branch), each branch's logo, store
// name and address (LOGO sheet), and the Gigahertz logos. It also saves the pictures on this laptop, saves the
// downloaded PDF / PNG pages, and passes on Refresh data, Ctrl+1–4 and ?. It also passes the Reco Table's customer
// (name, segment, three laptops, applications) for the flyer's "Prepared for" section. Like the Banner tab, the
// frame only talks through window messages, which are only accepted from that frame.
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

  // The server's matchKey (banner-data.js), for bannerData.extraPrices.
  const priceKey = (value) => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

  // A laptop as the flyer shows it: model, part number, picture, brand logo, specs and prices. Name, part number
  // and specs come from LAPTOP DATABASE (GST PRICING); a laptop not in it, or a blank cell there, falls back to
  // LAPTOP RAW / BANNER SPECS and SPECS. Prices come from NEW PRICING, also for laptops not in LAPTOP RAW.
  function laptopEntry(itemCode, { items, specsMap, laptopDb, extraPrices }) {
    const item = items.get(key(itemCode)) || null;
    const db = laptopDb.get(key(itemCode)) || null;
    const priced = item || extraPrices[priceKey(itemCode)] || null;
    const lower = itemCode.toLowerCase();
    const spec = specsMap[lower] || specsMap[lower.replace(/^lap[-_\s]*/, '')] || null;
    const guide = (item && item.specs) || {};
    const dbSpecs = (db && db.specs) || {};
    return {
      model: modelName(db && [db.brand, db.model].filter(Boolean).join(' '))
        || modelName(item && item.brandModel) || modelName(spec && spec.title) || itemCode,
      partNumber: clean(db && db.partNumber) || clean(spec && spec.modelCode),
      picture: (spec && spec.image) || '',
      brandLogo: (priced && priced.brandPicture) || '',
      specs: {
        Processor: clean(dbSpecs.Processor) || clean(guide.PROCESSOR) || clean(spec && spec.cpu),
        Graphics: clean(dbSpecs.Graphics) || clean(guide.GRAPHICS) || clean(spec && spec.graphics),
        Storage: clean(dbSpecs.Storage) || clean(guide.STORAGE) || clean(spec && spec.storage),
        Memory: clean(dbSpecs.Memory) || clean(guide.MEMORY) || clean(spec && spec.memory),
        Resolution: clean(dbSpecs.Resolution) || clean(guide.RESOLUTION) || clean(spec && spec.resolution),
        OS: clean(dbSpecs.OS) || clean(guide.OS)
      },
      // For the flyer's checklist.
      inLaptopDatabase: Boolean(db),
      endOfLife: Boolean(db && db.endOfLife),
      prices: price(priced),
      branchPrices: Object.fromEntries(Object.entries((priced && priced.branchPrices) || {})
        .map(([branch, view]) => [key(branch), price(view)]).filter(([, view]) => view)),
      // Every NEW PRICING row of the laptop, for the promo picker on its card (flyer-promos.js).
      promoRows: ((priced && priced.promoRows) || []).filter((row) => row.hasPrice).map((row) => ({
        title: row.title, branch: row.branch || '', dates: row.dates || '', cash: row.cash, twelveMonths: row.twelveMonths
      }))
    };
  }

  function lookups(data) {
    const bannerData = data.bannerData || {};
    return {
      items: new Map((bannerData.items || []).map((item) => [key(item.itemCode), item])),
      specsMap: data.specsMap || {},
      laptopDb: new Map((data.laptopDatabase || []).map((laptop) => [key(laptop.item), laptop])),
      extraPrices: bannerData.extraPrices || {}
    };
  }

  function build(data) {
    const rows = (data.recoTableData || []).map((row) => ({
      branch: clean(row.BR || row.Branch),
      market: clean(row['TARGET MARKET']),
      tag: clean(row.TAG),
      item: clean(row['ITEM DESCRIPTION'])
    })).filter((row) => row.branch && row.item);

    const lookup = lookups(data);
    const laptops = {};
    rows.forEach((row) => {
      const id = key(row.item);
      if (!laptops[id]) laptops[id] = laptopEntry(row.item, lookup);
    });

    return {
      channel: 'saleskit-flyer-data',
      rows,
      laptops,
      branchDetails: data.branchDetails || {},
      // B2: the white header logo; C2: the blue one, used when a branch has no logo of its own.
      logos: { header: data.headerLogoUrl || '', blue: data.bannerLogoUrl || '' },
      homeBranch: data.homeBranch || '',
      // False with a server older than LAPTOP DATABASE (the checklist then does not flag laptops missing from it).
      hasLaptopDatabase: Boolean((data.laptopDatabase || []).length)
    };
  }

  // The Reco Table's customer (reco-customer.js): { name, hierarchy, segment, laptops: { exceed, meet, budget },
  // apps }. The flyer shows a "Prepared for" section at the top while a name is entered; the three laptops are sent
  // with it (they may not be in RECO TABLE).
  let lastData = null;
  let customer = null;
  function customerMessage() {
    const laptops = {};
    if (customer && lastData) {
      const lookup = lookups(lastData);
      Object.values(customer.laptops || {}).filter(Boolean).forEach((itemCode) => {
        laptops[key(itemCode)] = laptopEntry(itemCode, lookup);
      });
    }
    return { channel: 'saleskit-flyer-customer', customer, laptops };
  }

  window.updateFlyerCustomer = function (next) {
    customer = next || null;
    send(customerMessage());
  };

  // Called by the page whenever SalesKit data is loaded or refreshed.
  window.updateFlyerPage = function (data) {
    lastData = data || {};
    latest = build(lastData);
    send(latest);
    send(customerMessage());
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
      send(customerMessage());
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
    } else if (channel === 'saleskit-flyer-customer-name') {
      // The customer name typed on the flyer: the Reco Table's box follows (without sending it back).
      const name = String(event.data.name || '').slice(0, 60);
      if (customer) customer = { ...customer, name };
      if (window.RecoCustomer) window.RecoCustomer.setName(name);
    } else if (channel === 'saleskit-flyer-hotkey') {
      // Ctrl+1–4 pressed while the Flyers page has the keyboard (see hotkeys.js).
      if (typeof window.runSalesKitHotkey === 'function') window.runSalesKitHotkey(event.data.keys || {});
    } else if (channel === 'saleskit-flyer-help') {
      if (typeof window.openHotkeyHelp === 'function') window.openHotkeyHelp('flyers');
    }
  });
})();
