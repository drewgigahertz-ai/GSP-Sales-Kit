// Reco Table: new data (a background refresh after a sheet or price change, the hourly refresh, or Refresh data)
// keeps the laptops the salesperson put on the Exceed / Meet / Budget cards, instead of going back to the
// recommended ones: each is picked again from the rebuilt list when it is still there (still in stock at the branch),
// with its new price and specs. A laptop no longer in its list falls back to the list's default.
// While the presentation is open, background refreshes wait and run once it is closed.
(function () {
  const TIERS = ['exceed', 'meet', 'budget'];
  const key = (value) => String(value || '').replace(/\s+/g, ' ').trim().toUpperCase();

  // { tier: item code } of the laptops on the cards now (a tier with nothing in stock shows a message instead).
  function remember() {
    const shown = {};
    TIERS.forEach((tier) => {
      const text = ((document.getElementById(`${tier}DisplayText`) || {}).textContent || '').trim();
      if (/^LAP[-_\s]/i.test(text)) shown[tier] = text;
    });
    return shown;
  }

  // Puts the remembered laptops back on the cards, when the rebuilt lists still have them.
  function restore(shown) {
    if (!shown || typeof selectProduct !== 'function') return;
    let catalog;
    try {
      catalog = productCatalog;
    } catch {
      return;
    }
    TIERS.forEach((tier) => {
      if (!shown[tier]) return;
      const now = ((document.getElementById(`${tier}DisplayText`) || {}).textContent || '').trim();
      if (key(now) === key(shown[tier])) return;
      const product = (catalog[tier] || []).find((item) => key(item.sku) === key(shown[tier]) || key(item.cleanSku) === key(shown[tier]));
      if (product) selectProduct(tier, product);
    });
  }

  // ---------- Presentation open: background refreshes wait ----------
  let waiting = null;

  function presentationOpen() {
    const overlay = document.getElementById('salesKitPresentation');
    return Boolean(overlay && overlay.classList.contains('is-open'));
  }

  // True when the refresh was put off (it runs when the presentation closes).
  function deferWhilePresenting(run) {
    if (!presentationOpen()) return false;
    waiting = run;
    return true;
  }

  function watchPresentation() {
    const overlay = document.getElementById('salesKitPresentation');
    if (!overlay) return;
    new MutationObserver(() => {
      if (waiting && !presentationOpen()) {
        const run = waiting;
        waiting = null;
        run();
      }
    }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchPresentation);
  else watchPresentation();

  // saleskit.html applyDesktopInitialData: remember() before applying new data, restore() after.
  window.RecoRefreshGuard = { remember, restore, deferWhilePresenting };
})();
