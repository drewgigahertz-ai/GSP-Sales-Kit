// Zoom in the header: − 100% + after the Updates and keyboard buttons (electron/zoom.js does the zooming, also for
// Ctrl+Plus / Ctrl+Minus / Ctrl+0 and Ctrl + mouse wheel). Clicking the percentage goes back to 100%.
(function () {
  if (!window.saleskit || typeof window.saleskit.changeZoom !== 'function') return;

  const style = document.createElement('style');
  style.textContent = `
    .zoom-control {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      border: 1px solid rgba(255, 255, 255, 0.35);
      border-radius: 999px;
    }

    .zoom-control button {
      min-width: 26px;
      height: 26px;
      padding: 0 6px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 0.8rem;
      font-weight: 700;
      line-height: 1;
      cursor: pointer;
    }

    .zoom-control button:hover {
      background: rgba(255, 255, 255, 0.18);
    }

    .zoom-control .zoom-value {
      min-width: 44px;
    }
  `;
  document.head.appendChild(style);

  let value = null;

  function show(factor) {
    if (value) value.textContent = `${Math.round(factor * 100)}%`;
  }

  function button(label, title, how) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.title = title;
    element.setAttribute('aria-label', title);
    element.addEventListener('click', () => window.saleskit.changeZoom(how).then(show));
    return element;
  }

  function addControl() {
    if (document.getElementById('zoomControl')) return true;
    const after = document.getElementById('btnHotkeys') || document.getElementById('btnUpdates');
    if (!after) return false;
    const control = document.createElement('div');
    control.className = 'zoom-control';
    control.id = 'zoomControl';
    control.setAttribute('role', 'group');
    control.setAttribute('aria-label', 'Zoom');
    value = button('100%', 'Back to 100% (Ctrl+0)', 'reset');
    value.classList.add('zoom-value');
    control.append(button('−', 'Zoom out (Ctrl+Minus)', 'out'), value, button('+', 'Zoom in (Ctrl+Plus)', 'in'));
    after.insertAdjacentElement('afterend', control);
    window.saleskit.getZoom().then(show);
    return true;
  }

  window.saleskit.onZoomChanged(show);

  // The header buttons it sits next to are added by updates.js and hotkey-help.js, sometimes a moment later.
  function setup() {
    if (addControl()) return;
    let tries = 0;
    const timer = setInterval(() => {
      if (addControl() || ++tries > 20) clearInterval(timer);
    }, 300);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
