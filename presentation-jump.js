// Presentation view, Applications and Features tabs: a dropdown under the application / feature name lists
// every slide; picking one jumps straight to it. The arrows and the slideshow keep working, and the
// dropdown follows the slide on screen.
(function () {
  const style = document.createElement('style');
  style.textContent = `
    .saleskit-presentation-jump {
      display: block;
      max-width: min(460px, 100%);
      margin-top: 8px;
      padding: 6px 34px 6px 12px;
      border: 1.5px solid #cbd8eb;
      border-radius: 999px;
      background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 16 16'%3E%3Cpath fill='%230012b3' d='M1.6 4.6a.75.75 0 0 1 1.06 0L8 9.94l5.34-5.34a.75.75 0 1 1 1.06 1.06l-5.87 5.87a.75.75 0 0 1-1.06 0L1.6 5.66a.75.75 0 0 1 0-1.06z'/%3E%3C/svg%3E") no-repeat right 13px center;
      color: #0012b3;
      font-family: 'Outfit', sans-serif;
      font-size: clamp(.85rem, 1.1vw, 1rem);
      font-weight: 700;
      cursor: pointer;
      appearance: none;
    }

    .saleskit-presentation-jump:focus {
      border-color: #003ecb;
      outline: 0;
      box-shadow: 0 0 0 3px rgba(0, 62, 203, .15);
    }

    .saleskit-presentation-jump[hidden] {
      display: none;
    }
  `;
  document.head.appendChild(style);

  function setup() {
    const title = document.getElementById('salesKitPresentationTitle');
    const counter = document.getElementById('salesKitPresentationCounter');
    if (!title || !counter) return;

    const select = document.createElement('select');
    select.id = 'salesKitPresentationJump';
    select.className = 'saleskit-presentation-jump';
    select.hidden = true;
    title.insertAdjacentElement('afterend', select);

    let shownSlides = null;

    // Called whenever a slide is shown (the counter changes with every slide).
    function update() {
      let slides = [];
      let active = 0;
      let mode = 'reco';
      try {
        slides = salesKitPresentationSlides;
        active = activeSalesKitPresentationSlide;
        mode = salesKitPresentationMode;
      } catch {
        return;
      }
      select.hidden = mode === 'reco' || slides.length < 2;
      if (select.hidden) return;
      select.setAttribute('aria-label', mode === 'features' ? 'Go to feature' : 'Go to application');
      if (shownSlides !== slides) {
        shownSlides = slides;
        select.replaceChildren(...slides.map((slide, index) => new Option(`${index + 1}. ${slide.title}`, String(index))));
      }
      select.value = String(active);
    }

    select.addEventListener('change', () => {
      const index = Number(select.value);
      try {
        if (!salesKitPresentationSlides[index] || index === activeSalesKitPresentationSlide) return;
        const current = salesKitPresentationSlides[activeSalesKitPresentationSlide];
        if (current) current.bannerOpen = false;
        activeSalesKitPresentationSlide = index;
        renderSalesKitPresentationSlide();
      } catch {}
      // Arrow keys move slides again, not the dropdown.
      select.blur();
    });

    new MutationObserver(update).observe(counter, { childList: true, characterData: true, subtree: true });
    update();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
