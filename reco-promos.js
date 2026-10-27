// Reco Table cards: when a laptop has more than one promo row in the pricing sheet, its price works as a quiet
// dropdown (a small chevron after it): clicking it lists every promo title with its cash price. The card's price
// stays the one the app picked (a dated promo first, else the upper row). The click is an attribute and the list a
// <details> element, so both still work in the presentation's copy of the result.
(function () {
  const style = document.createElement('style');
  style.textContent = `
    .reco-price-tag.has-promos {
      cursor: pointer;
    }

    .reco-price-tag.has-promos::after {
      content: '\\F282';
      margin-left: 4px;
      font-family: 'bootstrap-icons';
      font-size: 0.6em;
      vertical-align: middle;
      opacity: .35;
      transition: opacity .15s, transform .15s;
      display: inline-block;
    }

    .reco-price-tag.has-promos:hover::after {
      opacity: .8;
    }

    .reco-price-tag.has-promos.is-open::after {
      transform: rotate(180deg);
      opacity: .8;
    }

    .reco-promos {
      font-size: 0.74rem;
      text-align: center;
    }

    .reco-promos[hidden] {
      display: none;
    }

    .reco-promos summary {
      display: none;
    }

    .reco-promos ul {
      margin: 6px auto 0;
      padding: 6px 10px;
      max-width: 320px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #fff;
      list-style: none;
      text-align: left;
      box-shadow: 0 6px 16px rgba(15, 23, 42, .08);
    }

    .reco-promos li {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding: 3px 0;
      border-bottom: 1px dashed #e2e8f0;
      color: #334155;
    }

    .reco-promos li:last-child {
      border-bottom: 0;
    }

    .reco-promos li.is-shown {
      color: #0012b3;
      font-weight: 700;
    }

    .reco-promos li small {
      display: block;
      color: #94a3b8;
      font-weight: 500;
    }

    .reco-promos .promo-price {
      flex: none;
      font-weight: 700;
      white-space: nowrap;
    }
  `;
  document.head.appendChild(style);

  const key = (value) => String(value || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const peso = (value) => (value === null || value === undefined || value === '' ? '—' : `₱${Number(value).toLocaleString('en-PH')}`);

  // The laptop's promo rows that apply at the selected branch (rows for every branch, or naming this branch).
  function promoRowsFor(prod) {
    let items = [];
    let branch = '';
    try {
      items = (window.sheetData && window.sheetData.bannerData && window.sheetData.bannerData.items) || [];
      branch = key(selectedLocation);
    } catch {}
    // Item codes compared without the "LAP-" prefix, spacing or punctuation (as elsewhere in SalesKit).
    const same = (value) => (typeof normalizeSmtSku === 'function' ? normalizeSmtSku(value) : key(value));
    const wanted = same(prod && (prod.sku || prod.cleanSku));
    const item = wanted && items.find((entry) => same(entry.itemCode) === wanted);
    if (!item || !Array.isArray(item.promoRows)) return { item: null, rows: [] };
    const rows = item.promoRows.filter((row) => !row.branch
      || row.branch.split(',').map(key).includes(branch));
    return { item, rows };
  }

  // Called for each tier (exceed, meet, budget) whenever its laptop is set; prod is null for an empty card.
  function show(tier, prod) {
    const cap = tier.charAt(0).toUpperCase() + tier.slice(1);
    const priceElement = document.getElementById('price' + cap);
    const tag = priceElement && priceElement.closest('.reco-price-tag');
    if (!tag) return;
    let note = document.getElementById('promos' + cap);
    if (!note) {
      note = document.createElement('details');
      note.id = 'promos' + cap;
      note.className = 'reco-promos';
      tag.insertAdjacentElement('afterend', note);
    }
    const { item, rows } = prod ? promoRowsFor(prod) : { item: null, rows: [] };
    note.open = false;
    tag.classList.remove('is-open');
    const several = rows.length > 1;
    tag.classList.toggle('has-promos', several);
    if (several) {
      tag.setAttribute('onclick', 'RecoPromos.toggle(this)');
      tag.title = `${rows.length} promos`;
    } else {
      tag.removeAttribute('onclick');
      tag.removeAttribute('title');
    }
    if (!several) {
      note.hidden = true;
      note.replaceChildren();
      return;
    }
    note.hidden = false;
    const summary = document.createElement('summary');
    summary.textContent = `${rows.length} promos`;
    const list = document.createElement('ul');
    // The row whose prices the card shows (the first one with the same prices).
    const shown = rows.find((row) => row.cash === item.cash && row.srp === item.srp && row.twelveMonths === item.twelveMonths);
    rows.forEach((row) => {
      const entry = document.createElement('li');
      if (row === shown) entry.classList.add('is-shown');
      const name = document.createElement('span');
      name.textContent = row.title;
      if (row.dates) {
        const dates = document.createElement('small');
        dates.textContent = row.dates;
        name.appendChild(dates);
      }
      const price = document.createElement('span');
      price.className = 'promo-price';
      price.textContent = peso(row.cash);
      entry.append(name, price);
      list.appendChild(entry);
    });
    note.replaceChildren(summary, list);
  }

  // The price was clicked: open or close its list (the <details> right after it).
  function toggle(tag) {
    const note = tag.nextElementSibling;
    if (!note || !note.classList.contains('reco-promos')) return;
    note.open = !note.open;
    tag.classList.toggle('is-open', note.open);
  }

  window.RecoPromos = { show, toggle };
})();
