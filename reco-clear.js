// Reco Table: "Clear all" (or Ctrl+Shift+X) puts the page back as it starts for the next customer: no customer name
// (the Flyers "Prepared for" section goes too), no applications, the recommendation back to Auto, and the Exceed /
// Meet / Budget cards back to their default laptops. The location (branch) and the SMT / OSD mode stay.
// The first press asks to press again within 3 seconds, so nothing is cleared by accident.
(function () {
  const CONFIRM_MS = 3000;

  const style = document.createElement('style');
  style.textContent = `
    .reco-clear-card {
      padding-top: 10px;
      padding-bottom: 10px;
    }

    .reco-clear-btn {
      display: flex;
      width: 100%;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 7px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      background: #fff;
      color: #475569;
      font-size: 0.82rem;
      font-weight: 700;
      cursor: pointer;
    }

    .reco-clear-btn:hover {
      border-color: #94a3b8;
      color: #0f172a;
    }

    .reco-clear-btn.is-confirming {
      border-color: #dc2626;
      background: #fef2f2;
      color: #b91c1c;
    }
  `;
  document.head.appendChild(style);

  // The card, at the top of Customer Profiling (above CUSTOMER NAME, else above APPLICATIONS).
  const anchor = (document.getElementById('customerNameInput') || document.getElementById('appsDropdownWrapper'));
  const anchorCard = anchor && anchor.closest('.filter-card');
  if (!anchorCard) return;
  const card = document.createElement('div');
  card.className = 'filter-card filter-card-sidebar reco-clear-card';
  card.innerHTML = `
    <button type="button" class="reco-clear-btn" id="btnRecoClear" title="Clear the customer and selections (Ctrl+Shift+X)">
      <i class="bi bi-eraser" aria-hidden="true"></i><span>Clear all</span>
    </button>`;
  anchorCard.insertAdjacentElement('beforebegin', card);

  const button = document.getElementById('btnRecoClear');
  const label = button.querySelector('span');
  let confirmTimer = null;

  function stopConfirming() {
    clearTimeout(confirmTimer);
    confirmTimer = null;
    button.classList.remove('is-confirming');
    label.textContent = 'Clear all';
  }

  function clearAll() {
    stopConfirming();
    // Customer name (and with it the Flyers "Prepared for" section).
    if (window.RecoCustomer) {
      RecoCustomer.setName('');
      RecoCustomer.send();
    }
    // Applications, then the recommendation back to Auto; this also puts the default laptops on the cards.
    if (typeof clearAllRecoApps === 'function') clearAllRecoApps();
    if (typeof selectRecoFor === 'function') selectRecoFor('', null);
    if (typeof showAppNotification === 'function') showAppNotification('Cleared. Ready for the next customer.', 'success', 2500);
  }

  // First press: "Click again to clear"; a second press within 3 seconds clears.
  function request() {
    if (confirmTimer) {
      clearAll();
      return;
    }
    button.classList.add('is-confirming');
    label.textContent = 'Click again to clear';
    confirmTimer = setTimeout(stopConfirming, CONFIRM_MS);
  }

  button.addEventListener('click', request);

  window.RecoClear = { request, clearAll };
})();
