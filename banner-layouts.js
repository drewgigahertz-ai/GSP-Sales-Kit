// Banner slideshow against screen burn: Play shows the generated banner for 40 seconds, then two other layouts
// of the same laptop for 20 seconds each (Layout 2: slanted spec boxes and four feature boxes; Layout 3: a big
// price on blue with a Quick Specs list), and starts again. Pause (or the clearance banner) goes back to the main
// banner. The layouts read what the main banner shows (texts, pictures, price codes), so a laptop, branch, promo
// or colour picked while playing shows on every layout. Ctrl+Shift+L plays / pauses, also in fullscreen. The
// Layout switch (Main / 2 / 3) shows one layout by hand.
(function () {
  const $ = (id) => document.getElementById(id);
  const SEQUENCE = [
    { view: 'main', seconds: 40 },
    { view: 'specs', seconds: 20 },
    { view: 'quick', seconds: 20 }
  ];
  const SPECS = ['PROCESSOR', 'STORAGE', 'GRAPHICS', 'RESOLUTION', 'MEMORY', 'OS'];

  const style = document.createElement('style');
  style.textContent = `
    #slideshowButton {
      display: inline-flex;
      min-height: 32px;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 6px 11px;
      border: 1px solid #003ecb;
      border-radius: 6px;
      background: #fff;
      color: #003ecb;
      font: inherit;
      font-size: .72rem;
      font-weight: 700;
      white-space: nowrap;
      cursor: pointer;
      transition: background .15s ease, box-shadow .15s ease, transform .15s ease;
    }
    #slideshowButton:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 3px 8px rgba(0, 18, 179, .2); }
    #slideshowButton.is-playing { background: #003ecb; color: #fff; }
    #slideshowButton:disabled { opacity: .5; cursor: default; }
    #slideshowButton:focus-visible { outline: 3px solid rgba(0, 62, 203, .28); outline-offset: 2px; }
    #layoutSwitch { display: inline-flex; flex: 0 0 auto; align-items: center; overflow: hidden; border: 1px solid #003ecb;
      border-radius: 6px; font-size: .72rem; font-weight: 700; }
    #layoutSwitch span { padding: 0 8px; color: #475569; }
    #layoutSwitch button { min-height: 30px; padding: 4px 10px; border: 0; border-left: 1px solid #c7d2fe; background: #fff;
      color: #003ecb; font: inherit; cursor: pointer; }
    #layoutSwitch button.is-active { background: #003ecb; color: #fff; }
    #layoutSwitch button:disabled { opacity: .5; cursor: default; }
    #layoutSwitch button:focus-visible { outline: 3px solid rgba(0, 62, 203, .28); outline-offset: -3px; }

    #stage .alt-layout { position: absolute; inset: 0; z-index: 5; overflow: hidden; }
    #stage .alt-layout[hidden] { display: none; }
    .alt-layout img { display: block; }
    .alt-logo { height: 58px; width: 320px; color: #fff; font-size: 44px; font-weight: 900; letter-spacing: 1px; line-height: 58px; }
    .alt-logo img { height: 100%; width: 100%; object-fit: contain; object-position: left center; filter: brightness(0) invert(1); }
    .alt-logo .alt-logo-mask { height: 100%; width: 100%; background: #fff;
      -webkit-mask: var(--logo) left center / contain no-repeat; mask: var(--logo) left center / contain no-repeat; }
    .alt-brand { position: absolute; display: flex; align-items: center; justify-content: flex-end; width: 260px; height: 100px;
      color: #1a2cf0; font-size: 40px; font-weight: 900; }
    .alt-brand img { max-width: 100%; max-height: 100%; object-fit: contain; }
    /* The box fits its picture: same height, as wide as the picture (a wide picture up to the full width). */
    .alt-promo { position: absolute; display: flex; width: fit-content; flex-direction: column; align-items: center;
      justify-content: center; overflow: hidden; padding: 6px 10px; background: #fff; text-align: center; }
    /* A thin dark blue outline that follows the picture's own shape, so its white lettering reads on the white box. */
    .alt-promo img { width: auto; object-fit: contain;
      filter: drop-shadow(0 0 1px #0f2a8a) drop-shadow(0 0 1px #0f2a8a) drop-shadow(0 0 1.5px #0f2a8a); }
    .alt-promo-sub { color: #1d3fb8; font-size: 18px; font-weight: 800; letter-spacing: 5px; }
    .alt-promo-title { color: #1a2cf0; font-weight: 900; line-height: 1; padding: 0 20px; }

    /* Layout 2: slanted spec boxes, four feature boxes */
    .alt-specs { background: linear-gradient(115deg, #f6f9fe 0%, #e4eefb 100%); }
    .alt-specs .l2-panel { position: absolute; top: 0; left: -140px; width: 700px; height: 900px; transform: skewX(-3deg);
      transform-origin: top left; background: linear-gradient(170deg, #142f8f 0%, #1c45d2 55%, #2b5cf2 100%); }
    .alt-specs .l2-left { position: absolute; top: 46px; bottom: 44px; left: 50px; width: 450px; display: flex;
      flex-direction: column; justify-content: space-between; color: #fff; }
    .alt-specs .l2-title { margin-top: 44px; font-weight: 900; line-height: .95; text-transform: uppercase; overflow-wrap: anywhere; }
    .alt-specs .l2-part { margin-top: 6px; color: #5cb9f0; font-size: 32px; font-weight: 800; }
    .alt-specs .l2-tab { display: inline-block; padding: 5px 30px; background: #52b5e4; color: #0d2a7a; font-weight: 900;
      transform: skewX(-12deg); }
    .alt-specs .l2-tab > span { display: inline-block; transform: skewX(12deg); }
    .alt-specs .l2-cash { font-size: 106px; font-weight: 900; line-height: 1.05; }
    .alt-specs .l2-installment { display: flex; width: 400px; height: 56px; margin-top: 18px; }
    .alt-specs .l2-installment b { display: flex; align-items: center; padding: 0 14px; background: #e0262f; color: #fff; font-size: 30px; font-weight: 900; }
    .alt-specs .l2-installment span { display: flex; flex: 1; align-items: center; justify-content: center; background: #fff;
      color: #0d2a7a; font-size: 32px; font-weight: 900; }
    .alt-specs .l2-low { margin-top: 54px; width: 380px; padding: 8px 0 6px; text-align: center; }
    .alt-specs .l2-low b { display: block; font-size: 38px; line-height: 1; }
    .alt-specs .l2-low small { display: block; font-size: 14px; font-weight: 700; }
    .alt-specs .l2-monthly { width: 380px; padding: 14px 0; background: #fff; color: #1d3fb8; font-size: 44px; font-weight: 900; text-align: center; }
    .alt-specs .l2-monthly i { font-size: 20px; font-weight: 700; }
    /* Centred in the space left of the brand logo (x 602 to 1298). */
    .alt-specs .l2-promo { top: 45px; left: 950px; min-width: 320px; max-width: 696px; height: 236px; transform: translateX(-50%);
      border: 4px solid #1a2cf0; }
    .alt-specs .l2-promo img { height: 216px; max-width: 668px; }
    .alt-specs .alt-brand { top: 64px; right: 40px; }
    .alt-specs .l2-specs { position: absolute; top: 330px; left: 600px; display: grid; grid-template-columns: 440px 440px;
      column-gap: 30px; row-gap: 18px; }
    .alt-specs .l2-spec { position: relative; height: 80px; }
    .alt-specs .l2-spec::before { position: absolute; inset: 12px 0 0; border: 3px solid #1a2cf0;
      background: rgba(255, 255, 255, .9); transform: skewX(-12deg); content: ""; }
    .alt-specs .l2-spec-label { position: absolute; top: 0; left: 50%; padding: 3px 28px; background: #13308f; color: #fff;
      font-size: 16px; font-weight: 800; white-space: nowrap; transform: translateX(-50%) skewX(-12deg); }
    .alt-specs .l2-spec-label > span { display: inline-block; transform: skewX(12deg); }
    .alt-specs .l2-spec-value { position: absolute; inset: 14px 16px 0; display: flex; align-items: center; justify-content: center;
      color: #1d2f9e; font-size: 23px; font-weight: 900; text-align: center; line-height: 1.1; }
    .alt-specs .l2-features-label { position: absolute; top: 650px; left: 598px; font-size: 24px; }
    .alt-specs .l2-features { position: absolute; top: 700px; left: 600px; display: flex; gap: 20px; }
    .alt-specs .l2-feature { display: flex; width: 220px; height: 148px; flex-direction: column; align-items: center;
      justify-content: center; gap: 12px; border: 3px solid #1a2cf0; background: #fff; }
    .alt-specs .l2-feature img { max-width: 120px; height: 60px; object-fit: contain; }
    .alt-specs .l2-feature span { padding: 0 10px; color: #0a0a0a; font-size: 15px; font-weight: 800; text-align: center;
      text-transform: uppercase; line-height: 1.2; }
    .alt-specs .l2-codes { position: absolute; bottom: 16px; left: 600px; color: #475569; font-family: Arial, 'Segoe UI', sans-serif;
      font-size: 12px; word-spacing: 2px; white-space: nowrap; }

    /* Layout 3: big price on blue, Quick Specs list, feature pills */
    .alt-quick { background: #f2f5fc; }
    .alt-quick .l3-stripe,
    .alt-quick .l3-panel { position: absolute; top: 0; height: 900px; transform: skewX(-9deg); transform-origin: top left; }
    .alt-quick .l3-stripe { left: -100px; width: 1100px; background: #c9d6f7; }
    .alt-quick .l3-panel { left: -150px; width: 1100px; background: linear-gradient(160deg, #1b31d4 0%, #2242e6 50%, #3762f2 100%); }
    .alt-quick .l3-left { position: absolute; top: 50px; bottom: 26px; left: 66px; width: 740px; display: flex;
      flex-direction: column; justify-content: space-between; color: #fff; }
    .alt-quick .l3-title { margin-top: 36px; font-weight: 900; line-height: .98; text-transform: uppercase; overflow-wrap: anywhere; }
    .alt-quick .l3-part { margin-top: 20px; color: rgba(255, 255, 255, .75); font-size: 30px; font-weight: 700; letter-spacing: 4px; }
    .alt-quick .l3-label { color: rgba(255, 255, 255, .78); font-size: 24px; font-weight: 700; letter-spacing: 6px; }
    .alt-quick .l3-label small { margin-left: 8px; font-size: 16px; font-weight: 600; letter-spacing: 0; }
    .alt-quick .l3-cash { font-weight: 900; line-height: 1; }
    .alt-quick .l3-installment { display: inline-flex; margin: 14px 0 34px; overflow: hidden; border-radius: 40px;
      box-shadow: 0 10px 24px rgba(10, 20, 80, .35); font-size: 34px; font-weight: 900; }
    .alt-quick .l3-installment b { padding: 10px 28px; background: #e0262f; color: #fff; }
    .alt-quick .l3-installment span { padding: 10px 30px; background: #fff; color: #0d1b4d; }
    .alt-quick .l3-monthly { font-size: 64px; font-weight: 900; line-height: 1.05; }
    .alt-quick .l3-monthly i { font-size: 26px; font-weight: 600; }
    .alt-quick .l3-codes { margin-top: 26px; color: rgba(255, 255, 255, .75); font-family: Arial, 'Segoe UI', sans-serif;
      font-size: 12px; line-height: 1.6; word-spacing: 2px; }
    .alt-quick .alt-brand { top: 40px; right: 46px; }
    /* Centred over the Quick Specs card (520 px wide, from x 1020). */
    .alt-quick .l3-promo { top: 142px; left: 1280px; min-width: 280px; max-width: 520px; height: 168px; transform: translateX(-50%);
      border-left: 8px solid #e0262f; border-radius: 22px; box-shadow: 0 12px 30px rgba(20, 40, 120, .12); }
    .alt-quick .l3-promo img { height: 156px; max-width: 494px; }
    .alt-quick .l3-promo .alt-promo-sub { color: #334155; font-size: 15px; letter-spacing: 6px; }
    .alt-quick .l3-heading { position: absolute; left: 1020px; display: flex; align-items: center; gap: 14px; color: #1a2cf0;
      font-size: 16px; font-weight: 800; letter-spacing: 6px; }
    .alt-quick .l3-heading::before { width: 28px; height: 4px; background: #e0262f; content: ""; }
    .alt-quick .l3-specs { position: absolute; top: 370px; left: 1020px; width: 520px; padding: 4px 28px; border-radius: 18px;
      background: #fff; box-shadow: 0 12px 30px rgba(20, 40, 120, .1); }
    .alt-quick .l3-spec { display: flex; height: 52px; align-items: center; justify-content: space-between; gap: 16px;
      border-bottom: 1px solid #e5e9f2; }
    .alt-quick .l3-spec:last-child { border-bottom: 0; }
    .alt-quick .l3-spec span { color: #64748b; font-size: 12px; font-weight: 800; letter-spacing: 2px; }
    .alt-quick .l3-spec b { overflow: hidden; color: #0d1b4d; font-size: 20px; font-weight: 900; text-align: right;
      text-overflow: ellipsis; white-space: nowrap; }
    .alt-quick .l3-features { position: absolute; top: 742px; left: 1020px; display: grid; width: 520px;
      grid-template-columns: 1fr 1fr; gap: 10px; }
    /* Every check mark at the same spot, the name left-aligned beside it (a long name wraps beside the mark). */
    .alt-quick .l3-feature { display: flex; height: 50px; align-items: center; justify-content: flex-start; gap: 12px;
      padding: 0 16px 0 20px; border-radius: 12px; background: #e6ebfb; color: #0d1b4d; font-size: 14px; font-weight: 800;
      line-height: 1.2; text-transform: uppercase; text-align: left; }
    .alt-quick .l3-feature.is-wide { grid-column: span 2; }
    .alt-quick .l3-feature i { flex: none; color: #1a2cf0; font-size: 20px; line-height: 1; }
  `;
  document.head.appendChild(style);

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
  const text = (id) => {
    const value = ($(id) && $(id).textContent || '').trim();
    return value === 'N/A' ? '' : value;
  };
  const shownImage = (element) => (element && !element.hidden && element.getAttribute('src')) || '';

  // What the main banner shows now.
  function read() {
    let promoName = '';
    try {
      const item = currentItem();
      const promo = item && priceFor(item).promo;
      promoName = promo ? promoLabel(promo.name) : '';
    } catch {}
    if (/^no promo$/i.test(promoName)) promoName = '';
    const logoMask = $('gigaLogo');
    return {
      title: text('bannerTitle') || 'SELECT A PRODUCT',
      part: text('partNumber'),
      cash: text('cashPrice') || 'N/A',
      twelveMonths: text('twelveMonths') || 'N/A',
      monthly: text('monthlyPrice') || 'N/A',
      specs: SPECS.map((key) => ({ key, value: text(`spec-${key}`) || 'N/A' })),
      features: [1, 2, 3, 4].map((n) => $(`feature${n}`)).filter((f) => f && f.style.visibility !== 'hidden')
        .map((f) => ({ name: (f.querySelector('span').textContent || '').trim(), picture: shownImage(f.querySelector('img')) }))
        .filter((f) => f.name && f.name !== 'N/A'),
      brandPicture: shownImage($('brandLogo')),
      brandName: text('brandName'),
      promoPicture: shownImage(document.querySelector('#promoPictures img')),
      promoName,
      branch: (typeof selectedBranch === 'string' && selectedBranch) || '',
      codes: [...document.querySelectorAll('#priceDetails .price-detail')].map((cell) => cell.textContent.replace(/\s+/g, ' ').trim()),
      logoImage: shownImage($('gigaLogoImage')),
      logoMask: logoMask && !logoMask.hidden ? logoMask.style.getPropertyValue('--logo') : ''
    };
  }

  function logoHtml(d) {
    if (d.logoImage) return `<div class="alt-logo"><img src="${esc(d.logoImage)}" alt="GigaHertz"></div>`;
    if (d.logoMask) return `<div class="alt-logo"><div class="alt-logo-mask" style="--logo:${esc(d.logoMask)}"></div></div>`;
    return '<div class="alt-logo">GIGAHERTZ</div>';
  }
  function brandHtml(d) {
    return `<div class="alt-brand">${d.brandPicture ? `<img src="${esc(d.brandPicture)}" alt="${esc(d.brandName)}">` : esc(d.brandName)}</div>`;
  }
  // The promo picture (DB PHOTOS); without one, the promo title (and the branch, when one is picked).
  function promoHtml(d, className, titleSize) {
    let inner = '';
    if (d.promoPicture) inner = `<img src="${esc(d.promoPicture)}" alt="${esc(d.promoName)}">`;
    else if (d.promoName) {
      inner = (d.branch ? `<div class="alt-promo-sub">${esc(d.branch)}</div>` : '')
        + `<div class="alt-promo-title" style="font-size:${d.promoName.length > 18 ? Math.round(titleSize * .6) : titleSize}px">${esc(d.promoName)}</div>`;
    }
    return inner ? `<div class="alt-promo ${className}">${inner}</div>` : '';
  }
  const titleSize = (title, sizes) => (title.length <= 18 ? sizes[0] : title.length <= 28 ? sizes[1] : sizes[2]);

  function renderSpecs(d) {
    return `<div class="l2-panel"></div>
      <div class="l2-left">
        <div>${logoHtml(d)}
          <div class="l2-title" style="font-size:${titleSize(d.title, [76, 64, 52])}px">${esc(d.title)}</div>
          ${d.part ? `<div class="l2-part">${esc(d.part)}</div>` : ''}
        </div>
        <div>
          <div class="l2-tab" style="font-size:26px"><span>CASH PRICE</span></div>
          <div class="l2-cash">${esc(d.cash)}</div>
          <div class="l2-installment"><b>12 MOS.</b><span>${esc(d.twelveMonths)}</span></div>
          <div class="l2-tab l2-low"><span><b>AS LOW AS</b><small>(for 12 Months Installment)</small></span></div>
          <div class="l2-monthly">${esc(d.monthly)} <i>/month</i></div>
        </div>
      </div>
      ${promoHtml(d, 'l2-promo', 92)}
      ${brandHtml(d)}
      <div class="l2-specs">${d.specs.map((s) => `<div class="l2-spec"><div class="l2-spec-label"><span>${s.key}</span></div>
        <div class="l2-spec-value" style="${s.value.length > 26 ? 'font-size:18px' : ''}">${esc(s.value)}</div></div>`).join('')}</div>
      ${d.features.length ? `<div class="l2-tab l2-features-label"><span>KEY FEATURES</span></div>
      <div class="l2-features">${d.features.map((f) => `<div class="l2-feature">${f.picture ? `<img src="${esc(f.picture)}" alt="">` : ''}<span>${esc(f.name)}</span></div>`).join('')}</div>` : ''}
      <div class="l2-codes">${d.codes.map(esc).join('&nbsp;&nbsp; ')}</div>`;
  }

  function renderQuick(d) {
    const cashSize = d.cash.length <= 7 ? 150 : 124;
    return `<div class="l3-stripe"></div><div class="l3-panel"></div>
      <div class="l3-left">
        <div>${logoHtml(d)}
          <div class="l3-title" style="font-size:${titleSize(d.title, [86, 72, 58])}px">${esc(d.title)}</div>
          ${d.part ? `<div class="l3-part">${esc(d.part)}</div>` : ''}
        </div>
        <div>
          <div class="l3-label">CASH PRICE</div>
          <div class="l3-cash" style="font-size:${cashSize}px">${esc(d.cash)}</div>
          <div class="l3-installment"><b>12 MOS.</b><span>${esc(d.twelveMonths)}</span></div>
          <div class="l3-label">AS LOW AS<small>(for 12 Months Installment)</small></div>
          <div class="l3-monthly">${esc(d.monthly)} <i>/month</i></div>
          <div class="l3-codes">${d.codes.map(esc).join('&nbsp;&nbsp; ')}</div>
        </div>
      </div>
      ${brandHtml(d)}
      ${promoHtml(d, 'l3-promo', 64)}
      <div class="l3-heading" style="top:336px">QUICK SPECS</div>
      <div class="l3-specs">${d.specs.map((s) => `<div class="l3-spec"><span>${s.key}</span><b>${esc(s.value)}</b></div>`).join('')}</div>
      ${d.features.length ? `<div class="l3-heading" style="top:712px">KEY FEATURES</div>
      <div class="l3-features">${d.features.map((f, i, all) => `<div class="l3-feature${all.length % 2 && i === all.length - 1 ? ' is-wide' : ''}"><i class="bi bi-check-circle-fill" aria-hidden="true"></i>${esc(f.name)}</div>`).join('')}</div>` : ''}`;
  }

  // ---------- Layers and slideshow ----------
  const stage = $('stage');
  const layers = {};
  ['specs', 'quick'].forEach((view) => {
    const layer = document.createElement('div');
    layer.className = `alt-layout alt-${view}`;
    layer.hidden = true;
    layer.setAttribute('aria-hidden', 'true');
    stage.appendChild(layer);
    layers[view] = layer;
  });

  let playing = false;
  let step = 0;
  let timer = null;
  let shown = 'main';

  function render(view) {
    if (layers[view]) layers[view].innerHTML = view === 'specs' ? renderSpecs(read()) : renderQuick(read());
  }

  function show(view) {
    shown = view;
    if (view !== 'main') render(view);
    Object.entries(layers).forEach(([name, layer]) => { layer.hidden = name !== view; });
    updateSwitch();
  }

  // Layout switch: view one layout by hand (stops the slideshow on that layout).
  function updateSwitch() {
    const choices = document.querySelectorAll('#layoutSwitch button');
    choices.forEach((choice) => {
      const active = choice.dataset.layout === shown;
      choice.classList.toggle('is-active', active);
      choice.setAttribute('aria-pressed', String(active));
      choice.disabled = isClearance();
    });
  }

  function choose(view) {
    if (isClearance()) return;
    if (playing) {
      playing = false;
      clearTimeout(timer);
      timer = null;
      updateButton();
    }
    show(view);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      step = (step + 1) % SEQUENCE.length;
      show(SEQUENCE[step].view);
      schedule();
    }, SEQUENCE[step].seconds * 1000);
  }

  function updateButton() {
    const button = $('slideshowButton');
    if (!button) return;
    button.classList.toggle('is-playing', playing);
    button.setAttribute('aria-pressed', String(playing));
    button.innerHTML = playing
      ? '<i class="bi bi-pause-fill" aria-hidden="true"></i> Pause slideshow'
      : '<i class="bi bi-play-fill" aria-hidden="true"></i> Play slideshow';
    button.title = playing
      ? 'Pause and show the main banner (Ctrl+Shift+L)'
      : 'Rotate the banner: main 40 s, then two other layouts 20 s each, against screen burn (Ctrl+Shift+L)';
  }

  function isClearance() {
    return $('wrap').classList.contains('show-ageing');
  }

  function play() {
    if (isClearance()) {
      $('bannerStatus').textContent = 'The slideshow is for the generated banner.';
      return;
    }
    playing = true;
    step = 0;
    show('main');
    schedule();
    updateButton();
  }

  function pause() {
    playing = false;
    clearTimeout(timer);
    timer = null;
    show('main');
    updateButton();
  }

  function toggle() {
    if (playing) pause();
    else play();
  }

  // The layout switch and the Play button, next to Fullscreen.
  const layoutSwitch = document.createElement('div');
  layoutSwitch.id = 'layoutSwitch';
  layoutSwitch.setAttribute('role', 'group');
  layoutSwitch.setAttribute('aria-label', 'Banner layout');
  layoutSwitch.innerHTML = '<span>Layout</span>'
    + '<button type="button" data-layout="main" title="Main banner">Main</button>'
    + '<button type="button" data-layout="specs" title="Layout 2: slanted spec boxes and feature boxes">2</button>'
    + '<button type="button" data-layout="quick" title="Layout 3: big price with Quick Specs">3</button>';
  layoutSwitch.addEventListener('click', (event) => {
    const choice = event.target.closest('button[data-layout]');
    if (choice && !choice.disabled) choose(choice.dataset.layout);
  });
  $('fullscreenButton').insertAdjacentElement('beforebegin', layoutSwitch);
  const button = document.createElement('button');
  button.id = 'slideshowButton';
  button.type = 'button';
  button.addEventListener('click', toggle);
  $('fullscreenButton').insertAdjacentElement('beforebegin', button);
  updateButton();
  updateSwitch();

  // The clearance banner stops the slideshow and goes back to the main layout; a change on the main banner (another
  // laptop, branch, promo, colour, a picture that finished loading) redraws the layout on screen.
  new MutationObserver(() => {
    if (isClearance() && (playing || shown !== 'main')) pause();
    updateSwitch();
  }).observe($('wrap'), { attributes: true, attributeFilter: ['class'] });
  let redraw = null;
  new MutationObserver((records) => {
    if (shown === 'main' || records.every((r) => r.target.closest && r.target.closest('.alt-layout')
      || (r.target.parentElement && r.target.parentElement.closest('.alt-layout')))) return;
    clearTimeout(redraw);
    redraw = setTimeout(() => render(shown), 150);
  }).observe(stage, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['src', 'hidden', 'style', 'data-segment'] });

  window.BannerLayouts = { play, pause, toggle, isPlaying: () => playing, show: choose };
})();
