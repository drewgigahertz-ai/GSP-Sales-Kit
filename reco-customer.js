// Reco Table: a Customer name box at the top of Customer Profiling. The name, the segment (Recommendation), the three
// laptops on the result (Exceed / Meet / Budget) and the chosen applications are passed to the Flyers tab
// (flyer-bridge.js → updateFlyerCustomer), which puts a "Prepared for" section at the top of the flyer while a
// name is entered. The name is kept for this session of the app (not after it is closed: the next customer starts blank).
(function () {
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'ghz_customer_name';
  const TIERS = ['exceed', 'meet', 'budget'];

  const style = document.createElement('style');
  style.textContent = `
    .customer-name-wrap {
      position: relative;
    }

    .customer-name-wrap .form-control {
      padding-right: 30px;
    }

    .customer-name-clear {
      position: absolute;
      top: 50%;
      right: 6px;
      padding: 0 4px;
      border: 0;
      background: none;
      color: #94a3b8;
      line-height: 1;
      transform: translateY(-50%);
      cursor: pointer;
    }

    .customer-name-clear:hover {
      color: #475569;
    }

    .customer-name-clear[hidden] {
      display: none;
    }
  `;
  document.head.appendChild(style);

  function readName() {
    try {
      return sessionStorage.getItem(STORE_KEY) || '';
    } catch {
      return '';
    }
  }

  function saveName(value) {
    try {
      sessionStorage.setItem(STORE_KEY, value);
    } catch {}
  }

  // The card, above APPLICATIONS.
  const appsCard = $('appsDropdownWrapper') && $('appsDropdownWrapper').closest('.filter-card');
  if (!appsCard) return;
  const card = document.createElement('div');
  card.className = 'filter-card filter-card-sidebar';
  card.innerHTML = `
    <label class="filter-label" for="customerNameInput"><i class="bi bi-person"></i> CUSTOMER NAME</label>
    <div class="customer-name-wrap">
      <input type="text" class="form-control form-control-sm" id="customerNameInput" placeholder="e.g. Juan Dela Cruz"
        autocomplete="off" spellcheck="false" maxlength="60" title="Shown at the top of the flyer (Flyers tab)">
      <button type="button" class="customer-name-clear" id="customerNameClear" title="Clear the name" aria-label="Clear the name" hidden>
        <i class="bi bi-x-lg" aria-hidden="true"></i>
      </button>
    </div>`;
  appsCard.insertAdjacentElement('beforebegin', card);

  const input = $('customerNameInput');
  const clear = $('customerNameClear');
  input.value = readName();
  clear.hidden = !input.value;

  // What the flyer needs from the Reco Table now.
  function current() {
    let hierarchy = null;
    let segment = '';
    let apps = [];
    try {
      hierarchy = currentHierarchy;
      segment = getSmtTargetMarket(currentHierarchy);
      apps = APP_DATABASE.filter((app) => selectedAppIds.includes(app.id)).map((app) => app.name);
    } catch {}
    const laptops = {};
    TIERS.forEach((tier) => {
      const text = (($(`${tier}DisplayText`) || {}).textContent || '').trim();
      // A tier with nothing in stock shows a message instead of an item code.
      laptops[tier] = /^LAP[-_\s]/i.test(text) ? text : '';
    });
    return { name: input.value.trim(), hierarchy, segment, laptops, apps };
  }

  let timer = null;
  function send() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (typeof window.updateFlyerCustomer === 'function') window.updateFlyerCustomer(current());
    }, 150);
  }

  input.addEventListener('input', () => {
    clear.hidden = !input.value;
    saveName(input.value);
    send();
  });
  clear.addEventListener('click', () => {
    input.value = '';
    clear.hidden = true;
    saveName('');
    send();
    input.focus();
  });

  // The laptops, the segment and the applications on screen: sent again whenever one changes.
  ['exceedDisplayText', 'meetDisplayText', 'budgetDisplayText', 'recoForDisplayText', 'appsDisplayText'].forEach((id) => {
    if ($(id)) new MutationObserver(send).observe($(id), { childList: true, characterData: true, subtree: true });
  });

  window.RecoCustomer = { current, send };
  send();
})();
