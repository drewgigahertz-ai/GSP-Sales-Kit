// Reco Table: "Stock as of Nov 20, 2026" under LOCATION, when the branch stock comes from the server's inventory CSV
// (data.inventoryAsOf, 'YYYY-MM-DD'), so staff can tell how old the counts are. Nothing shows while the stock is
// LAPTOP DB's (an older server, or no CSV read yet). An old date (before yesterday) is shown in amber.
(function () {
  const style = document.createElement('style');
  style.textContent = `
    .stock-as-of { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 0.74rem; font-weight: 600; color: #64748b; }
    .stock-as-of[hidden] { display: none; }
    .stock-as-of.is-old { color: #b45309; }
  `;
  document.head.appendChild(style);

  function line() {
    let el = document.getElementById('stockAsOf');
    if (el) return el;
    const wrapper = document.getElementById('locationDropdownWrapper');
    if (!wrapper || !wrapper.parentElement) return null;
    el = document.createElement('div');
    el.id = 'stockAsOf';
    el.className = 'stock-as-of';
    el.hidden = true;
    wrapper.parentElement.appendChild(el);
    return el;
  }

  window.updateStockAsOf = function (data) {
    const el = line();
    if (!el) return;
    const match = String((data && data.inventoryAsOf) || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) { el.hidden = true; return; }
    const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const yesterday = new Date();
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setDate(yesterday.getDate() - 1);
    el.classList.toggle('is-old', day < yesterday);
    el.innerHTML = '<i class="bi bi-box-seam" aria-hidden="true"></i>';
    el.appendChild(document.createTextNode(`Stock as of ${day.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`));
    el.title = 'Branch stock from the inventory file uploaded to the server';
    el.hidden = false;
  };
})();
