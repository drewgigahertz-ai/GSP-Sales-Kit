// Presentation view, Applications and Features tabs: the application / feature name opens the same multi-select
// as the Sales Kit dropdown (search, checkboxes, Select All / Clear). Ticking an item adds it to the Sales Kit
// selection and its slide to the presentation (shown at once); unticking removes it. At least one stays ticked.
// The Reco Table tab keeps the plain title.
(function () {
  const CHEVRON = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath fill='%230012b3' d='M1.6 4.6a.75.75 0 0 1 1.06 0L8 9.94l5.34-5.34a.75.75 0 1 1 1.06 1.06l-5.87 5.87a.75.75 0 0 1-1.06 0L1.6 5.66a.75.75 0 0 1 0-1.06z'/%3E%3C/svg%3E\")";
  const style = document.createElement('style');
  style.textContent = `
    .saleskit-presentation-title.has-jump {
      display: inline-block;
      margin-left: -8px;
      padding: 0 8px 2px;
      border: 2px solid transparent;
      border-radius: 12px;
    }

    .saleskit-presentation-title.has-jump::after {
      content: '';
      display: inline-block;
      width: .5em;
      height: .5em;
      margin-left: .3em;
      background: ${CHEVRON} no-repeat center / contain;
      vertical-align: .12em;
    }

    .saleskit-presentation-title.has-jump.is-hover {
      background: rgba(0, 62, 203, .06);
    }

    .saleskit-presentation-title.has-jump.is-focus {
      border-color: #003ecb;
    }

    .saleskit-presentation-picker-trigger {
      position: absolute;
      z-index: 1;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: pointer;
    }

    .saleskit-presentation-picker-trigger[hidden],
    .saleskit-presentation-picker[hidden] {
      display: none;
    }

    .saleskit-presentation-picker {
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

    .saleskit-presentation-picker .picker-search {
      margin: 10px;
      padding: 7px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 7px;
      font: inherit;
      font-size: .9rem;
      outline: 0;
    }

    .saleskit-presentation-picker .picker-search:focus {
      border-color: #003ecb;
      box-shadow: 0 0 0 3px rgba(0, 62, 203, .12);
    }

    .saleskit-presentation-picker .picker-head {
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

    .saleskit-presentation-picker .picker-head button {
      border: 0;
      background: none;
      color: #0d6efd;
      font: inherit;
      cursor: pointer;
    }

    .saleskit-presentation-picker .picker-head .picker-clear {
      color: #64748b;
    }

    .saleskit-presentation-picker .picker-list {
      overflow-y: auto;
    }

    .saleskit-presentation-picker label {
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

    .saleskit-presentation-picker label:hover {
      background: #f1f5ff;
    }

    .saleskit-presentation-picker label[hidden] {
      display: none;
    }

    .saleskit-presentation-picker input[type="checkbox"] {
      width: 17px;
      height: 17px;
      flex: none;
    }

    .saleskit-presentation-picker img,
    .saleskit-presentation-picker .bi {
      width: 20px;
      height: 20px;
      flex: none;
      object-fit: contain;
      color: #0d6efd;
      font-size: 1rem;
      text-align: center;
    }
  `;
  document.head.appendChild(style);

  // What each tab lists and how it changes the Sales Kit selection (functions and lists from saleskit.html).
  // items(): [{ key, name, image | iconClass }]; selected(): the ticked keys.
  const SOURCES = {
    apps: {
      label: 'Applications',
      items: () => APP_DATABASE.map((app) => ({ key: app.id, name: app.name, image: app.icon })),
      selected: () => selectedSalesKitAppIds,
      toggle: (key) => handleSalesKitAppToggle(key),
      selectAll: () => selectAllSalesKitApps(),
      clear: () => clearAllSalesKitApps()
    },
    features: {
      label: 'Features',
      // Banner dots and Recommended / Not recommended groups (feature-banner-status.js).
      items: () => {
        const laptops = window.FeatureBannerStatus ? FeatureBannerStatus.laptops() : [];
        return getActiveFeaturesList().map((feature) => ({
          key: feature,
          name: feature,
          iconClass: getUkspFeatureIcon(feature),
          banners: window.FeatureBannerStatus ? FeatureBannerStatus.statusOf(feature, laptops) : null
        }));
      },
      selected: () => selectedFeatures,
      toggle: (key) => handleFeatureToggle(key),
      selectAll: () => selectAllFeatures(),
      clear: () => clearAllFeatures()
    }
  };

  function setup() {
    const title = document.getElementById('salesKitPresentationTitle');
    const counter = document.getElementById('salesKitPresentationCounter');
    if (!title || !counter || !title.parentElement) return;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'saleskit-presentation-picker-trigger';
    trigger.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'saleskit-presentation-picker';
    panel.hidden = true;
    panel.innerHTML = `
      <input class="picker-search" type="search" autocomplete="off">
      <div class="picker-head">
        <span class="picker-label"></span>
        <span><button type="button" class="picker-all">Select All</button> | <button type="button" class="picker-clear">Clear</button></span>
      </div>
      <div class="picker-list" role="group"></div>
    `;
    const search = panel.querySelector('.picker-search');
    const list = panel.querySelector('.picker-list');

    title.parentElement.style.position = 'relative';
    title.insertAdjacentElement('afterend', trigger);
    trigger.insertAdjacentElement('afterend', panel);

    // The presentation's current tab, its slides and where its items come from; null outside apps / features.
    function current() {
      try {
        const source = SOURCES[salesKitPresentationMode];
        return source ? { mode: salesKitPresentationMode, source, slides: salesKitPresentationSlides } : null;
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
      const now = current();
      if (!now) return;
      const selected = now.source.selected();
      panel.querySelector('.picker-label').textContent = now.source.label;
      search.placeholder = `Search ${now.source.label.toLowerCase()}...`;
      list.setAttribute('aria-label', now.source.label);
      const rows = now.source.items().map((item) => {
        const row = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.value = item.key;
        box.checked = selected.includes(item.key);
        let icon;
        if (item.iconClass) {
          icon = document.createElement('i');
          icon.className = `bi ${item.iconClass}`;
        } else {
          icon = document.createElement('img');
          icon.src = item.image || '';
          icon.alt = '';
          icon.onerror = () => { icon.style.visibility = 'hidden'; };
        }
        const name = document.createElement('span');
        name.textContent = item.name;
        row.append(box, icon, name);
        if (item.banners) {
          row.appendChild(FeatureBannerStatus.dotsElement(item.banners));
          row.classList.toggle('feature-is-not-recommended', item.banners.known && !item.banners.recommended);
        }
        return { row, item };
      });
      // Features of a generated result: Recommended first, then Not recommended, each under its heading.
      const grouped = rows.some(({ item }) => item.banners && item.banners.known);
      if (grouped) {
        const recommended = rows.filter(({ item }) => item.banners.recommended).map(({ row }) => row);
        const notRecommended = rows.filter(({ item }) => !item.banners.recommended).map(({ row }) => row);
        list.replaceChildren(
          ...(recommended.length ? [FeatureBannerStatus.groupHead(true), ...recommended] : []),
          ...(notRecommended.length ? [FeatureBannerStatus.groupHead(false), ...notRecommended] : [])
        );
      } else {
        list.replaceChildren(...rows.map(({ row }) => row));
      }
      filter();
    }

    // Rebuilds the slides from the Sales Kit selection and shows the given item (or stays on the one on screen;
    // the nearest one when that was unticked).
    function rebuild(mode, showName) {
      const shownTitle = showName || (salesKitPresentationSlides[activeSalesKitPresentationSlide] || {}).title;
      const previousIndex = activeSalesKitPresentationSlide;
      const slides = buildSalesKitPresentationSlides(mode);
      if (!slides.length) return;
      const found = slides.findIndex((slide) => slide.title === shownTitle);
      salesKitPresentationSlides = slides;
      activeSalesKitPresentationSlide = found >= 0 ? found : Math.min(previousIndex, slides.length - 1);
      renderSalesKitPresentationSlide();
    }

    list.addEventListener('change', (event) => {
      const box = event.target;
      const now = current();
      if (!now || box.type !== 'checkbox') return;
      // The presentation always keeps one item.
      if (!box.checked && now.source.selected().length <= 1) {
        box.checked = true;
        return;
      }
      const item = now.source.items().find((entry) => entry.key === box.value);
      now.source.toggle(box.value);
      rebuild(now.mode, box.checked && item ? item.name : null);
    });

    panel.querySelector('.picker-all').addEventListener('click', () => {
      const now = current();
      if (!now) return;
      now.source.selectAll();
      rebuild(now.mode);
      renderList();
    });

    // Clear keeps the item on screen.
    panel.querySelector('.picker-clear').addEventListener('click', () => {
      const now = current();
      if (!now) return;
      const shownTitle = (now.slides[activeSalesKitPresentationSlide] || {}).title;
      const shown = now.source.items().find((item) => item.name === shownTitle);
      now.source.clear();
      if (shown) now.source.toggle(shown.key);
      rebuild(now.mode);
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

    let shownMode = null;

    // Called whenever a slide is shown (the counter changes with every slide).
    function update() {
      const now = current();
      const useList = Boolean(now) && now.slides.length > 0;
      trigger.hidden = !useList;
      title.classList.toggle('has-jump', useList);
      if (!useList) {
        close();
        shownMode = null;
        return;
      }
      trigger.setAttribute('aria-label', `Choose ${now.source.label.toLowerCase()}`);
      // Switching between Applications and Features closes the other tab's list.
      if (shownMode !== now.mode) close();
      shownMode = now.mode;
      cover();
      if (!panel.hidden) renderList();
    }

    new MutationObserver(update).observe(counter, { childList: true, characterData: true, subtree: true });
    window.addEventListener('resize', cover);
    // The title font loads after the first slide; keep the cover in step with its size.
    if (window.ResizeObserver) new ResizeObserver(cover).observe(title);
    update();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
