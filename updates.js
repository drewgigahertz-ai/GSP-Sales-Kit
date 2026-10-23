// "What's new": an Updates button in the header (next to Price changes) opens the list of changes per version.
// It also opens by itself once after the app updates. Add the new version at the top of RELEASES when releasing.
(function () {
  const RELEASES = [
    {
      version: '1.0.16',
      date: 'October 23, 2026',
      changes: [
        'Applications: each app shows what it is and who it is best for, as tags.',
        'Applications: the benchmark details are grouped with spaces between them.',
        'Presentation: the application or feature name opens a list with checkboxes, the same as the Sales Kit dropdown.'
      ]
    },
    {
      version: '1.0.15',
      date: 'October 23, 2026',
      changes: [
        'Banner: Download button (or Ctrl+D) saves the banner on screen as a picture; logos keep their shape.',
        'Banner: Colour dropdown: the colour follows the segment, or pick another one (or the banner blue).',
        'Banner: hotkeys for every dropdown and button; hover over one to see its key.',
        'Banner: the price codes at the bottom are shown without commas and decimals.',
        'Reco Table: the display shows the full resolution, in bold, without ranking colours.',
        'Banner: pick a branch to list only the laptops in stock there, each with "N in stock".',
        'Banner: the banner colour follows the picked branch\'s segment.',
        'Banner: bigger promo pictures.',
        'Price changes are back: a summary card under the Price changes button, and the full list with a date filter.',
        'Prices load faster.',
        'Updates button: this list.'
      ]
    },
    {
      version: '1.0.14',
      date: 'October 22, 2026',
      changes: ['Price-change notices paused for maintenance.']
    },
    {
      version: '1.0.13',
      date: 'October 22, 2026',
      changes: [
        'New name: Gigahertz Sales Tools.',
        'New pricing source for the Banner, Reco Table and Sales Kit.',
        'Price changes: a notice when prices change, and a Price changes button with the last 30 days.',
        'Banner: cash price colour by segment (Productivity, Performance, Entry, AAA Gamers, Casual Gamers).',
        'Banner: steps on the left (Branch, Laptop); the promo title dropdown above the banner switches the promo, prices and price details.',
        'Part number under the laptop name on the Reco Table, Sales Kit and Banner list.',
        'Specs colours (Best / Better / Good) now follow the Storage, Memory and Display ranks too.',
        'Presentation: click the application or feature name to jump to another one.',
        'Hotkeys: Alt+1 / Alt+2 for the Sales Kit Applications / Features tabs, Ctrl+Shift+S for their selector.'
      ]
    },
    {
      version: '1.0.12',
      date: 'October 21, 2026',
      changes: [
        'Keyboard shortcuts: Ctrl+1 / Ctrl+2 / Ctrl+3 for the Reco Table, Sales Kit and Banner tabs, Ctrl+D to download, and more.',
        'Banner: branch promos with start and end dates, and a branch selector.',
        'Presentation: long rows shrink to fit the screen.'
      ]
    },
    {
      version: '1.0.11',
      date: 'October 15, 2026',
      changes: [
        'Branch accounts start on SMT with their branch; OSD (all locations) asks first.',
        'Banner: the promo picture follows each laptop\'s promo; ageing promos show the clearance banner.'
      ]
    }
  ];

  const SEEN_KEY = 'ghz_whats_new_seen';

  const style = document.createElement('style');
  style.textContent = `
    .updates-button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1.5px solid rgba(255, 255, 255, .55);
      border-radius: 999px;
      background: rgba(255, 255, 255, .1);
      color: #fff;
      font-weight: 700;
    }

    .updates-button:hover,
    .updates-button:focus-visible {
      border-color: #fff;
      background: rgba(255, 255, 255, .2);
      color: #fff;
    }

    .updates-backdrop {
      position: fixed;
      inset: 0;
      z-index: 3000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: rgba(15, 23, 42, .55);
    }

    .updates-dialog {
      display: flex;
      width: min(640px, 100%);
      max-height: min(720px, 100%);
      flex-direction: column;
      overflow: hidden;
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 24px 60px rgba(15, 23, 42, .3);
      font-family: 'Outfit', sans-serif;
    }

    .updates-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 18px 22px;
      background: linear-gradient(135deg, #0012b3, #003ecb);
      color: #fff;
    }

    .updates-header .bi {
      font-size: 1.5rem;
    }

    .updates-header h2 {
      margin: 0;
      font-size: 1.3rem;
      font-weight: 800;
    }

    .updates-header p {
      margin: 2px 0 0;
      opacity: .85;
      font-size: .85rem;
    }

    .updates-status {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 22px;
      border-bottom: 1px solid #e2e8f0;
      background: #f4f8fd;
      color: #334155;
      font-size: .85rem;
      font-weight: 600;
    }

    .updates-status button {
      margin-left: auto;
      padding: 5px 14px;
      border: 0;
      border-radius: 999px;
      background: #003ecb;
      color: #fff;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    .updates-body {
      overflow: auto;
      padding: 6px 22px 16px;
    }

    .updates-release {
      padding: 14px 0 6px;
      border-bottom: 1px solid #eef2f8;
    }

    .updates-release:last-child {
      border-bottom: 0;
    }

    .updates-release h3 {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin: 0 0 6px;
      color: #0012b3;
      font-size: 1rem;
      font-weight: 800;
    }

    .updates-release h3 small {
      color: #64748b;
      font-size: .78rem;
      font-weight: 600;
    }

    .updates-release h3 .updates-current {
      padding: 1px 7px;
      border-radius: 999px;
      background: #dcfce7;
      color: #166534;
      font-size: .66rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    .updates-release ul {
      margin: 0;
      padding-left: 20px;
      color: #1e293b;
      font-size: .88rem;
      line-height: 1.45;
    }

    .updates-release li {
      margin-bottom: 3px;
    }

    .updates-footer {
      display: flex;
      justify-content: flex-end;
      padding: 12px 22px;
      border-top: 1px solid #e2e8f0;
    }

    .updates-footer button {
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

  let backdrop = null;

  function close() {
    if (!backdrop) return;
    backdrop.remove();
    backdrop = null;
    document.removeEventListener('keydown', onKeydown, true);
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  async function currentVersion() {
    try {
      return window.saleskit && typeof window.saleskit.getAppVersion === 'function' ? await window.saleskit.getAppVersion() : '';
    } catch {
      return '';
    }
  }

  // A newer version on its way (downloaded in the background), with "Install now" once it is ready.
  async function updateStatusLine() {
    let status = null;
    try {
      status = window.saleskit && typeof window.saleskit.getUpdateStatus === 'function' ? await window.saleskit.getUpdateStatus() : null;
    } catch {}
    if (!status || (status.state !== 'downloading' && status.state !== 'ready')) return null;
    const line = element('div', 'updates-status');
    line.innerHTML = '<i class="bi bi-cloud-arrow-down-fill" aria-hidden="true"></i>';
    if (status.state === 'downloading') {
      line.appendChild(element('span', '', `Version ${status.version} is downloading${status.percent ? ` (${Math.round(status.percent)}%)` : ''}. It installs when the app is closed or idle.`));
    } else {
      line.appendChild(element('span', '', `Version ${status.version} is ready to install.`));
      const install = element('button', '', 'Install now');
      install.type = 'button';
      install.addEventListener('click', () => window.saleskit.installUpdate());
      line.appendChild(install);
    }
    return line;
  }

  async function open() {
    close();
    const version = await currentVersion();
    backdrop = element('div', 'updates-backdrop');
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close();
    });
    const dialog = element('div', 'updates-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'updatesTitle');

    const header = element('div', 'updates-header');
    header.innerHTML = '<i class="bi bi-stars" aria-hidden="true"></i>';
    const heading = element('div');
    const title = element('h2', '', "What's new");
    title.id = 'updatesTitle';
    heading.append(title, element('p', '', version ? `You are on version ${version}.` : 'Changes in each version of Gigahertz Sales Tools.'));
    header.appendChild(heading);

    const body = element('div', 'updates-body');
    RELEASES.forEach((release) => {
      const section = element('section', 'updates-release');
      const name = element('h3', '', `Version ${release.version}`);
      name.appendChild(element('small', '', release.date));
      if (release.version === version) name.appendChild(element('span', 'updates-current', 'Installed'));
      const list = element('ul');
      release.changes.forEach((change) => list.appendChild(element('li', '', change)));
      section.append(name, list);
      body.appendChild(section);
    });

    const footer = element('div', 'updates-footer');
    const ok = element('button', '', 'Close');
    ok.type = 'button';
    ok.addEventListener('click', close);
    footer.appendChild(ok);

    const status = await updateStatusLine();
    dialog.append(...[header, status, body, footer].filter(Boolean));
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', onKeydown, true);
    ok.focus();
    try {
      if (version) localStorage.setItem(SEEN_KEY, version);
    } catch {}
  }

  // The header: next to the Price changes button (price-notify.js), before OSD / SMT.
  function addButton() {
    const modes = document.querySelector('.header-bar .btn-group[aria-label="Recommendation mode"]');
    if (!modes) return;
    let wrap = modes.closest('.header-actions');
    if (!wrap) {
      wrap = element('div', 'header-actions');
      wrap.style.display = 'flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '10px';
      modes.replaceWith(wrap);
      wrap.appendChild(modes);
    }
    const button = element('button', 'btn btn-sm updates-button');
    button.type = 'button';
    button.id = 'btnUpdates';
    button.title = "What's new in each version";
    button.innerHTML = '<i class="bi bi-stars" aria-hidden="true"></i><span>Updates</span>';
    button.addEventListener('click', open);
    wrap.insertBefore(button, modes);
  }

  // Opens by itself once after the app updates to a version listed here.
  async function showAfterUpdate() {
    const version = await currentVersion();
    if (!version || !RELEASES.some((release) => release.version === version)) return;
    let seen = null;
    try {
      seen = localStorage.getItem(SEEN_KEY);
    } catch {
      return;
    }
    // Also shown once on a laptop that has never opened it.
    if (seen === version) return;
    setTimeout(() => {
      if (!document.querySelector('.price-notice-backdrop')) open();
    }, 2500);
  }

  function setup() {
    addButton();
    showAfterUpdate();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
