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

  // A price row's term prices: { noBundle: { cash, m3, … }, withBundle: { … }, bundleWorth }. A server older than
  // 1.0.48 sends no terms: then the ones it does send (cash, 3 months, Home Credit; 12 months with bundle).
  function termsOf(view) {
    if (view && view.terms && (view.terms.noBundle || view.terms.withBundle)) return view.terms;
    const detail = {};
    ((view && view.priceDetails) || []).forEach((d) => { if (d.isPrice && d.value != null) detail[d.title] = d.value; });
    const pick = (pairs) => Object.fromEntries(pairs.filter(([, value]) => value != null));
    return {
      noBundle: pick([['cash', detail.CNB], ['m3', detail['3NB']], ['hc', detail.HCNB]]),
      withBundle: pick([['cash', view && view.cash != null ? view.cash : detail.CWB], ['m3', detail['3WB']], ['m12', view && view.twelveMonths], ['hc', detail.HCB]]),
      bundleWorth: detail.B2 != null ? detail.B2 : undefined
    };
  }
  // The laptop's promos for the Promo dropdown: every NEW PRICING row (title, the branches it is for, its freebie
  // and term prices). A laptop with a price but no rows gets one from its regular price.
  function promoChoices(item) {
    if (!item) return [];
    const rows = (item.promoRows || []).filter((row) => row && row.hasPrice);
    const list = rows.length ? rows : (item.hasPrice ? [Object.assign({ title: (item.promo && item.promo.name) || 'NO PROMO', branch: '' }, item)] : []);
    return list.map((row) => ({
      title: clean(row.title) || 'NO PROMO',
      freebie: (row.promo && row.promo.name) || '',
      branches: String(row.branch || '').split(',').map(key).filter(Boolean),
      terms: termsOf(row)
    }));
  }

  // Desktops, mobiles and attachments (other-prices.js: ATTACHMENT PRICING, DESKTOP PRICING SUMMARY, PM MOBILE VER 2.5).
  // Their specs are read from the name ("… i5-1240P 1TB + 256GB SSD 8GB WIN11s", "CEL-… (12+256GB) …"); an
  // attachment shows its category. Attachments have two price sets: with a laptop (withBundle) and regular (noBundle).
  const KIND_LABELS = { desktop: 'Desktop', mobile: 'Mobile', attachment: 'Accessory' };
  function specsFromName(name) {
    const n = ` ${name} `;
    const pick = (re) => (n.match(re) || [])[1] || '';
    const phone = n.match(/\((\d+)\s*\+\s*(\d+\s*(?:GB|TB))\)/i);
    return {
      Processor: pick(/\s((?:i[3579]|R[3579]|Ultra\s?[579]|Core\s?[3579]|Ryzen\s?[3579])[-\s]?[\w-]*\d\w*)\s/i),
      Graphics: pick(/\s((?:RTX|GTX|MX|RX)\s?\d{3,4}\w*(?:\/\d+GB)?)\s/i),
      Memory: phone ? `${phone[1]}GB` : pick(/SSD\s+(\d+GB)(?:\s|$)/i),
      Storage: phone ? phone[2].replace(/\s/g, '') : pick(/\s(\d+\s?(?:GB|TB)(?:\s?\+\s?\d+\s?(?:GB|TB))?\s?(?:SSD|HDD))\s/i),
      OS: pick(/\s(WIN(?:DOWS)?\s?1[01]\w*)\s/i).replace(/^WIN\s?(1[01])\w*$/i, 'WINDOWS $1')
    };
  }
  function otherChoices(products, taken) {
    return products.filter((p) => !taken.has(key(p.item))).map((p) => {
      const terms = p.terms || {};
      const name = clean(p.item);
      const specs = p.kind === 'attachment' ? {} : specsFromName(name);
      // A desktop's model is its name up to its processor (the specs are listed beside it).
      let model = name.replace(/^[A-Z]{2,12}-(?=\S)/, '');
      const cut = specs.Processor ? model.indexOf(` ${specs.Processor}`) : -1;
      if (p.kind === 'desktop' && cut > 8) model = model.slice(0, cut).replace(/\s+CORE$/i, '').trim();
      return {
        code: name,
        kind: p.kind,
        kindLabel: p.kind === 'attachment' ? (clean(p.category) || KIND_LABELS.attachment) : (clean(p.category) || KIND_LABELS[p.kind] || ''),
        category: clean(p.category),
        // "DESKTOP-ACER AIO C24-195ES ULTRA 5 125U …" → "ACER AIO C24-195ES"
        model,
        partNumber: '',
        specs,
        details: p.kind === 'attachment' ? [clean(p.category) && `Category - ${clean(p.category)}`].filter(Boolean) : [],
        cash: (terms.noBundle && terms.noBundle.cash) || (terms.withBundle && terms.withBundle.cash) || null,
        promo: clean(p.promo),
        branchCash: {},
        branchPromo: {},
        promos: [{ title: clean(p.promo) || 'NO PROMO', freebie: '', branches: [], terms }]
      };
    }).sort((a, b) => a.model.localeCompare(b.model));
  }

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
        branchPromo,
        promos: promoChoices(item)
      };
    }).sort((a, b) => a.model.localeCompare(b.model));
    laptops.push(...otherChoices(data.otherProducts || [], new Set(laptops.map((l) => key(l.code)))));

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
