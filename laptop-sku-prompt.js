// Laptop SKU (electron/laptop-sku.js): which laptop this is. When a branch account is signed in and the laptop has
// no SKU yet, a window asks for it and cannot be closed until one is chosen (HO and ALL accounts are not asked).
// The SKU is picked from SalesKit's SKU list (a SKU that is not in it can still be used). It becomes the laptop's
// name on the SalesKit Server. "SKU: ... · Change" next to the signed-in name changes it later.
(function () {
  const api = window.saleskit;
  if (!api || typeof api.getLaptopSku !== 'function') return;

  const style = document.createElement('style');
  style.textContent = `
    .laptop-sku-backdrop { position: fixed; inset: 0; z-index: 4000; display: flex; align-items: center; justify-content: center;
      padding: 24px; background: rgba(15, 23, 42, .6); }
    .laptop-sku-dialog { display: flex; width: min(620px, 100%); max-height: min(680px, 100%); flex-direction: column; overflow: hidden;
      border-radius: 16px; background: #fff; box-shadow: 0 24px 60px rgba(15, 23, 42, .35); font-family: 'Outfit', 'Plus Jakarta Sans', sans-serif; }
    .laptop-sku-head { padding: 18px 22px; background: linear-gradient(135deg, #0012b3, #003ecb); color: #fff; }
    .laptop-sku-head h2 { margin: 0; font-size: 1.25rem; font-weight: 800; }
    .laptop-sku-head p { margin: 4px 0 0; font-size: .85rem; opacity: .88; line-height: 1.4; }
    .laptop-sku-body { display: flex; min-height: 0; flex-direction: column; gap: 10px; padding: 16px 22px; }
    .laptop-sku-search { width: 100%; padding: 11px 14px; border: 1px solid #cbd8eb; border-radius: 10px; font: inherit; font-size: 1rem; }
    .laptop-sku-search:focus { outline: 2px solid rgba(0, 62, 203, .25); border-color: #003ecb; }
    .laptop-sku-list { min-height: 120px; max-height: 360px; overflow: auto; margin: 0; padding: 0; list-style: none;
      border: 1px solid #e6ecf5; border-radius: 10px; }
    .laptop-sku-list li button { display: block; width: 100%; padding: 9px 14px; border: 0; border-bottom: 1px solid #eef2f8;
      background: #fff; text-align: left; font: inherit; cursor: pointer; }
    .laptop-sku-list li:last-child button { border-bottom: 0; }
    .laptop-sku-list li button:hover, .laptop-sku-list li button.active { background: #edf3fa; }
    .laptop-sku-list li button[aria-selected="true"] { background: #003ecb; color: #fff; }
    .laptop-sku-list b { display: block; font-size: .9rem; }
    .laptop-sku-list span { font-size: .78rem; opacity: .75; }
    .laptop-sku-note { padding: 18px; color: #64748b; font-size: .85rem; text-align: center; }
    .laptop-sku-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 22px;
      border-top: 1px solid #eef2f8; flex-wrap: wrap; }
    .laptop-sku-chosen { color: #334155; font-size: .85rem; min-width: 0; overflow-wrap: anywhere; }
    .laptop-sku-actions { display: flex; gap: 8px; margin-left: auto; }
    .laptop-sku-actions button { padding: 9px 18px; border-radius: 10px; font: inherit; font-weight: 700; cursor: pointer; }
    .laptop-sku-save { border: 1px solid #003ecb; background: #003ecb; color: #fff; }
    .laptop-sku-save:disabled { border-color: #b8c4ea; background: #b8c4ea; cursor: not-allowed; }
    .laptop-sku-cancel { border: 1px solid #cbd8eb; background: #fff; color: #334155; }
    .laptop-sku-error { color: #c42424; font-size: .82rem; font-weight: 700; }
    .laptop-sku-label { margin-left: 8px; }
    .laptop-sku-label button { padding: 0; border: 0; background: none; color: inherit; font: inherit; text-decoration: underline; cursor: pointer; }
  `;
  document.head.appendChild(style);

  let choices = [];
  let current = '';

  async function loadChoices() {
    try { choices = await api.getLaptopSkuChoices(); } catch { choices = []; }
    return choices;
  }

  // required: a branch account without a SKU (no Cancel, no Escape).
  function openDialog({ required }) {
    if (document.querySelector('.laptop-sku-backdrop')) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'laptop-sku-backdrop';
    backdrop.innerHTML = `
      <div class="laptop-sku-dialog" role="dialog" aria-modal="true" aria-labelledby="laptopSkuTitle">
        <div class="laptop-sku-head">
          <h2 id="laptopSkuTitle">${required ? 'Which laptop is this?' : 'Change the laptop SKU'}</h2>
          <p>Choose this laptop's SKU. It is how head office knows this laptop. ${required ? 'This is asked once.' : ''}</p>
        </div>
        <div class="laptop-sku-body">
          <input class="laptop-sku-search" type="search" placeholder="Search SKU, brand or model" aria-label="Search SKU, brand or model" autocomplete="off">
          <ul class="laptop-sku-list" role="listbox" aria-label="SKUs"></ul>
          <div class="laptop-sku-error" role="alert"></div>
        </div>
        <div class="laptop-sku-foot">
          <div class="laptop-sku-chosen"></div>
          <div class="laptop-sku-actions">
            ${required ? '' : '<button type="button" class="laptop-sku-cancel">Cancel</button>'}
            <button type="button" class="laptop-sku-save" disabled>Save</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    const search = backdrop.querySelector('.laptop-sku-search');
    const list = backdrop.querySelector('.laptop-sku-list');
    const chosenLabel = backdrop.querySelector('.laptop-sku-chosen');
    const save = backdrop.querySelector('.laptop-sku-save');
    const error = backdrop.querySelector('.laptop-sku-error');
    let chosen = null; // { sku, inList }

    function choose(value) {
      chosen = value;
      save.disabled = !chosen;
      chosenLabel.textContent = chosen ? `${chosen.inList ? 'Chosen' : 'Not in the list'}: ${chosen.sku}` : '';
      [...list.querySelectorAll('button[data-sku]')].forEach((b) => b.setAttribute('aria-selected', String(Boolean(chosen) && b.dataset.sku === chosen.sku)));
    }

    function render() {
      const query = search.value.trim().toLowerCase();
      const words = query.split(/\s+/).filter(Boolean);
      const matches = choices.filter((c) => {
        const textOf = `${c.sku} ${c.brand} ${c.model} ${c.partNumber}`.toLowerCase();
        return words.every((w) => textOf.includes(w));
      }).slice(0, 80);
      list.replaceChildren();
      if (!choices.length) {
        list.innerHTML = '<li class="laptop-sku-note">Loading the SKU list... You can also type the SKU above.</li>';
      } else if (!matches.length) {
        list.innerHTML = '<li class="laptop-sku-note">No SKU in SalesKit\'s list matches. Check the SKU, or use what you typed.</li>';
      }
      for (const c of matches) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.sku = c.sku;
        button.setAttribute('role', 'option');
        const title = document.createElement('b');
        title.textContent = c.sku;
        const sub = document.createElement('span');
        sub.textContent = [c.brand, c.model].filter(Boolean).join(' · ');
        button.append(title, sub);
        button.addEventListener('click', () => choose({ sku: c.sku, inList: true }));
        button.addEventListener('dblclick', () => { choose({ sku: c.sku, inList: true }); save.click(); });
        item.append(button);
        list.append(item);
      }
      // What was typed, when it is not exactly a SKU in the list.
      const typed = search.value.trim();
      const exact = choices.find((c) => c.sku.toLowerCase() === typed.toLowerCase());
      if (exact) choose({ sku: exact.sku, inList: true });
      else if (typed.length >= 3) choose({ sku: typed, inList: false });
      else if (chosen && !chosen.inList) choose(null);
      if (chosen) choose(chosen);
    }

    search.addEventListener('input', () => { error.textContent = ''; render(); });
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && chosen) save.click();
    });
    backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !required) backdrop.remove();
    });
    const cancel = backdrop.querySelector('.laptop-sku-cancel');
    if (cancel) cancel.addEventListener('click', () => backdrop.remove());

    save.addEventListener('click', async () => {
      if (!chosen) return;
      if (!chosen.inList && !window.confirm(`"${chosen.sku}" is not in SalesKit's SKU list. Use it anyway?`)) return;
      save.disabled = true;
      try {
        const result = await api.setLaptopSku(chosen.sku);
        current = result.sku;
        renderLabel();
        backdrop.remove();
      } catch (err) {
        error.textContent = (err && err.message ? err.message : 'Could not save the SKU.').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
        save.disabled = false;
      }
    });

    if (current) search.value = current;
    render();
    search.focus();
    search.select();
    // The list arrives with the SalesKit data; keep asking until it is there.
    (async function waitForChoices() {
      if (!document.body.contains(backdrop)) return;
      if (!choices.length) await loadChoices();
      if (choices.length) render();
      else setTimeout(waitForChoices, 3000);
    })();
  }

  // "SKU: ... · Change" after the signed-in name in the header.
  function renderLabel() {
    const anchor = document.getElementById('signedInUser');
    if (!anchor) return;
    let label = document.getElementById('laptopSkuLabel');
    if (!label) {
      label = document.createElement('span');
      label.id = 'laptopSkuLabel';
      label.className = 'laptop-sku-label';
      anchor.insertAdjacentElement('afterend', label);
    }
    label.replaceChildren();
    const text = document.createElement('span');
    text.textContent = current ? `SKU: ${current} · ` : 'No laptop SKU · ';
    const change = document.createElement('button');
    change.type = 'button';
    change.textContent = current ? 'Change' : 'Set';
    change.addEventListener('click', async () => {
      await loadChoices();
      openDialog({ required: false });
    });
    label.append(text, change);
  }

  async function start() {
    let state;
    try { state = await api.getLaptopSku(); } catch { return; }
    current = state.sku || '';
    renderLabel();
    if (state.required) {
      await loadChoices();
      openDialog({ required: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
