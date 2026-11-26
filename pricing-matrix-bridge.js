// PRICING MATRIX tab: shows pricing-matrix.html in a frame and passes it every product's prices from the SalesKit
// data, for every branch (no branch filter): laptops (NEW PRICING MATRIX V3, every promo row with its branches,
// freebies and term prices; name, part number and specs from LAPTOP DB), desktops, accessories and mobiles (the
// price matrix's other tabs), and each promo's dates, incentives and vendor freebies (pricingExtras, server 1.0.55).
// Like the Quotation tab, the frame only talks through window messages, which are only accepted from that frame.
(function () {
  let latest = null;

  const frame = () => document.getElementById('pricingPageFrame');
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
  const KIND_LABELS = { laptop: 'Laptop', desktop: 'Desktop', attachment: 'Attachment / Peripheral / Accessory', mobile: 'Mobile' };

  // A price row's term prices: { noBundle: { cash, m3, … }, withBundle: { … }, bundleWorth }.
  function termsOf(view) {
    if (view && view.terms && (view.terms.noBundle || view.terms.withBundle)) return view.terms;
    const pick = (pairs) => Object.fromEntries(pairs.filter(([, value]) => value != null));
    return { noBundle: {}, withBundle: pick([['cash', view && view.cash], ['m12', view && view.twelveMonths]]) };
  }
  // The bundle's name: the price matrix's BUNDLE CODE ("BUND739", "BUND1013 SET B"), sent in the price details as CF.
  // Some promos (MIX & MATCH PROMO) have an amount there instead of a code: their bundle is named by the promo.
  function bundleOf(view, promoTitle) {
    const cf = ((view && view.priceDetails) || []).find((d) => d.title === 'CF');
    const name = clean(cf && cf.value);
    if (name && !/^[\d.,\s]+$/.test(name)) return name;
    const worth = view && view.terms && view.terms.bundleWorth;
    return worth && promoTitle && !/^no promo$/i.test(promoTitle) ? promoTitle : '';
  }
  // "Apr 1, 2026 – Jun 30, 2026" (the Banner's promo dates) → ['2026-04-01', '2026-06-30'].
  function isoDates(label) {
    return String(label || '').split('–').map((part) => {
      const d = new Date(part.trim());
      return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
  }

  function build(data) {
    const extras = data.pricingExtras || {};
    const extraOf = (kind, item, promo) => extras[`${kind}|${key(item)}|${key(promo === 'NO PROMO' ? '' : promo)}`] || null;
    const laptopDb = new Map((data.laptopDatabase || []).map((laptop) => [key(laptop.item), laptop]));
    const products = [];

    for (const item of (data.bannerData && data.bannerData.items) || []) {
      const rows = (item.promoRows || []).filter((row) => row && row.hasPrice);
      if (!rows.length) continue;
      const db = laptopDb.get(key(item.itemCode)) || {};
      const specs = db.specs || {};
      const guide = item.specs || {};
      // Units per branch: the inventory CSV's (on the Banner data), else LAPTOP DB's.
      const stock = {};
      Object.entries((item.stock && Object.keys(item.stock).length ? item.stock : db.stock) || {})
        .forEach(([branch, units]) => { if (Number(units) > 0) stock[key(branch)] = Number(units); });
      products.push({
        id: `laptop|${key(item.itemCode)}`,
        kind: 'laptop',
        stock,
        kindLabel: 'Laptop',
        code: clean(item.itemCode),
        model: modelName([db.brand, db.model].filter(Boolean).join(' ')) || modelName(item.brandModel) || clean(item.itemCode),
        partNumber: clean(db.partNumber) || clean(item.partNumber),
        brand: clean(db.brand || item.brand),
        category: clean(item.segment),
        specs: [
          ['Processor', clean(specs.Processor) || clean(guide.PROCESSOR)],
          ['Graphics', clean(specs.Graphics) || clean(guide.GRAPHICS)],
          ['Memory', clean(specs.Memory) || clean(guide.MEMORY)],
          ['Storage', clean(specs.Storage) || clean(guide.STORAGE)],
          ['Display', clean(specs.Resolution) || clean(guide.RESOLUTION)],
          ['OS', clean(specs.OS) || clean(guide.OS)]
        ].filter(([, value]) => value),
        promos: rows.map((row) => {
          const title = clean(row.title) || 'NO PROMO';
          const extra = extraOf('laptop', item.itemCode, title) || {};
          const [start, end] = extra.start || extra.end ? [extra.start, extra.end] : isoDates(row.dates);
          const pictures = (row.promo && row.promo.pictures) || [];
          // The promo's freebies: its pictures' names, else its TOTAL PROMO text ("BUNDLE PROMO + GCASH VOUCHER 5,000")
          // split at "+", without the promo title and the vendor freebies (they have their own box).
          const vendorKeys = new Set((extra.vendor || []).map((v) => key(v.text)));
          const named = (pictures.length ? pictures.map((p) => p.name) : [row.promo && row.promo.name])
            .flatMap((name) => String(name || '').split('+')).map(clean);
          const freebies = [...new Set(named.filter((name) => name && !/^no promo$/i.test(name) && key(name) !== key(title) && !vendorKeys.has(key(name))))];
          return {
            title,
            branches: String(row.branch || '').split(',').map(key).filter(Boolean),
            freebies,
            bundle: bundleOf(row, title),
            terms: termsOf(row),
            start: start || '',
            end: end || '',
            incentive: extra.incentive || '',
            incentiveValidity: extra.incentiveValidity || '',
            vendor: extra.vendor || []
          };
        })
      });
    }

    const taken = new Set(products.map((p) => key(p.code)));
    // A product on two tabs (ATTACHMENT PRICING also lists some desktops) keeps its own tab's prices: desktops and
    // mobiles first, then accessories.
    const order = { desktop: 0, mobile: 1, attachment: 2 };
    const others = [...(data.otherProducts || [])].sort((a, b) => (order[a && a.kind] ?? 3) - (order[b && b.kind] ?? 3));
    for (const p of others) {
      if (!p || !p.item || taken.has(key(p.item))) continue;
      taken.add(key(p.item));
      const title = clean(p.promo) || 'NO PROMO';
      const extra = extraOf(p.kind, p.item, title) || {};
      const name = clean(p.item).replace(/^[A-Z]{2,12}-(?=\S)/, '');
      products.push({
        id: `${p.kind}|${key(p.item)}`,
        kind: p.kind,
        kindLabel: KIND_LABELS[p.kind] || 'Product',
        code: clean(p.item),
        model: name,
        partNumber: '',
        brand: (name.match(/^[A-Z0-9]+/i) || [''])[0],
        category: clean(p.category),
        specs: [],
        promos: [{
          title,
          branches: [],
          freebies: [],
          terms: p.terms || {},
          start: extra.start || '',
          end: extra.end || '',
          incentive: extra.incentive || '',
          incentiveValidity: extra.incentiveValidity || '',
          vendor: extra.vendor || []
        }]
      });
    }
    products.sort((a, b) => a.model.localeCompare(b.model));
    return {
      channel: 'saleskit-pricing-data',
      products,
      updatedAt: data.dataUpdatedAt || '',
      hasExtras: Object.keys(extras).length > 0,
      // Branch stock shows only when the server has stock counts; the account's branch is listed first.
      hasStock: products.some((p) => p.stock && Object.keys(p.stock).length),
      stockAsOf: data.inventoryAsOf || '',
      homeBranch: key(data.homeBranch)
    };
  }

  // Called by the page whenever SalesKit data is loaded or refreshed.
  window.updatePricingPage = function (data) {
    latest = build(data || {});
    send(latest);
  };

  // The frame fills the window below the navigation.
  window.fitPricingFrame = function () {
    const target = frame();
    if (!target || !target.offsetParent) return;
    const top = target.getBoundingClientRect().top;
    target.style.height = `${Math.max(420, window.innerHeight - top - 16)}px`;
  };
  window.addEventListener('resize', window.fitPricingFrame);

  window.addEventListener('message', async (event) => {
    const target = frame();
    if (!target || event.source !== target.contentWindow || !event.data) return;
    const { channel } = event.data;
    if (channel === 'saleskit-pricing-ready') {
      if (latest) send(latest);
    } else if (channel === 'saleskit-pricing-copy') {
      try {
        await navigator.clipboard.writeText(String(event.data.text || ''));
        send({ channel: 'saleskit-pricing-status', message: 'Copied' });
      } catch {
        send({ channel: 'saleskit-pricing-status', message: 'Could not copy' });
      }
    } else if (channel === 'saleskit-pricing-quote') {
      // "Add to Quotation": the product with the promo, price set and term on screen (quotation-bridge.js).
      if (typeof window.addToQuotation === 'function') window.addToQuotation(Object.assign({}, event.data.request, { from: 'Pricing Matrix' }));
    } else if (channel === 'saleskit-pricing-hotkey') {
      if (typeof window.runSalesKitHotkey === 'function') window.runSalesKitHotkey(event.data.keys || {});
    } else if (channel === 'saleskit-pricing-help') {
      if (typeof window.openHotkeyHelp === 'function') window.openHotkeyHelp('pricing');
    }
  });
})();
