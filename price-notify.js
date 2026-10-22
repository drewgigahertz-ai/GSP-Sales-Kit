// Price-change notice: when NEW PRICING changes, the server pushes the changes (electron/price-stream.js) and a
// small summary card appears under the header's "Price changes" button. Clicking it opens the modal with the time
// of each change and, for each laptop, CASH PRICE, SRP and 12MOS: old → new. The button itself opens the last
// 30 days of changes with a date filter.
(function () {
  if (!window.saleskit || typeof window.saleskit.onPriceChanges !== 'function') return;

  const style = document.createElement('style');
  style.textContent = `
    .price-notice-backdrop {
      position: fixed;
      inset: 0;
      z-index: 3000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: rgba(15, 23, 42, .55);
    }

    .price-notice {
      display: flex;
      width: min(1040px, 100%);
      max-height: min(760px, 100%);
      flex-direction: column;
      overflow: hidden;
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 24px 60px rgba(15, 23, 42, .3);
      font-family: 'Outfit', sans-serif;
    }

    .price-notice-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 18px 22px;
      background: linear-gradient(135deg, #0012b3, #003ecb);
      color: #fff;
    }

    .price-notice-header .bi {
      font-size: 1.6rem;
    }

    .price-notice-header h2 {
      margin: 0;
      font-size: 1.3rem;
      font-weight: 800;
    }

    .price-notice-header p {
      margin: 2px 0 0;
      opacity: .85;
      font-size: .85rem;
    }

    .price-notice-body {
      overflow: auto;
      padding: 0 22px 10px;
    }

    /* Date and time on every row, so each change sits next to its laptop. */
    .price-notice-table td.price-notice-time {
      width: 120px;
      color: #475569;
      font-size: .78rem;
      font-weight: 600;
      white-space: nowrap;
    }

    .price-notice-time b {
      display: block;
      color: #0012b3;
      font-size: .9rem;
      font-weight: 800;
    }

    /* A new update (another time) starts with a stronger line. */
    .price-notice-table tr.event-start td {
      border-top: 2px solid #c7d4ea;
    }

    .price-notice-table thead th {
      position: sticky;
      top: 0;
      z-index: 1;
    }

    .price-notice-table {
      width: 100%;
      border-collapse: collapse;
      font-size: .86rem;
    }

    .price-notice-table th {
      padding: 8px 10px;
      border-bottom: 2px solid #dbe4f3;
      background: #f4f8fd;
      color: #334155;
      font-size: .72rem;
      font-weight: 800;
      letter-spacing: .03em;
      text-align: left;
      vertical-align: bottom;
    }

    .price-notice-table th small {
      display: block;
      margin-top: 2px;
      color: #64748b;
      font-size: .62rem;
      font-weight: 600;
      letter-spacing: 0;
      line-height: 1.25;
    }

    .price-notice-table td {
      padding: 9px 10px;
      border-bottom: 1px solid #eef2f8;
      color: #0f172a;
      vertical-align: top;
    }

    .price-notice-item {
      font-weight: 700;
      line-height: 1.3;
    }

    .price-notice-item small {
      display: block;
      margin-top: 2px;
      color: #64748b;
      font-weight: 600;
    }

    .price-notice-tag {
      display: inline-block;
      margin-right: 5px;
      padding: 1px 6px;
      border-radius: 4px;
      background: #e8ecff;
      color: #0012b3;
      font-size: .64rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    .price-notice-tag.removed {
      background: #fee2e2;
      color: #b91c1c;
    }

    .price-notice-price {
      white-space: nowrap;
    }

    .price-notice-price .old {
      color: #94a3b8;
      text-decoration: line-through;
    }

    .price-notice-price .new {
      font-weight: 800;
    }

    .price-notice-price .down {
      color: #15803d;
    }

    .price-notice-price .up {
      color: #c2410c;
    }

    .price-notice-price .same {
      color: #64748b;
    }

    .price-notice-footer {
      display: flex;
      justify-content: flex-end;
      padding: 14px 22px;
      border-top: 1px solid #e2e8f0;
    }

    .price-notice-footer button {
      padding: 9px 28px;
      border: 0;
      border-radius: 999px;
      background: #003ecb;
      color: #fff;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    .price-notice-footer button.secondary {
      margin-right: auto;
      border: 1.5px solid #cbd8eb;
      background: #fff;
      color: #003ecb;
    }

    .price-notice-filter {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 12px;
      padding: 12px 22px;
      border-bottom: 1px solid #e2e8f0;
      background: #f4f8fd;
    }

    .price-notice-date {
      display: flex;
      flex-direction: column;
      gap: 4px;
      color: #334155;
      font-size: .72rem;
      font-weight: 800;
      letter-spacing: .03em;
      text-transform: uppercase;
    }

    .price-notice-date input {
      padding: 6px 10px;
      border: 1.5px solid #cbd8eb;
      border-radius: 8px;
      color: #0f172a;
      font: inherit;
      font-size: .85rem;
      font-weight: 600;
      letter-spacing: 0;
      text-transform: none;
    }

    .price-notice-quick {
      display: flex;
      gap: 6px;
    }

    .price-notice-quick button {
      padding: 6px 12px;
      border: 1.5px solid #cbd8eb;
      border-radius: 999px;
      background: #fff;
      color: #334155;
      font: inherit;
      font-size: .8rem;
      font-weight: 700;
      cursor: pointer;
    }

    .price-notice-quick button.is-active {
      border-color: #003ecb;
      background: #003ecb;
      color: #fff;
    }

    .price-notice-empty {
      padding: 40px 0;
      color: #64748b;
      text-align: center;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .price-changes-button {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1.5px solid rgba(255, 255, 255, .55);
      border-radius: 999px;
      background: rgba(255, 255, 255, .1);
      color: #fff;
      font-weight: 700;
    }

    .price-changes-button:hover,
    .price-changes-button:focus-visible {
      border-color: #fff;
      background: rgba(255, 255, 255, .2);
      color: #fff;
    }

    .price-changes-dot {
      display: none;
      position: absolute;
      top: -3px;
      right: -3px;
      width: 11px;
      height: 11px;
      border: 2px solid #0012b3;
      border-radius: 50%;
      background: #ef4444;
    }

    .price-changes-button.has-unseen .price-changes-dot {
      display: block;
    }

    .header-actions {
      position: relative;
    }

    /* Summary card under the "Price changes" button. */
    .price-changes-card {
      position: absolute;
      top: calc(100% + 12px);
      right: 0;
      z-index: 2500;
      width: 360px;
      padding: 12px 14px 12px;
      border-radius: 12px;
      background: #fff;
      box-shadow: 0 14px 34px rgba(15, 23, 42, .28);
      color: #0f172a;
      font-family: 'Outfit', sans-serif;
      text-align: left;
      cursor: pointer;
      animation: price-card-in .18s ease-out;
    }

    .price-changes-card::before {
      content: '';
      position: absolute;
      top: -7px;
      right: var(--arrow-right, 40px);
      width: 14px;
      height: 14px;
      background: #fff;
      transform: rotate(45deg);
    }

    @keyframes price-card-in {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: none; }
    }

    .price-changes-card-head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .price-changes-card-head .bi-tags-fill {
      color: #003ecb;
    }

    .price-changes-card-head b {
      flex: 1;
      color: #0012b3;
      font-size: .95rem;
    }

    .price-changes-card-head small {
      color: #64748b;
      font-weight: 600;
    }

    .price-changes-card-close {
      padding: 0 4px;
      border: 0;
      background: transparent;
      color: #64748b;
      font-size: 1rem;
      line-height: 1;
      cursor: pointer;
    }

    .price-changes-card ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .price-changes-card li {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 5px 0;
      border-top: 1px solid #eef2f8;
      font-size: .8rem;
    }

    .price-changes-card li span:first-child {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .price-changes-card li .price-notice-price {
      flex: 0 0 auto;
    }

    .price-changes-card-more {
      padding-top: 6px;
      border-top: 1px solid #eef2f8;
      color: #64748b;
      font-size: .76rem;
      font-weight: 600;
    }

    .price-changes-card-view {
      display: block;
      width: 100%;
      margin-top: 10px;
      padding: 7px 0;
      border: 0;
      border-radius: 999px;
      background: #003ecb;
      color: #fff;
      font: inherit;
      font-size: .85rem;
      font-weight: 700;
      cursor: pointer;
    }
  `;
  document.head.appendChild(style);

  const COLUMNS = [
    { field: 'cash', title: 'CASH PRICE' },
    { field: 'srp', title: 'SRP', note: '3 months / debit / straight / website price / BillEase / GGives' },
    { field: 'twelveMonths', title: '12MOS', note: 'BDO | BPI | Citibank | EastWest | HSBC | Metrobank | PNB | RCBC | Security Bank | UnionBank' }
  ];

  let backdrop = null;
  let body = null;
  let summary = null;
  let shownCount = 0;
  let filterBar = null;

  function peso(value) {
    return value === null || value === undefined || !Number.isFinite(Number(value))
      ? '—'
      : `₱${Number(value).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
  }

  function when(iso) {
    const date = new Date(iso);
    return `${date.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })} · ${date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}`;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Old → new for one price; unchanged prices are shown once, in grey.
  function priceCell(change, field) {
    const cell = element('td', 'price-notice-price');
    const before = change.before ? change.before[field] : null;
    const after = change.after ? change.after[field] : null;
    if (change.kind === 'added') {
      cell.appendChild(element('span', 'new', peso(after)));
    } else if (change.kind === 'removed') {
      cell.appendChild(element('span', 'old', peso(before)));
    } else if (before === after) {
      cell.appendChild(element('span', 'same', peso(after)));
    } else {
      const direction = before !== null && after !== null ? (after < before ? 'down' : 'up') : '';
      cell.append(
        element('span', 'old', peso(before)),
        document.createTextNode(' → '),
        element('span', `new ${direction}`, `${peso(after)} ${direction === 'down' ? '▼' : direction === 'up' ? '▲' : ''}`.trim())
      );
    }
    return cell;
  }

  // One table for all changes: DATE & TIME, LAPTOP, then the prices.
  function changesBody() {
    const existing = body.querySelector('.price-notice-table tbody');
    if (existing) return existing;
    const table = element('table', 'price-notice-table');
    const head = table.createTHead().insertRow();
    head.append(element('th', '', 'DATE & TIME'), element('th', '', 'LAPTOP'));
    COLUMNS.forEach(({ title, note }) => {
      const th = element('th', '', title);
      if (note) th.appendChild(element('small', '', note));
      head.appendChild(th);
    });
    body.appendChild(table);
    return table.createTBody();
  }

  // The rows of one price change, each with its date and time.
  function eventRows(event) {
    const rows = document.createDocumentFragment();
    const date = new Date(event.at);
    event.changes.forEach((change, index) => {
      const row = element('tr', index === 0 ? 'event-start' : '');
      const time = element('td', 'price-notice-time');
      time.title = `Changed ${when(event.at)}`;
      time.append(
        element('b', '', date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })),
        document.createTextNode(date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }))
      );
      const item = element('td', 'price-notice-item');
      if (change.kind === 'added') item.appendChild(element('span', 'price-notice-tag', 'New'));
      if (change.kind === 'removed') item.appendChild(element('span', 'price-notice-tag removed', 'Removed'));
      item.appendChild(document.createTextNode(change.itemCode));
      const details = [change.promoTitle, change.branch ? `${change.branch} only` : ''].filter(Boolean).join(' · ');
      if (details) item.appendChild(element('small', '', details));
      row.append(time, item);
      COLUMNS.forEach(({ field }) => row.appendChild(priceCell(change, field)));
      rows.appendChild(row);
    });
    return rows;
  }

  function close() {
    if (!backdrop) return;
    backdrop.remove();
    backdrop = null;
    body = null;
    summary = null;
    filterBar = null;
    shownCount = 0;
    document.removeEventListener('keydown', onKeydown, true);
  }

  function onKeydown(event) {
    if (event.key === 'Escape' || (event.key === 'Enter' && !event.target.closest('.price-notice-filter'))) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  // mode: 'new' (changes just pushed by the server) or 'history' (the "Price changes" button, with a date filter).
  function open(mode) {
    close();
    backdrop = element('div', 'price-notice-backdrop');
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close();
    });
    const dialog = element('div', 'price-notice');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'priceNoticeTitle');
    const header = element('div', 'price-notice-header');
    header.innerHTML = '<i class="bi bi-tags-fill" aria-hidden="true"></i>';
    const heading = element('div');
    const title = element('h2', '', mode === 'history' ? 'Price changes' : 'Prices updated');
    title.id = 'priceNoticeTitle';
    summary = element('p');
    heading.append(title, summary);
    header.appendChild(heading);
    filterBar = mode === 'history' ? createFilterBar() : null;
    body = element('div', 'price-notice-body');
    const footer = element('div', 'price-notice-footer');
    if (mode === 'new') {
      const all = element('button', 'secondary', 'See all price changes');
      all.type = 'button';
      all.addEventListener('click', () => openHistory());
      footer.appendChild(all);
    }
    const ok = element('button', '', mode === 'history' ? 'Close' : 'Got it');
    ok.type = 'button';
    ok.addEventListener('click', close);
    footer.appendChild(ok);
    dialog.append(...[header, filterBar, body, footer].filter(Boolean));
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', onKeydown, true);
    ok.focus();
    setUnseen(false);
  }

  // ---------- New changes (pushed) ----------

  // events: oldest first; the newest change is shown at the top.
  // Changes not opened yet (oldest first); shown in the card until it is opened or closed.
  let pending = [];

  function showNewChanges(events) {
    open('new');
    [...events].reverse().forEach((event) => {
      const rows = changesBody();
      rows.insertBefore(eventRows(event), rows.firstChild);
      shownCount += event.changes.length;
    });
    summary.textContent = `${shownCount} laptop price${shownCount === 1 ? '' : 's'} changed. The banners and Reco Table now use the new prices.`;
  }

  window.saleskit.onPriceChanges((events) => {
    if (!Array.isArray(events) || !events.length) return;
    pending = pending.concat(events);
    // The modal is already showing new changes: add these to it too.
    if (backdrop && !filterBar) {
      showNewChanges(pending);
      pending = [];
      return;
    }
    showCard();
    setUnseen(true);
  });

  // ---------- Summary card under the button ----------

  let card = null;
  const CARD_ROWS = 3;

  function closeCard() {
    if (card) card.remove();
    card = null;
  }

  function showCard() {
    if (!button || !pending.length) return;
    closeCard();
    const changes = pending.flatMap((event) => event.changes.map((change) => ({ ...change, at: event.at }))).reverse();
    const latest = new Date(pending[pending.length - 1].at);
    card = element('div', 'price-changes-card');
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.title = 'Open the price changes';

    const head = element('div', 'price-changes-card-head');
    head.innerHTML = '<i class="bi bi-tags-fill" aria-hidden="true"></i>';
    head.append(
      element('b', '', `${changes.length} price change${changes.length === 1 ? '' : 's'}`),
      element('small', '', latest.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }))
    );
    const dismiss = element('button', 'price-changes-card-close', '×');
    dismiss.type = 'button';
    dismiss.title = 'Close';
    dismiss.setAttribute('aria-label', 'Close');
    dismiss.addEventListener('click', (event) => {
      event.stopPropagation();
      closeCard();
    });
    head.appendChild(dismiss);

    // The first few laptops with their cash price, old → new.
    const list = element('ul');
    changes.slice(0, CARD_ROWS).forEach((change) => {
      const item = element('li');
      const name = element('span', '', change.itemCode.replace(/^LAP-/i, ''));
      name.title = change.itemCode;
      const price = priceCell(change, 'cash');
      const cash = element('span', price.className);
      cash.append(...price.childNodes);
      item.append(name, cash);
      list.appendChild(item);
    });
    card.append(head, list);
    if (changes.length > CARD_ROWS) {
      const more = changes.length - CARD_ROWS;
      card.appendChild(element('div', 'price-changes-card-more', `+ ${more} more laptop${more === 1 ? '' : 's'}`));
    }
    const view = element('button', 'price-changes-card-view', 'View details');
    view.type = 'button';
    card.appendChild(view);

    const openDetails = () => {
      const events = pending;
      pending = [];
      closeCard();
      showNewChanges(events);
    };
    card.addEventListener('click', openDetails);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openDetails();
      }
    });
    button.parentElement.appendChild(card);
    // Under the button, with the arrow pointing at it.
    const wrapBox = button.parentElement.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    card.style.right = `${Math.round(wrapBox.right - buttonBox.right)}px`;
    card.style.setProperty('--arrow-right', `${Math.round(buttonBox.width / 2 - 7)}px`);
  }

  // ---------- History, with a date filter ----------

  let history = [];
  const dayStart = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const inputDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const parseInput = (value) => {
    const [year, month, day] = String(value || '').split('-').map(Number);
    return year ? new Date(year, month - 1, day) : null;
  };

  function createFilterBar() {
    const bar = element('div', 'price-notice-filter');
    const today = dayStart(new Date());
    const from = element('input');
    from.type = 'date';
    from.id = 'priceChangesFrom';
    const to = element('input');
    to.type = 'date';
    to.id = 'priceChangesTo';
    const label = (text, input) => {
      const wrap = element('label', 'price-notice-date', text);
      wrap.htmlFor = input.id;
      wrap.appendChild(input);
      return wrap;
    };
    const quick = element('div', 'price-notice-quick');
    const select = (days) => {
      from.value = inputDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - days));
      to.value = inputDate(today);
      quick.querySelectorAll('button').forEach((button) => button.classList.toggle('is-active', Number(button.dataset.days) === days));
      renderHistory();
    };
    [['Today', 0], ['Last 7 days', 6], ['Last 30 days', 29]].forEach(([text, days]) => {
      const button = element('button', '', text);
      button.type = 'button';
      button.dataset.days = String(days);
      button.addEventListener('click', () => select(days));
      quick.appendChild(button);
    });
    [from, to].forEach((input) => input.addEventListener('change', () => {
      quick.querySelectorAll('button').forEach((button) => button.classList.remove('is-active'));
      renderHistory();
    }));
    bar.append(label('From', from), label('To', to), quick);
    // The last 7 days to start with.
    from.value = inputDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6));
    to.value = inputDate(today);
    quick.children[1].classList.add('is-active');
    return bar;
  }

  function renderHistory() {
    if (!body || !filterBar) return;
    const from = parseInput(document.getElementById('priceChangesFrom').value);
    const toDay = parseInput(document.getElementById('priceChangesTo').value);
    const to = toDay ? new Date(toDay.getFullYear(), toDay.getMonth(), toDay.getDate() + 1) : null;
    const shown = history.filter((event) => {
      const at = new Date(event.at);
      return (!from || at >= from) && (!to || at < to);
    });
    body.replaceChildren();
    if (shown.length) {
      const rows = changesBody();
      shown.slice().reverse().forEach((event) => rows.appendChild(eventRows(event)));
    }
    const count = shown.reduce((total, event) => total + event.changes.length, 0);
    summary.textContent = count
      ? `${count} laptop price${count === 1 ? '' : 's'} changed in ${shown.length} update${shown.length === 1 ? '' : 's'}.`
      : 'No price changes in these dates.';
    if (!count) body.appendChild(element('div', 'price-notice-empty', 'No price changes between these dates. Changes are kept for 30 days.'));
  }

  async function openHistory() {
    open('history');
    summary.textContent = 'Loading…';
    try {
      history = typeof window.saleskit.getPriceChanges === 'function' ? await window.saleskit.getPriceChanges() : [];
    } catch {
      history = [];
      if (summary) summary.textContent = 'Could not load the price changes. Check the connection to the server.';
      return;
    }
    renderHistory();
  }

  // ---------- "Price changes" button in the header, next to OSD / SMT ----------

  let button = null;
  function setUnseen(unseen) {
    if (button) button.classList.toggle('has-unseen', unseen);
  }

  function addButton() {
    const modes = document.querySelector('.header-bar .btn-group[aria-label="Recommendation mode"]');
    if (!modes) return;
    const wrap = element('div', 'header-actions');
    modes.replaceWith(wrap);
    button = element('button', 'btn btn-sm price-changes-button');
    button.type = 'button';
    button.id = 'btnPriceChanges';
    button.title = 'Recent price changes';
    button.innerHTML = '<i class="bi bi-tags-fill" aria-hidden="true"></i><span>Price changes</span><span class="price-changes-dot" aria-hidden="true"></span>';
    button.addEventListener('click', () => {
      closeCard();
      pending = [];
      openHistory();
    });
    wrap.append(button, modes);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButton);
  else addButton();
})();
