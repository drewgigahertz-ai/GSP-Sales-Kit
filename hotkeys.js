// Keyboard shortcuts, as proposed by the sales team (GST hotkeys):
//   Ctrl+1 Reco Table · Ctrl+2 Sales Kit · Ctrl+3 Banner
//   Ctrl+Shift+A Application selection · Ctrl+Shift+R Recommendation selection · Ctrl+Shift+P Present
//   Ctrl+D or Ctrl+Shift+D Download (Result on the Reco Table, Image on Sales Kit)
//   Reco Table only: Ctrl+Shift+L Location selection · Ctrl+Shift+C Copy Details · Ctrl+R Refresh Data
//   Sales Kit only: Alt+1 Applications tab · Alt+2 Features tab · Ctrl+Shift+S that tab's selector
// In the presentation, Ctrl+1 / Ctrl+2 / Ctrl+3 switch to its Reco Table / Applications / Features tab instead;
// the other shortcuts are paused there (it has its own keys).
(function () {
  function page() {
    try {
      return currentActiveView;
    } catch {
      return 'recotable';
    }
  }

  function click(id) {
    const button = document.getElementById(id);
    if (button && !button.disabled) button.click();
  }

  // Opens a Customer Profiling dropdown (or keeps it open) and puts the cursor in its search box.
  function openMenu(menuId, toggleName, searchId) {
    const menu = document.getElementById(menuId);
    const isOpen = menu && menu.style.display === 'block';
    if (!isOpen && typeof window[toggleName] === 'function') window[toggleName]();
    const search = searchId && document.getElementById(searchId);
    if (search) setTimeout(() => search.focus(), 60);
  }

  function openLocation() {
    let locked = null;
    try {
      locked = lockedBranch;
    } catch {}
    if (locked) {
      if (typeof showAppNotification === 'function') {
        showAppNotification(`Location is locked to your branch (${locked}).`, 'info', 2500);
      }
      return;
    }
    openMenu('locationDropdownMenu', 'toggleLocationMenu', 'locationSearchInput');
  }

  // Sales Kit: the Applications or Features selector, whichever tab is showing.
  function openSalesKitSelector() {
    let tab = 'apps';
    try {
      tab = currentSalesKitSubTab;
    } catch {}
    if (tab === 'features') openMenu('salesKitFeaturesDropdownMenu', 'toggleSalesKitFeaturesMenu', 'salesKitFeaturesSearchInput');
    else openMenu('salesKitAppsDropdownMenu', 'toggleSalesKitAppsMenu', 'salesKitAppsSearchInput');
  }

  // Download Result (Reco Table) or Download Image (Sales Kit).
  function download() {
    click(page() === 'saleskit' ? 'btnDownloadSalesKit' : 'btnDownloadReco');
  }

  const RECO = ['recotable'];
  const BOTH = ['recotable', 'saleskit'];
  const SALESKIT = ['saleskit'];

  // key: event.code; pages: where the shortcut works; alt: Alt held as well (default: not held).
  const SHORTCUTS = [
    { ctrl: true, shift: false, code: 'Digit1', pages: null, label: 'Reco Table', run: () => navigateTo('recotable') },
    { ctrl: true, shift: false, code: 'Digit2', pages: null, label: 'Sales Kit', run: () => navigateTo('saleskit') },
    { ctrl: true, shift: false, code: 'Digit3', pages: null, label: 'Banner', run: () => navigateTo('banner') },
    { ctrl: true, shift: true, code: 'KeyA', pages: BOTH, label: 'Application selection', run: () => openMenu('appsDropdownMenu', 'toggleAppsMenu', 'appsSearchInput') },
    { ctrl: true, shift: true, code: 'KeyL', pages: RECO, label: 'Location selection', run: openLocation },
    { ctrl: true, shift: true, code: 'KeyR', pages: BOTH, label: 'Recommendation selection', run: () => openMenu('recoForDropdownMenu', 'toggleRecoForMenu') },
    { ctrl: true, shift: true, code: 'KeyC', pages: RECO, label: 'Copy Details', run: () => click('btnCopyReco') },
    { ctrl: true, shift: true, code: 'KeyP', pages: BOTH, label: 'Present', run: () => click(page() === 'saleskit' ? 'btnPresentSalesKit' : 'btnPresentReco') },
    { ctrl: true, shift: false, code: 'KeyD', pages: BOTH, label: 'Download', run: download },
    { ctrl: true, shift: true, code: 'KeyD', pages: BOTH, label: 'Download', run: download },
    { ctrl: true, shift: false, code: 'KeyR', pages: RECO, label: 'Refresh Data', run: () => click('btnRefreshData') },
    { ctrl: false, alt: true, shift: false, code: 'Digit1', pages: SALESKIT, label: 'Applications tab', run: () => switchSalesKitSubTab('apps') },
    { ctrl: false, alt: true, shift: false, code: 'Digit2', pages: SALESKIT, label: 'Features tab', run: () => switchSalesKitSubTab('features') },
    { ctrl: true, shift: true, code: 'KeyS', pages: SALESKIT, label: 'Applications / Features selection', run: openSalesKitSelector }
  ];

  function presentationOpen() {
    const overlay = document.getElementById('salesKitPresentation');
    return Boolean(overlay && overlay.classList.contains('is-open'));
  }

  // Runs the shortcut for this key press; true when one matched.
  window.runSalesKitHotkey = function ({ ctrl, shift, alt, code }) {
    if (!ctrl && !alt) return false;
    if (presentationOpen()) {
      if (!ctrl || alt) return false;
      const tab = { Digit1: 'reco', Digit2: 'apps', Digit3: 'features' }[code];
      if (!tab || shift || typeof switchSalesKitPresentationMode !== 'function') return false;
      switchSalesKitPresentationMode(tab);
      return true;
    }
    const shortcut = SHORTCUTS.find((item) => item.code === code && item.shift === Boolean(shift)
      && item.ctrl === Boolean(ctrl) && Boolean(item.alt) === Boolean(alt)
      && (!item.pages || item.pages.includes(page())));
    if (!shortcut) return false;
    shortcut.run();
    return true;
  };

  document.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const handled = window.runSalesKitHotkey({
      ctrl: event.ctrlKey || event.metaKey,
      shift: event.shiftKey,
      alt: event.altKey,
      code: event.code
    });
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  // Show the shortcut in each button's tooltip.
  const TIPS = {
    btnCopyReco: 'Ctrl+Shift+C', btnPresentReco: 'Ctrl+Shift+P', btnDownloadReco: 'Ctrl+D', btnRefreshData: 'Ctrl+R',
    btnPresentSalesKit: 'Ctrl+Shift+P', btnDownloadSalesKit: 'Ctrl+Shift+D',
    tabRecoTable: 'Ctrl+1', tabSalesKit: 'Ctrl+2', tabBanner: 'Ctrl+3',
    appsDisplayInput: 'Ctrl+Shift+A', locationDisplayInput: 'Ctrl+Shift+L', recoForDisplayInput: 'Ctrl+Shift+R',
    btnSalesKitSubTabApps: 'Alt+1', btnSalesKitSubTabFeatures: 'Alt+2',
    salesKitAppsBtn: 'Ctrl+Shift+S', salesKitFeaturesBtn: 'Ctrl+Shift+S'
  };
  Object.entries(TIPS).forEach(([id, keys]) => {
    const element = document.getElementById(id);
    if (element && !element.title) element.title = keys;
    else if (element && !element.title.includes(keys)) element.title = `${element.title} (${keys})`;
  });
})();
