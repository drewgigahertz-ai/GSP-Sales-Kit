// QUOTATION tab: shows quotation.html in a frame and passes it what a quotation needs from the SalesKit data:
// every laptop (LAPTOP DB name, part number and specs; NEW PRICING cash price and promo, regular and per branch),
// each branch's details (LOGO sheet: logo, address, TIN, mobile, branch manager, Viber / FB QR codes), the
// Gigahertz logos, and the Reco Table's customer name and Exceed / Meet / Budget laptops. It also saves pictures on
// this laptop (so they show in the PDF), saves the PDF, and passes on Ctrl+1–5 and ?. Like the Flyers tab, the
// frame only talks through window messages, which are only accepted from that frame.
(function () {
  let latest = null;
  let customer = null;

  const frame = () => document.getElementById('quotationPageFrame');
  function send(message) {
    const target = frame();
    if (target && target.contentWindow) target.contentWindow.postMessage(message, '*');
  }

  const key = (value) => String(value || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const clean = (value) => {
    const text = String(value == null ? '' : value).trim();
    return text.startsWith('#') ? '' : text;
  };
  // "HP HP LAPTOP" (brand + a model that already starts with it) → "HP LAPTOP".
  const modelName = (value) => clean(value).replace(/^(\S+)\s+\1(?=\s|$)/i, '$1');
  const FULL_ACCESS = ['HO', 'ALL', 'ALL BRANCHES'];

  function build(data) {
    const bannerData = data.bannerData || {};
    const items = new Map((bannerData.items || []).map((item) => [key(item.itemCode), item]));
    const laptopDb = new Map((data.laptopDatabase || []).map((laptop) => [key(laptop.item), laptop]));
    const codes = new Map();
    for (const laptop of data.laptopDatabase || []) if (!laptop.endOfLife) codes.set(key(laptop.item), clean(laptop.item));
    for (const item of bannerData.items || []) if (item.hasPrice) codes.set(key(item.itemCode), clean(item.itemCode));

    const laptops = [...codes.entries()].map(([id, code]) => {
      const db = laptopDb.get(id) || null;
      const item = items.get(id) || null;
      const dbSpecs = (db && db.specs) || {};
      const guide = (item && item.specs) || {};
      const branchCash = {};
      const branchPromo = {};
      Object.entries((item && item.branchPrices) || {}).forEach(([branch, view]) => {
        if (view && view.hasPrice && view.cash != null) branchCash[key(branch)] = view.cash;
        if (view && view.promo && view.promo.name) branchPromo[key(branch)] = view.promo.name;
      });
      return {
        code,
        model: modelName(db && [db.brand, db.model].filter(Boolean).join(' ')) || modelName(item && item.brandModel) || code,
        partNumber: clean(db && db.partNumber) || clean(item && item.partNumber),
        specs: {
          Processor: clean(dbSpecs.Processor) || clean(guide.PROCESSOR),
          Graphics: clean(dbSpecs.Graphics) || clean(guide.GRAPHICS),
          Memory: clean(dbSpecs.Memory) || clean(guide.MEMORY),
          Storage: clean(dbSpecs.Storage) || clean(guide.STORAGE),
          Resolution: clean(dbSpecs.Resolution) || clean(guide.RESOLUTION),
          OS: clean(dbSpecs.OS) || clean(guide.OS)
        },
        cash: item && item.hasPrice ? item.cash : null,
        promo: (item && item.promo && item.promo.name) || '',
        branchCash,
        branchPromo
      };
    }).sort((a, b) => a.model.localeCompare(b.model));

    const branchDetails = data.branchDetails || {};
    const homeBranch = key(data.homeBranch);
    // Branch accounts make quotations for their own branch; head office (HO / ALL) chooses one.
    const lockBranch = Boolean(homeBranch) && !FULL_ACCESS.includes(homeBranch) && Boolean(branchDetails[homeBranch]);
    const branches = lockBranch ? [homeBranch] : Object.keys(branchDetails).filter((b) => branchDetails[b].address).sort();
    return {
      channel: 'saleskit-quotation-data',
      laptops,
      branchDetails,
      logos: { header: data.headerLogoUrl || '', blue: data.bannerLogoUrl || '' },
      homeBranch,
      branches,
      lockBranch
    };
  }

  const customerMessage = () => ({ channel: 'saleskit-quotation-customer', customer: customer && { name: customer.name || '', laptops: customer.laptops || {} } });

  // The Reco Table's customer (reco-customer.js): the name and the Exceed / Meet / Budget laptops.
  window.updateQuotationCustomer = function (next) {
    customer = next || null;
    send(customerMessage());
  };

  // Called by the page whenever SalesKit data is loaded or refreshed.
  window.updateQuotationPage = function (data) {
    latest = build(data || {});
    send(latest);
  };

  // The frame fills the window below the navigation.
  window.fitQuotationFrame = function () {
    const target = frame();
    if (!target || !target.offsetParent) return;
    const top = target.getBoundingClientRect().top;
    target.style.height = `${Math.max(420, window.innerHeight - top - 16)}px`;
  };
  window.addEventListener('resize', window.fitQuotationFrame);

  // A picture saved on this laptop (shows offline and can be drawn into the PDF), else its address.
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
    if (channel === 'saleskit-quotation-ready') {
      if (latest) send(latest);
      send(customerMessage());
    } else if (channel === 'saleskit-quotation-image') {
      const url = await savedPicture(String(event.data.url || ''));
      send({ channel: 'saleskit-quotation-image', requestId: event.data.requestId, url });
    } else if (channel === 'saleskit-quotation-save') {
      if (!window.saleskit || typeof window.saleskit.saveFiles !== 'function') return;
      try {
        const result = await window.saleskit.saveFiles(event.data.files || []);
        if (!result.canceled) send({ channel: 'saleskit-quotation-status', message: 'Quotation saved' });
      } catch (error) {
        send({ channel: 'saleskit-quotation-status', message: `Could not save the quotation: ${error.message || error}` });
      }
    } else if (channel === 'saleskit-quotation-hotkey') {
      if (typeof window.runSalesKitHotkey === 'function') window.runSalesKitHotkey(event.data.keys || {});
    } else if (channel === 'saleskit-quotation-help') {
      if (typeof window.openHotkeyHelp === 'function') window.openHotkeyHelp('quotation');
    }
  });
})();
