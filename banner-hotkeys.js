// Banner page hotkeys. Ctrl+D (download) and Ctrl+1/2/3 (switch pages) stay in banner.html; the rest are here.
// Each control's tooltip shows its key.
(function () {
  const $ = (id) => document.getElementById(id);

  // Opens a dropdown's list at once (arrow keys and Enter pick); just focuses it where that is not possible.
  function openSelect(id) {
    const select = $(id);
    if (!select || select.disabled || select.closest('[hidden]')) return;
    select.focus();
    try {
      select.showPicker();
    } catch {}
  }

  function click(element) {
    if (element && !element.disabled && !element.closest('[hidden]')) element.click();
  }

  // Previous (-1) or next (+1) laptop in the list.
  function stepLaptop(step) {
    const options = [...document.querySelectorAll('#list .list-group-item')];
    if (!options.length) return;
    const current = options.findIndex((option) => option.classList.contains('active'));
    const next = current < 0 ? 0 : Math.min(options.length - 1, Math.max(0, current + step));
    if (next === current) return;
    options[next].scrollIntoView({ block: 'nearest' });
    options[next].click();
  }

  // ctrl / shift / alt must match exactly; code: event.code.
  const KEYS = [
    { ctrl: true, shift: true, code: 'KeyB', run: () => openSelect('branchSelect') },
    { ctrl: true, code: 'KeyF', run: () => { $('productSearch').focus(); $('productSearch').select(); } },
    { alt: true, code: 'ArrowUp', run: () => stepLaptop(-1) },
    { alt: true, code: 'ArrowDown', run: () => stepLaptop(1) },
    { ctrl: true, shift: true, code: 'KeyP', run: () => openSelect('promoSelect') },
    { ctrl: true, shift: true, code: 'KeyC', run: () => openSelect('colorSelect') },
    { alt: true, code: 'Digit1', run: () => click(document.querySelector('#bannerViewSwitch [data-view="ageing"]')) },
    { alt: true, code: 'Digit2', run: () => click(document.querySelector('#bannerViewSwitch [data-view="generated"]')) },
    { ctrl: true, code: 'KeyR', run: () => click($('refreshBannerButton')) },
    { ctrl: true, shift: true, code: 'KeyF', run: () => click($('fullscreenButton')) }
  ];

  document.addEventListener('keydown', (event) => {
    // ? (not while typing): the shortcuts list, shown by SalesKit around this page (hotkey-help.js).
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    if (event.key === '?' && !typing && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      window.parent.postMessage({ channel: 'saleskit-banner-help' }, '*');
      return;
    }
    const ctrl = event.ctrlKey || event.metaKey;
    const key = KEYS.find((entry) => entry.code === event.code
      && Boolean(entry.ctrl) === ctrl && Boolean(entry.shift) === event.shiftKey && Boolean(entry.alt) === event.altKey);
    if (!key) return;
    event.preventDefault();
    key.run();
  });

  // Tooltips with the keys.
  function hint(element, text) {
    if (element) element.title = text;
  }
  document.addEventListener('DOMContentLoaded', () => {
    hint($('branchSelect'), 'Branch (Ctrl+Shift+B)');
    hint($('productSearch'), 'Search laptops (Ctrl+F); Alt+↑ / Alt+↓: previous / next laptop');
    hint($('promoSelect'), 'Promo title for this laptop (Ctrl+Shift+P)');
    hint($('colorSelect'), 'Colour of the cash price box (Ctrl+Shift+C)');
    hint($('refreshBannerButton'), 'Load the latest data from the SalesKit server (Ctrl+R)');
    hint(document.querySelector('#bannerViewSwitch [data-view="ageing"]'), 'Clearance banner (Alt+1)');
    hint(document.querySelector('#bannerViewSwitch [data-view="generated"]'), 'Generated banner (Alt+2)');
  });
})();
