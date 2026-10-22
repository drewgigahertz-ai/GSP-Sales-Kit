// Price-change notice: when NEW PRICING changes, the server pushes the changes (electron/price-stream.js) and
// this modal opens with the time of the change and, for each laptop, CASH PRICE, SRP and 12MOS: old → new.
// Changes that arrive while it is open are added to it.
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
      padding: 6px 22px 10px;
    }

    .price-notice-time {
      margin: 16px 0 8px;
      color: #0012b3;
      font-size: .9rem;
      font-weight: 800;
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

  function eventSection(event) {
    const section = document.createDocumentFragment();
    section.appendChild(element('div', 'price-notice-time', `Price change · ${when(event.at)}`));
    const table = element('table', 'price-notice-table');
    const head = table.createTHead().insertRow();
    head.appendChild(element('th', '', 'LAPTOP'));
    COLUMNS.forEach(({ title, note }) => {
      const th = element('th', '', title);
      if (note) th.appendChild(element('small', '', note));
      head.appendChild(th);
    });
    const rows = table.createTBody();
    event.changes.forEach((change) => {
      const row = rows.insertRow();
      const item = element('td', 'price-notice-item');
      if (change.kind === 'added') item.appendChild(element('span', 'price-notice-tag', 'New'));
      if (change.kind === 'removed') item.appendChild(element('span', 'price-notice-tag removed', 'Removed'));
      item.appendChild(document.createTextNode(change.itemCode));
      const details = [change.promoTitle, change.branch ? `${change.branch} only` : ''].filter(Boolean).join(' · ');
      if (details) item.appendChild(element('small', '', details));
      row.appendChild(item);
      COLUMNS.forEach(({ field }) => row.appendChild(priceCell(change, field)));
    });
    section.appendChild(table);
    return section;
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
  window.saleskit.onPriceChanges((events) => {
    if (!Array.isArray(events) || !events.length) return;
    if (!backdrop || filterBar) open('new');
    [...events].reverse().forEach((event) => {
      body.insertBefore(eventSection(event), body.firstChild);
      shownCount += event.changes.length;
    });
    summary.textContent = `${shownCount} laptop price${shownCount === 1 ? '' : 's'} changed in NEW PRICING. The banners and Reco Table now use the new prices.`;
    body.scrollTop = 0;
    // SalesKit was in the background: the dot stays on the button until the changes are opened.
    if (!document.hasFocus()) setUnseen(true);
  });

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
    shown.slice().reverse().forEach((event) => body.appendChild(eventSection(event)));
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
    button.title = 'Price changes from NEW PRICING';
    button.innerHTML = '<i class="bi bi-tags-fill" aria-hidden="true"></i><span>Price changes</span><span class="price-changes-dot" aria-hidden="true"></span>';
    button.addEventListener('click', openHistory);
    wrap.append(button, modes);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButton);
  else addButton();
})();
