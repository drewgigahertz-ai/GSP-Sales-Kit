// Presentation view, Applications tab: the application name opens the same multi-select as the Sales Kit
// Applications dropdown (search, checkboxes, Select All / Clear). Ticking an application adds it to the Sales Kit
// selection and its slide to the presentation (shown at once); unticking removes it. At least one stays ticked.
(function () {
  const style = document.createElement('style');
  style.textContent = `
    .saleskit-presentation-apps-trigger {
      position: absolute;
      z-index: 1;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: pointer;
    }

    .saleskit-presentation-apps-trigger[hidden],
    .saleskit-presentation-apps-panel[hidden] {
      display: none;
    }

    .saleskit-presentation-apps-panel {
      position: absolute;
      z-index: 30;
      width: min(460px, 90vw);
      max-height: min(440px, 60vh);
      display: flex;
      flex-direction: column;
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      background: #fff;
      box-shadow: 0 18px 40px rgba(15, 23, 42, .18);
      font-family: 'Outfit', sans-serif;
      text-align: left;
      overflow: hidden;
    }

    .saleskit-presentation-apps-panel .apps-search {
      margin: 10px;
      padding: 7px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 7px;
      font: inherit;
      font-size: .9rem;
      outline: 0;
    }

    .saleskit-presentation-apps-panel .apps-search:focus {
      border-color: #003ecb;
      box-shadow: 0 0 0 3px rgba(0, 62, 203, .12);
    }

    .saleskit-presentation-apps-panel .apps-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 14px;
      border-top: 1px solid #e2e8f0;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fafc;
      color: #475569;
      font-size: .82rem;
      font-weight: 700;
    }

    .saleskit-presentation-apps-panel .apps-head button {
      border: 0;
      background: none;
      color: #0d6efd;
      font: inherit;
      cursor: pointer;
    }

    .saleskit-presentation-apps-panel .apps-head .apps-clear {
      color: #64748b;
    }

    .saleskit-presentation-apps-panel .apps-list {
      overflow-y: auto;
    }

    .saleskit-presentation-apps-panel label {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0;
      padding: 7px 14px;
      border-bottom: 1px solid #f1f5f9;
      color: #0f172a;
      font-size: .9rem;
      font-weight: 600;
      cursor: pointer;
    }

    .saleskit-presentation-apps-panel label:hover {
      background: #f1f5ff;
    }

    .saleskit-presentation-apps-panel label[hidden] {
      display: none;
    }

    .saleskit-presentation-apps-panel input[type="checkbox"] {
      width: 17px;
      height: 17px;
      flex: none;
    }

    .saleskit-presentation-apps-panel img {
      width: 20px;
      height: 20px;
      flex: none;
      object-fit: contain;
    }
  `;
  document.head.appendChild(style);

  function setup() {
    const title = document.getElementById('salesKitPresentationTitle');
    const counter = document.getElementById('salesKitPresentationCounter');
    if (!title || !counter || !title.parentElement) return;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'saleskit-presentation-apps-trigger';
    trigger.setAttribute('aria-label', 'Choose applications');
    trigger.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'saleskit-presentation-apps-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <input class="apps-search" type="search" placeholder="Search applications..." autocomplete="off">
      <div class="apps-head">
        <span>Applications</span>
        <span><button type="button" class="apps-all">Select All</button> | <button type="button" class="apps-clear">Clear</button></span>
      </div>
      <div class="apps-list" role="group" aria-label="Applications"></div>
    `;
    const search = panel.querySelector('.apps-search');
    const list = panel.querySelector('.apps-list');

    title.parentElement.style.position = 'relative';
    title.insertAdjacentElement('afterend', trigger);
    trigger.insertAdjacentElement('afterend', panel);

    function state() {
      try {
        return {
          mode: salesKitPresentationMode,
          slides: salesKitPresentationSlides,
          apps: APP_DATABASE,
          selected: selectedSalesKitAppIds
        };
      } catch {
        return null;
      }
    }

    // The trigger covers the title exactly; the list opens under it.
    function cover() {
      if (trigger.hidden) return;
      trigger.style.left = `${title.offsetLeft}px`;
      trigger.style.top = `${title.offsetTop}px`;
      trigger.style.width = `${title.offsetWidth}px`;
      trigger.style.height = `${title.offsetHeight}px`;
      panel.style.left = `${title.offsetLeft}px`;
      panel.style.top = `${title.offsetTop + title.offsetHeight + 6}px`;
    }

    function filter() {
      const query = search.value.trim().toLowerCase();
      list.querySelectorAll('label').forEach((row) => {
        row.hidden = Boolean(query) && !row.textContent.toLowerCase().includes(query);
      });
    }

    function renderList() {
      const current = state();
      if (!current) return;
      list.replaceChildren(...current.apps.map((app) => {
        const row = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.value = app.id;
        box.checked = current.selected.includes(app.id);
        const icon = document.createElement('img');
        icon.src = app.icon || '';
        icon.alt = '';
        icon.onerror = () => { icon.style.visibility = 'hidden'; };
        const name = document.createElement('span');
        name.textContent = app.name;
        row.append(box, icon, name);
        return row;
      }));
      filter();
    }

    // Rebuilds the slides from the Sales Kit selection and shows the given application (or stays on the one
    // on screen; the nearest one when that was unticked).
    function rebuild(showName) {
      const current = state();
      if (!current) return;
      const shownTitle = showName || (current.slides[activeSalesKitPresentationSlide] || {}).title;
      const previousIndex = activeSalesKitPresentationSlide;
      const slides = buildSalesKitPresentationSlides('apps');
      if (!slides.length) return;
      const found = slides.findIndex((slide) => slide.title === shownTitle);
      salesKitPresentationSlides = slides;
      activeSalesKitPresentationSlide = found >= 0 ? found : Math.min(previousIndex, slides.length - 1);
      renderSalesKitPresentationSlide();
    }

    list.addEventListener('change', (event) => {
      const box = event.target;
      const current = state();
      if (!current || box.type !== 'checkbox') return;
      // The presentation always keeps one application.
      if (!box.checked && current.selected.length <= 1) {
        box.checked = true;
        return;
      }
      const app = current.apps.find((entry) => entry.id === box.value);
      handleSalesKitAppToggle(box.value);
      rebuild(box.checked && app ? app.name : null);
    });

    panel.querySelector('.apps-all').addEventListener('click', () => {
      selectAllSalesKitApps();
      rebuild();
      renderList();
    });

    // Clear keeps the application on screen.
    panel.querySelector('.apps-clear').addEventListener('click', () => {
      const current = state();
      if (!current) return;
      const shown = current.apps.find((app) => app.name === (current.slides[activeSalesKitPresentationSlide] || {}).title);
      clearAllSalesKitApps();
      if (shown) handleSalesKitAppToggle(shown.id);
      rebuild();
      renderList();
    });

    function open() {
      renderList();
      panel.hidden = false;
      cover();
      search.value = '';
      filter();
      search.focus();
      title.classList.add('is-focus');
    }

    function close() {
      if (panel.hidden) return;
      panel.hidden = true;
      title.classList.remove('is-focus');
    }

    trigger.addEventListener('click', () => (panel.hidden ? open() : close()));
    trigger.addEventListener('mouseenter', () => title.classList.add('is-hover'));
    trigger.addEventListener('mouseleave', () => title.classList.remove('is-hover'));
    search.addEventListener('input', filter);
    // Keys typed in the list stay there (the arrows do not move slides); Esc closes the list only.
    panel.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        close();
        trigger.focus();
      }
    });
    document.addEventListener('mousedown', (event) => {
      if (!panel.contains(event.target) && event.target !== trigger) close();
    });

    // Called whenever a slide is shown (the counter changes with every slide).
    function update() {
      const current = state();
      const useList = Boolean(current) && current.mode === 'apps' && current.slides.length > 0;
      trigger.hidden = !useList;
      if (current && current.mode === 'apps') title.classList.toggle('has-jump', useList);
      if (!useList) {
        close();
        return;
      }
      cover();
      if (!panel.hidden) renderList();
    }

    new MutationObserver(update).observe(counter, { childList: true, characterData: true, subtree: true });
    window.addEventListener('resize', cover);
    if (window.ResizeObserver) new ResizeObserver(cover).observe(title);
    update();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
