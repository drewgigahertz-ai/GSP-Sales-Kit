// Works out what SalesKit is showing (page, and the banner on screen if any) and reports it to the app,
// which passes it to the SalesKit Server for Devices → "Showing now". Checked every 2 seconds and right
// after a Banner-page change; only changes are reported.
(function () {
  const PAGE_NAMES = { recotable: 'Reco Table', saleskit: 'Sales Kit', banner: 'Banner' };
  let lastReport = '';
  // Set by banner-bridge.js: { item, view: 'ageing' | 'generated', fullscreen }.
  window.bannerPageScreen = null;

  function value(read) {
    try {
      return read();
    } catch {
      return undefined;
    }
  }

  function presentationScreen() {
    const overlay = document.getElementById('salesKitPresentation');
    if (!overlay || !overlay.classList.contains('is-open')) return null;
    const slides = value(() => salesKitPresentationSlides) || [];
    const slide = slides[value(() => activeSalesKitPresentationSlide) || 0];
    const fullscreen = Boolean(document.fullscreenElement);
    if (slide && slide.bannerOpen) {
      const tab = (slide.bannerTabs || []).find((item) => item.id === slide.activeBannerTabId);
      if (tab) {
        const banners = tab.banners && tab.banners.length ? tab.banners : [{ name: '' }];
        const banner = banners[Math.min(tab.bannerIndex || 0, banners.length - 1)];
        return { page: 'Presentation', kind: 'feature-banner', item: tab.model, detail: [slide.title, banner.name].filter(Boolean).join(' · '), fullscreen };
      }
    }
    return { page: 'Presentation', kind: '', item: '', detail: slide ? slide.title : '', fullscreen };
  }

  function featureBannerScreen() {
    const view = document.getElementById('salesKitFeatureBannerView');
    if (!view || !view.classList.contains('is-fullscreen')) return null;
    const tabs = value(() => salesKitFeatureBannerTabs) || [];
    const tab = tabs.find((item) => item.id === value(() => activeSalesKitFeatureBannerTabId));
    if (!tab) return null;
    const banners = tab.banners && tab.banners.length ? tab.banners : [{ name: '' }];
    const banner = banners[Math.min(tab.bannerIndex || 0, banners.length - 1)];
    return { page: 'Sales Kit', kind: 'feature-banner', item: tab.model, detail: [tab.feature, banner.name].filter(Boolean).join(' · '), fullscreen: false };
  }

  function bannerPageScreen() {
    const screen = window.bannerPageScreen;
    if (!screen || !screen.item) return { page: 'Banner', kind: '', item: '', detail: 'No laptop chosen', fullscreen: false };
    const clearance = screen.view === 'ageing';
    return {
      page: 'Banner',
      kind: clearance ? 'clearance' : 'banner',
      item: screen.item,
      detail: clearance ? 'Clearance banner' : 'Generated banner',
      fullscreen: Boolean(screen.fullscreen)
    };
  }

  function currentScreen() {
    const presentation = presentationScreen();
    if (presentation) return presentation;
    const view = value(() => currentActiveView) || 'recotable';
    if (view === 'banner') return bannerPageScreen();
    if (view === 'saleskit') {
      const featureBanner = featureBannerScreen();
      if (featureBanner) return featureBanner;
    }
    return { page: PAGE_NAMES[view] || view, kind: '', item: '', detail: '', fullscreen: false };
  }

  window.reportScreen = function () {
    if (!window.saleskit || typeof window.saleskit.reportActivity !== 'function') return;
    const screen = currentScreen();
    const key = JSON.stringify(screen);
    if (key === lastReport) return;
    lastReport = key;
    window.saleskit.reportActivity(screen).catch(() => {});
  };

  setInterval(window.reportScreen, 2000);
  document.addEventListener('fullscreenchange', () => window.reportScreen());
})();
