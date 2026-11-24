// "Add to Quotation" buttons on the Reco Table (under each laptop's price) and the Sales Kit (in each laptop's
// column header). A click adds that laptop to the quotation being made and opens the Quotation tab
// (quotation-bridge.js addToQuotation); on the Reco Table, the promo shown on the card (reco-promos.js) goes along.
// The buttons are for the screen only: left out of the downloaded images (data-html2canvas-ignore), the
// presentation (CSS below) and the copied text (the Sales Kit button has no text, only an icon).
(function () {
  const TIERS = ['exceed', 'meet', 'budget'];
  const cap = (tier) => tier.charAt(0).toUpperCase() + tier.slice(1);

  const style = document.createElement('style');
  style.textContent = `
    .quote-add { display: inline-flex; align-items: center; justify-content: center; gap: 5px; border: 1px solid #bbf7d0; background: #f0fdf4; color: #047857; font-weight: 700; cursor: pointer; transition: background .15s, border-color .15s, transform .15s; }
    .quote-add:hover { background: #dcfce7; border-color: #86efac; transform: translateY(-1px); }
    .quote-add:focus-visible { outline: 3px solid rgba(4, 120, 87, .3); outline-offset: 1px; }
    .quote-add[hidden] { display: none !important; }
    .quote-add.reco { margin: 8px auto 0; padding: 3px 11px; border-radius: 999px; font-size: 0.72rem; }
    .reco-header-box .quote-add.reco { display: flex; width: max-content; }
    .saleskit-col-header.has-quote { position: relative; padding-right: 34px; }
    .quote-add.sk { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); width: 24px; height: 24px; padding: 0; border-radius: 7px; font-size: 0.8rem; }
    .quote-add.sk:hover { transform: translateY(-50%) scale(1.06); }
    #salesKitPresentation .quote-add { display: none !important; }
  `;
  document.head.appendChild(style);

  function button(className, label, title) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `quote-add ${className}`;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.setAttribute('data-html2canvas-ignore', 'true');
    b.innerHTML = `<i class="bi bi-file-earmark-plus" aria-hidden="true"></i>${label}`;
    return b;
  }

  // The tier's laptop item code, '' when the card is empty.
  function skuOf(tier) {
    try {
      // selectedSkus: the Reco Table's choice per tier (saleskit.html); '' for an empty card.
      if (typeof selectedSkus !== 'undefined' && selectedSkus && tier in selectedSkus) return String(selectedSkus[tier] || '');
    } catch {}
    const title = document.getElementById('title' + cap(tier));
    return (title && title.dataset.sku) || '';
  }
  // The promo title the Reco Table card shows (its promo list's picked row), '' for the automatic one.
  function shownPromo(tier) {
    const row = document.querySelector(`#promos${cap(tier)} li.is-shown > span`);
    return row && row.firstChild ? String(row.firstChild.textContent || '').trim() : '';
  }

  function add(tier, from) {
    const code = skuOf(tier);
    if (!code || typeof window.addToQuotation !== 'function') return;
    window.addToQuotation({ code, promo: from === 'Reco Table' ? shownPromo(tier) : '', from });
  }

  // ---------- Reco Table: under the price (after the promo list) ----------
  function recoButton(tier) {
    const title = document.getElementById('title' + cap(tier));
    const box = title && title.closest('.reco-header-box');
    if (!box) return null;
    let b = box.querySelector('.quote-add');
    if (!b) {
      b = button('reco', 'Add to Quotation', `Add this ${tier.toUpperCase()} laptop to the quotation`);
      b.addEventListener('click', (event) => { event.stopPropagation(); add(tier, 'Reco Table'); });
      box.appendChild(b);
    }
    return b;
  }

  // ---------- Sales Kit: in the laptop's column header (rebuilt on each render, so put back when it is) ----------
  function salesKitButton(tier) {
    const header = document.getElementById('skHeader' + cap(tier));
    if (!header) return null;
    let b = header.querySelector('.quote-add');
    if (!b) {
      header.classList.add('has-quote');
      b = button('sk', '', `Add this ${tier.toUpperCase()} laptop to the quotation`);
      b.addEventListener('click', (event) => { event.stopPropagation(); add(tier, 'Sales Kit'); });
      header.appendChild(b);
    }
    return b;
  }

  // Shown only for a card with a laptop. On the Reco Table an empty card keeps the button's space, so the three
  // cards' specs stay level.
  function refresh() {
    TIERS.forEach((tier) => {
      const empty = !skuOf(tier);
      const reco = recoButton(tier);
      if (reco) reco.style.visibility = empty ? 'hidden' : '';
      const sk = salesKitButton(tier);
      if (sk) sk.hidden = empty;
    });
  }

  function watch() {
    refresh();
    const observer = new MutationObserver(() => {
      // Only when a button went missing or a laptop changed (refresh adds nodes itself: no loop, it finds them).
      observer.disconnect();
      refresh();
      observe();
    });
    function observe() {
      TIERS.forEach((tier) => {
        const title = document.getElementById('title' + cap(tier));
        const header = document.getElementById('skHeader' + cap(tier));
        if (title) observer.observe(title, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['data-sku'] });
        if (header) observer.observe(header, { childList: true });
      });
    }
    observe();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
