// Reco Table, from the DB sheet (window.RECO_DB_DATA: J TAG, K ITEM DESCRIPTION, M BRANCH, O hierarchy): for the
// selected branch and segment, each tier starts on DB's EXCEED / MEET / BUDGET laptop, in SMT and OSD alike.
// The sidebar dropdowns list every laptop in stock; on the result card the laptop's name works as a quiet
// dropdown (a small chevron after it) listing the recommended laptop and its ALTERNATIVE rows with their stock,
// and picking one puts it on the card. Without DB rows for the branch and segment, nothing changes.
(function () {
  const style = document.createElement('style');
  style.textContent = `
    .reco-model-title.has-alts {
      cursor: pointer;
    }

    .reco-model-title.has-alts::after {
      content: '\\F282';
      margin-left: 5px;
      font-family: 'bootstrap-icons';
      font-size: 0.55em;
      vertical-align: middle;
      opacity: .35;
      transition: opacity .15s, transform .15s;
      display: inline-block;
    }

    .reco-model-title.has-alts:hover::after,
    .reco-model-title.has-alts.is-open::after {
      opacity: .85;
    }

    .reco-model-title.has-alts.is-open::after {
      transform: rotate(180deg);
    }

    .reco-capturing .reco-model-title.has-alts::after {
      display: none;
    }

    .reco-alts-menu {
      position: fixed;
      z-index: 2000;
      min-width: 300px;
      max-width: 420px;
      max-height: 340px;
      overflow-y: auto;
      margin: 0;
      padding: 4px 0;
      list-style: none;
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      box-shadow: 0 10px 24px rgba(15, 23, 42, .14);
      font-size: 0.78rem;
      color: #334155;
      text-align: left;
    }

    .reco-alts-menu[hidden] {
      display: none;
    }

    .reco-alts-menu .alts-head {
      padding: 6px 12px 4px;
      color: #94a3b8;
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: .4px;
      text-transform: uppercase;
    }

    .reco-alts-menu button {
      display: flex;
      width: 100%;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 6px 12px;
      border: 0;
      background: none;
      font: inherit;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }

    .reco-alts-menu button:hover:not(:disabled),
    .reco-alts-menu button:focus-visible {
      background: #f1f5ff;
      outline: none;
    }

    .reco-alts-menu button:disabled {
      cursor: default;
      opacity: .5;
    }

    .reco-alts-menu button.is-shown {
      color: #0012b3;
      font-weight: 700;
    }

    .reco-alts-menu small {
      display: block;
      color: #94a3b8;
      font-weight: 500;
    }

    .reco-alts-menu .alts-stock {
      flex: none;
      font-size: 0.68rem;
      font-weight: 700;
      white-space: nowrap;
      color: #15803d;
    }

    .reco-alts-menu button:disabled .alts-stock {
      color: #94a3b8;
    }
  `;
  document.head.appendChild(style);

  const TIERS = { exceed: 'EXCEED', meet: 'MEET', budget: 'BUDGET' };
  const key = (value) => String(value || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const same = (a, b) => normalizeSmtSku(a) === normalizeSmtSku(b);
  let menu = null;
  let openTitle = null;

  function branchCode() {
    const branch = key(selectedLocation);
    return branch && branch !== 'IF APPLICABLE' && branch !== 'ALL' ? branch : '';
  }

  // DB rows of the selected branch and segment for a tier: the recommended row first, then its alternatives.
  function dbRows(tier, hierarchy) {
    const branch = branchCode();
    const rows = Array.isArray(window.RECO_DB_DATA) ? window.RECO_DB_DATA : [];
    if (!branch || !TIERS[tier]) return [];
    const mine = rows.filter((row) => key(row.branch) === branch && Number(row.hierarchy) === Number(hierarchy) && row.item);
    return [
      ...mine.filter((row) => key(row.tag) === TIERS[tier]),
      ...mine.filter((row) => key(row.tag) === `ALTERNATIVE ${TIERS[tier]}`)
    ];
  }

  // A laptop for the tier's list that is not in it yet (Criteria Segment-Application data, with its stock).
  function laptopFor(sku) {
    const laptop = CRITERIA_LAPTOPS_DATA.find((item) => same(item.sku || item.cleanSku, sku));
    if (!laptop) return null;
    if (selectedRecommendationMode !== 'SMT') return laptop;
    const stock = getLaptopStock(laptop, selectedLocation);
    return { ...laptop, stocksByLocation: { [selectedLocation]: stock }, totalStock: stock };
  }

  // Called after the tier lists are made: OSD lists every laptop in stock, DB's laptops are added when missing,
  // and DB's recommended laptop (if in stock) becomes the one each tier starts on.
  function applyToCatalog(catalog, hierarchy) {
    if (!branchCode()) return;
    const isSmt = selectedRecommendationMode === 'SMT';
    Object.keys(TIERS).forEach((tier) => {
      const list = catalog[tier] || (catalog[tier] = []);
      const has = (sku) => list.some((prod) => same(prod.sku || prod.cleanSku, sku));
      if (!isSmt) {
        CRITERIA_LAPTOPS_DATA.forEach((laptop) => {
          if (!has(laptop.sku || laptop.cleanSku) && getLaptopStock(laptop, selectedLocation) > 0) list.push(laptop);
        });
      }
      const rows = dbRows(tier, hierarchy);
      rows.forEach((row) => {
        if (has(row.item)) return;
        const laptop = laptopFor(row.item);
        if (laptop && getLaptopStock(laptop, selectedLocation) > 0) list.push(laptop);
      });
      const main = rows[0] && key(rows[0].tag) === TIERS[tier]
        ? list.find((prod) => same(prod.sku || prod.cleanSku, rows[0].item) && getLaptopStock(prod, selectedLocation) > 0)
        : null;
      if (!main) return;
      if (isSmt) {
        list.forEach((prod) => { prod.smtDefault = prod === main; });
      } else {
        list.splice(list.indexOf(main), 1);
        list.unshift(main);
      }
    });
  }

  // The card's choices: DB's recommended laptop and alternatives, as laptops of the tier's list.
  function options(tier) {
    return dbRows(tier, currentHierarchy).flatMap((row) => {
      const prod = (productCatalog[tier] || []).find((item) => same(item.sku || item.cleanSku, row.item)) || laptopFor(row.item);
      if (!prod) return [];
      return [{ prod, alternative: key(row.tag) !== TIERS[tier], stock: getLaptopStock(prod, selectedLocation) }];
    });
  }

  // Whether prod is DB's recommended laptop for the tier (OSD marks it "★ Recommended" in the list).
  function isRecommended(tier, prod) {
    const row = dbRows(tier, currentHierarchy)[0];
    return Boolean(prod && row && key(row.tag) === TIERS[tier] && same(prod.sku || prod.cleanSku, row.item));
  }

  // Called for each tier whenever its laptop is set: the name gets the chevron when there is a choice.
  function show(tier, prod) {
    const cap = tier.charAt(0).toUpperCase() + tier.slice(1);
    const title = document.getElementById('title' + cap);
    if (!title) return;
    if (openTitle === title) closeMenu();
    const choices = prod ? options(tier) : [];
    const several = choices.length > 1;
    title.classList.toggle('has-alts', several);
    if (several) {
      title.dataset.tier = tier;
      title.setAttribute('onclick', 'RecoAlternatives.toggle(this)');
      title.title = `Recommended + ${choices.length - 1} alternative${choices.length === 2 ? '' : 's'}`;
    } else {
      title.removeAttribute('onclick');
      title.removeAttribute('title');
    }
  }

  function toggle(title) {
    if (openTitle === title) { closeMenu(); return; }
    openMenu(title);
  }

  function openMenu(title) {
    closeMenu();
    const tier = title.dataset.tier;
    const choices = options(tier);
    if (!choices.length) return;
    if (!menu) {
      menu = document.createElement('ul');
      menu.className = 'reco-alts-menu';
      menu.setAttribute('role', 'listbox');
      document.body.appendChild(menu);
      menu.addEventListener('click', (event) => event.stopPropagation());
      menu.addEventListener('keydown', (event) => {
        const items = [...menu.querySelectorAll('button:not(:disabled)')];
        const index = items.indexOf(document.activeElement);
        if (event.key === 'ArrowDown') { event.preventDefault(); (items[index + 1] || items[0]).focus(); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); (items[index - 1] || items[items.length - 1]).focus(); }
        else if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
        else if (event.key === 'Tab') { closeMenu(); }
      });
    }
    const shownSku = (document.getElementById(tier + 'DisplayText') || {}).textContent || '';
    const head = (text) => {
      const li = document.createElement('li');
      li.className = 'alts-head';
      li.textContent = text;
      return li;
    };
    menu.replaceChildren();
    choices.forEach((choice, index) => {
      if (index === 0 && !choice.alternative) menu.appendChild(head('Recommended'));
      if (choice.alternative && (index === 0 || !choices[index - 1].alternative)) menu.appendChild(head('Alternatives'));
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'option');
      button.disabled = choice.stock <= 0;
      if (same(choice.prod.sku || choice.prod.cleanSku, shownSku)) {
        button.classList.add('is-shown');
        button.setAttribute('aria-selected', 'true');
      }
      const name = document.createElement('span');
      name.textContent = choice.prod.title || choice.prod.sku;
      const sku = document.createElement('small');
      sku.textContent = choice.prod.sku || '';
      name.appendChild(sku);
      const stock = document.createElement('span');
      stock.className = 'alts-stock';
      stock.textContent = choice.stock > 0 ? `${choice.stock} in stock` : 'No stock';
      button.append(name, stock);
      button.addEventListener('click', () => {
        closeMenu();
        selectProduct(tier, choice.prod);
      });
      li.appendChild(button);
      menu.appendChild(li);
    });
    menu.hidden = false;
    const rect = title.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - menu.offsetWidth / 2, window.innerWidth - menu.offsetWidth - 8));
    let top = rect.bottom + 6;
    if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, rect.top - menu.offsetHeight - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    openTitle = title;
    title.classList.add('is-open');
    (menu.querySelector('button.is-shown:not(:disabled)') || menu.querySelector('button:not(:disabled)') || menu).focus();
  }

  function closeMenu() {
    if (menu) menu.hidden = true;
    if (openTitle) openTitle.classList.remove('is-open');
    openTitle = null;
  }

  document.addEventListener('click', (event) => {
    if (openTitle && event.target !== openTitle) closeMenu();
  });
  window.addEventListener('resize', closeMenu);
  document.addEventListener('scroll', (event) => { if (event.target !== menu) closeMenu(); }, true);

  window.RecoAlternatives = { applyToCatalog, isRecommended, show, toggle };
})();
