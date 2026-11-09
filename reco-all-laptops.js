// Reco Table: the Exceed / Meet / Budget dropdowns list every LAPTOP DB laptop, also those with no stock (at the
// chosen branch, or at any branch for ALL BRANCHES) and end-of-life ones. The laptops in stock come first, as before;
// the others follow under a "No stock" heading, greyed, by name, and can still be picked.
// A laptop added here never becomes the card's starting laptop: that is still picked from the laptops in stock.
(function () {
  const TIERS = ['exceed', 'meet', 'budget'];

  const style = document.createElement('style');
  style.textContent = `
    .custom-dropdown-item.is-no-stock { opacity: 0.62; }
    .custom-dropdown-item.is-no-stock:hover,
    .custom-dropdown-item.is-no-stock.active { opacity: 1; }
    .no-stock-header {
      padding: 6px 12px;
      border-top: 1px solid #e2e8f0;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fafc;
      color: #64748b;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.3px;
      text-transform: uppercase;
    }
  `;
  document.head.appendChild(style);

  const titleOf = (prod) => String(prod.title || prod.sku || '').toUpperCase();

  // Called after the tier lists are made (and RecoAlternatives has added the laptops in stock): every LAPTOP DB
  // laptop not in a tier's list yet is added at its end, marked addedWithoutStock.
  function addLaptopsWithoutStock(catalog) {
    const laptopDb = (window.sheetData && window.sheetData.laptopDatabase) || [];
    const toProduct = window.RecoAlternatives && RecoAlternatives.laptopDbProduct;
    if (!laptopDb.length || !toProduct) return;
    const seen = new Set();
    const products = laptopDb
      .filter((laptop) => {
        const sku = normalizeSmtSku(laptop.item);
        if (!sku || seen.has(sku)) return false;
        seen.add(sku);
        return true;
      })
      .map(toProduct)
      .sort((a, b) => titleOf(a).localeCompare(titleOf(b)) || String(a.sku).localeCompare(String(b.sku)));
    TIERS.forEach((tier) => {
      const list = catalog[tier] || (catalog[tier] = []);
      const listed = new Set(list.map((prod) => normalizeSmtSku(prod.sku || prod.cleanSku)));
      products.forEach((prod) => {
        if (listed.has(normalizeSmtSku(prod.sku || prod.cleanSku))) return;
        list.push({ ...prod, addedWithoutStock: true, smtDefault: false, smtRecommended: false });
      });
    });
  }

  // The laptop a tier's card starts on: the first one of the list as it was before the laptops without stock were added.
  function startingLaptop(list) {
    return (list || []).find((prod) => !prod.addedWithoutStock) || null;
  }

  // A dropdown's laptops in the order shown: those in stock (in list order), then those without.
  function splitByStock(items) {
    const inStock = [];
    const noStock = [];
    (items || []).forEach((prod) => (getLaptopStock(prod, selectedLocation) > 0 ? inStock : noStock).push(prod));
    return { inStock, noStock };
  }

  function noStockHeader(count) {
    const header = document.createElement('div');
    header.className = 'no-stock-header';
    header.textContent = `No stock (${count})`;
    return header;
  }

  window.RecoAllLaptops = { addLaptopsWithoutStock, startingLaptop, splitByStock, noStockHeader };
})();
