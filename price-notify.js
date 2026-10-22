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
    shownCount = 0;
    document.removeEventListener('keydown', onKeydown, true);
  }

  function onKeydown(event) {
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  function open() {
    backdrop = element('div', 'price-notice-backdrop');
    const dialog = element('div', 'price-notice');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'priceNoticeTitle');
    const header = element('div', 'price-notice-header');
    header.innerHTML = '<i class="bi bi-tags-fill" aria-hidden="true"></i>';
    const heading = element('div');
    const title = element('h2', '', 'Prices updated');
    title.id = 'priceNoticeTitle';
    summary = element('p');
    heading.append(title, summary);
    header.appendChild(heading);
    body = element('div', 'price-notice-body');
    const footer = element('div', 'price-notice-footer');
    const ok = element('button', '', 'Got it');
    ok.type = 'button';
    ok.addEventListener('click', close);
    footer.appendChild(ok);
    dialog.append(header, body, footer);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', onKeydown, true);
    ok.focus();
  }

  // events: oldest first; the newest change is shown at the top.
  window.saleskit.onPriceChanges((events) => {
    if (!Array.isArray(events) || !events.length) return;
    if (!backdrop) open();
    [...events].reverse().forEach((event) => {
      body.insertBefore(eventSection(event), body.firstChild);
      shownCount += event.changes.length;
    });
    summary.textContent = `${shownCount} laptop price${shownCount === 1 ? '' : 's'} changed in NEW PRICING. The banners and Reco Table now use the new prices.`;
    body.scrollTop = 0;
  });
})();
