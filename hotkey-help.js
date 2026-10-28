// Keyboard shortcuts cheat sheet: the ⌨ button in the header, or ? anywhere (not while typing), opens a short list
// of keys with a tab per page (Reco Table, Sales Kit, Banner, Presentation), on the page on screen, plus the few
// that work everywhere. The Banner page sends its ? here (banner-hotkeys.js → banner-bridge.js).
(function () {
  const EVERYWHERE = [
    ['Ctrl + 1 / 2 / 3 / 4', 'Reco Table / Sales Kit / Banner / Flyers'],
    ['↑ ↓ then Enter', 'Choose an option in any open list'],
    ['Esc', 'Close the open list or window'],
    ['?', 'Show these shortcuts']
  ];
  const PAGES = {
    recotable: {
      title: 'Reco Table',
      keys: [
        ['Ctrl + Shift + A', 'Applications'],
        ['Ctrl + Shift + L', 'Location'],
        ['Ctrl + Shift + R', 'Recommendation'],
        ['Ctrl + Shift + E / M / B', 'Exceed / Meet / Budget laptop'],
        ['Ctrl + Shift + C', 'Copy Details'],
        ['Ctrl + Shift + P', 'Present'],
        ['Ctrl + D', 'Download Result'],
        ['Ctrl + R', 'Refresh Data']
      ]
    },
    saleskit: {
      title: 'Sales Kit',
      keys: [
        ['Alt + 1 / Alt + 2', 'Applications / Features tab'],
        ['Ctrl + Shift + S', 'Choose applications or features'],
        ['Ctrl + Shift + A', 'Customer’s applications'],
        ['Ctrl + Shift + R', 'Recommendation'],
        ['Ctrl + Shift + P', 'Present'],
        ['Ctrl + D', 'Download Image']
      ]
    },
    banner: {
      title: 'Banner',
      keys: [
        ['Ctrl + Shift + B', 'Branch'],
        ['Ctrl + F', 'Search laptops'],
        ['Alt + ↑ / Alt + ↓', 'Previous / next laptop'],
        ['Ctrl + Shift + P', 'Promo'],
        ['Ctrl + Shift + C', 'Colour'],
        ['Alt + 1 / Alt + 2', 'Clearance / Generated banner'],
        ['Ctrl + D', 'Download banner'],
        ['Ctrl + Shift + F', 'Fullscreen'],
        ['Ctrl + R', 'Refresh data']
      ]
    },
    flyers: {
      title: 'Flyers',
      keys: [
        ['Ctrl + Shift + B', 'Branch'],
        ['Ctrl + Shift + C', 'Contact No.'],
        ['Ctrl + Shift + L', 'Look for'],
        ['Ctrl + D', 'Download (PDF or PNG)'],
        ['Ctrl + P', 'Print'],
        ['Ctrl + R', 'Refresh data']
      ]
    },
    presentation: {
      title: 'Presentation',
      keys: [
        ['← / →', 'Previous / next slide'],
        ['Space', 'Start / stop the slideshow'],
        ['Ctrl + 1 / 2 / 3', 'Reco Table / Applications / Features'],
        ['Ctrl + Shift + S', 'Choose applications or features'],
        ['B + 1 / 2 / 3', 'View a laptop’s feature banner'],
        ['Esc', 'Close the banner, then the presentation']
      ]
    }
  };

  const style = document.createElement('style');
  style.textContent = `
    .hotkey-help-backdrop {
      position: fixed;
      inset: 0;
      z-index: 4000;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(15, 23, 42, .45);
    }

    .hotkey-help-dialog {
      width: min(520px, calc(100vw - 32px));
      max-height: calc(100vh - 48px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 24px 60px rgba(15, 23, 42, .3);
      font-family: 'Outfit', sans-serif;
    }

    .hotkey-help-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 22px;
      background: linear-gradient(135deg, #0012b3, #003ecb);
      color: #fff;
    }

    .hotkey-help-header .bi {
      font-size: 1.5rem;
    }

    .hotkey-help-header h2 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 800;
    }

    .hotkey-help-header p {
      margin: 0;
      color: #c9d6ff;
      font-size: .82rem;
    }

    .hotkey-help-tabs {
      display: flex;
      gap: 4px;
      padding: 10px 22px 0;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fafc;
    }

    .hotkey-help-tabs button {
      padding: 8px 14px;
      border: 0;
      border-bottom: 3px solid transparent;
      background: none;
      color: #64748b;
      font: inherit;
      font-size: .85rem;
      font-weight: 700;
      cursor: pointer;
    }

    .hotkey-help-tabs button.is-active {
      border-bottom-color: #003ecb;
      color: #0012b3;
    }

    .hotkey-help-body {
      overflow: auto;
      padding: 8px 22px 16px;
    }

    .hotkey-help-body h3 {
      margin: 14px 0 6px;
      color: #0012b3;
      font-size: .78rem;
      font-weight: 800;
      letter-spacing: .08em;
      text-transform: uppercase;
    }

    .hotkey-help-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 6px 0;
      border-bottom: 1px solid #eef2f8;
      color: #1e293b;
      font-size: .9rem;
    }

    .hotkey-help-row:last-child {
      border-bottom: 0;
    }

    .hotkey-help-row kbd {
      flex: none;
      padding: 2px 8px;
      border: 1px solid #cbd5e1;
      border-bottom-width: 2px;
      border-radius: 6px;
      background: #f8fafc;
      color: #0f172a;
      font-family: inherit;
      font-size: .8rem;
      font-weight: 700;
      white-space: nowrap;
    }

    .hotkey-help-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 22px;
      border-top: 1px solid #e2e8f0;
      color: #64748b;
      font-size: .8rem;
    }

    .hotkey-help-footer button {
      padding: 8px 26px;
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

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // The page on screen: the presentation when it is open, else the active tab.
  function currentPage() {
    const overlay = document.getElementById('salesKitPresentation');
    if (overlay && overlay.classList.contains('is-open')) return 'presentation';
    try {
      return PAGES[currentActiveView] ? currentActiveView : 'recotable';
    } catch {
      return 'recotable';
    }
  }

  function section(title, keys) {
    const wrap = element('section');
    wrap.appendChild(element('h3', '', title));
    keys.forEach(([key, action]) => {
      const row = element('div', 'hotkey-help-row');
      row.append(element('span', '', action), element('kbd', '', key));
      wrap.appendChild(row);
    });
    return wrap;
  }

  let backdrop = null;

  function close() {
    if (!backdrop) return;
    backdrop.remove();
    backdrop = null;
    document.removeEventListener('keydown', onKeydown, true);
  }

  function onKeydown(event) {
    if (event.key === 'Escape' || event.key === '?') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  // Opens on the tab of the page on screen (or the one given); the other pages are a tab away.
  function open(pageName) {
    close();
    let shown = PAGES[pageName] ? pageName : currentPage();
    backdrop = element('div', 'hotkey-help-backdrop');
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close();
    });
    const dialog = element('div', 'hotkey-help-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'hotkeyHelpTitle');

    const header = element('div', 'hotkey-help-header');
    header.innerHTML = '<i class="bi bi-keyboard" aria-hidden="true"></i>';
    const heading = element('div');
    const title = element('h2', '', 'Keyboard shortcuts');
    title.id = 'hotkeyHelpTitle';
    heading.append(title, element('p', '', 'Hover over any button to see its key too.'));
    header.appendChild(heading);

    const tabs = element('div', 'hotkey-help-tabs');
    tabs.setAttribute('role', 'tablist');
    const body = element('div', 'hotkey-help-body');
    function show(name) {
      shown = name;
      tabs.querySelectorAll('button').forEach((tab) => {
        const active = tab.dataset.page === name;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', String(active));
      });
      body.replaceChildren(section(PAGES[name].title, PAGES[name].keys), section('Everywhere', EVERYWHERE));
    }
    Object.entries(PAGES).forEach(([name, page]) => {
      const tab = element('button', '', page.title);
      tab.type = 'button';
      tab.dataset.page = name;
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', () => show(name));
      tabs.appendChild(tab);
    });
    show(shown);

    const footer = element('div', 'hotkey-help-footer');
    footer.appendChild(element('span', '', 'Press ? or Esc to close'));
    const ok = element('button', '', 'Close');
    ok.type = 'button';
    ok.addEventListener('click', close);
    footer.appendChild(ok);

    dialog.append(header, tabs, body, footer);
    backdrop.appendChild(dialog);
    // Inside the presentation while it is fullscreen, so it shows over it.
    const overlay = document.getElementById('salesKitPresentation');
    (document.fullscreenElement === overlay && overlay ? overlay : document.body).appendChild(backdrop);
    document.addEventListener('keydown', onKeydown, true);
    ok.focus();
  }

  window.openHotkeyHelp = open;

  // ? anywhere, except while typing in a box.
  document.addEventListener('keydown', (event) => {
    if (event.key !== '?' || event.ctrlKey || event.altKey || event.metaKey || backdrop) return;
    const target = event.target;
    if (target && (target.isContentEditable || (target instanceof HTMLInputElement && target.type !== 'checkbox')
      || target instanceof HTMLTextAreaElement)) return;
    event.preventDefault();
    open();
  });

  // The header: a small ⌨ button after the Updates button (updates.js).
  function addButton() {
    if (document.getElementById('btnHotkeys')) return;
    const updates = document.getElementById('btnUpdates');
    if (!updates) return;
    const button = element('button', 'btn btn-sm updates-button');
    button.type = 'button';
    button.id = 'btnHotkeys';
    button.title = 'Keyboard shortcuts (?)';
    button.setAttribute('aria-label', 'Keyboard shortcuts');
    button.innerHTML = '<i class="bi bi-keyboard" aria-hidden="true"></i>';
    button.addEventListener('click', () => open());
    updates.insertAdjacentElement('afterend', button);
  }

  function setup() {
    addButton();
    // The Updates button may be added a moment later.
    if (!document.getElementById('btnHotkeys')) setTimeout(addButton, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
