// Presentation view, Features tab: the feature name opens a dropdown of every slide (the Applications tab has
// its own multi-select, see presentation-apps-picker.js); picking one jumps straight to it. The arrows and the slideshow keep working, and the
// dropdown follows the slide on screen. The Reco Table tab keeps the plain title.
// The title itself stays as it is (with an arrow after it); an invisible dropdown lies over it.
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

    .saleskit-presentation-jump {
      position: absolute;
      z-index: 1;
      margin: 0;
      padding: 0;
      border: 0;
      opacity: 0;
      cursor: pointer;
      font-size: 1rem;
    }

    .saleskit-presentation-jump[hidden] {
      display: none;
    }
  `;
  document.head.appendChild(style);

  function setup() {
    const title = document.getElementById('salesKitPresentationTitle');
    const counter = document.getElementById('salesKitPresentationCounter');
    if (!title || !counter || !title.parentElement) return;

    const select = document.createElement('select');
    select.id = 'salesKitPresentationJump';
    select.className = 'saleskit-presentation-jump';
    select.hidden = true;
    title.parentElement.style.position = 'relative';
    title.insertAdjacentElement('afterend', select);

    // The dropdown covers the title exactly.
    function cover() {
      if (select.hidden) return;
      select.style.left = `${title.offsetLeft}px`;
      select.style.top = `${title.offsetTop}px`;
      select.style.width = `${title.offsetWidth}px`;
      select.style.height = `${title.offsetHeight}px`;
    }

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
      // Applications have their own multi-select instead (presentation-apps-picker.js).
      const useDropdown = mode === 'features' && slides.length > 1;
      select.hidden = !useDropdown;
      if (mode !== 'apps') title.classList.toggle('has-jump', useDropdown);
      if (!useDropdown) return;
      select.setAttribute('aria-label', mode === 'features' ? 'Feature shown' : 'Application shown');
      if (shownSlides !== slides) {
        shownSlides = slides;
        select.replaceChildren(...slides.map((slide, index) => new Option(slide.title, String(index))));
      }
      select.value = String(active);
      cover();
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
    select.addEventListener('mouseenter', () => title.classList.add('is-hover'));
    select.addEventListener('mouseleave', () => title.classList.remove('is-hover'));
    select.addEventListener('focus', () => title.classList.add('is-focus'));
    select.addEventListener('blur', () => title.classList.remove('is-focus'));

    new MutationObserver(update).observe(counter, { childList: true, characterData: true, subtree: true });
    window.addEventListener('resize', cover);
    // The title font loads after the first slide; keep the cover in step with its size.
    if (window.ResizeObserver) new ResizeObserver(cover).observe(title);
    update();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
