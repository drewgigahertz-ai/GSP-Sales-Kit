// Banner colour: the cash price box takes the laptop's segment colour on its own (Auto). The salesperson can pick
// another of the five segment colours instead; that choice is for the laptop and branch on screen, and choosing
// another laptop or branch goes back to Auto.
(function () {
  const COLORS = [
    { segment: 'productivity', label: 'Productivity (pink)' },
    { segment: 'performance', label: 'Performance (orange)' },
    { segment: 'entry', label: 'Entry (yellow)' },
    { segment: 'aaa', label: 'AAA (blue)' },
    { segment: 'casual', label: 'Casual (green)' }
  ];

  let autoSegment = '';
  let chosen = '';
  let shownFor = null;

  function labelOf(segment) {
    const color = COLORS.find((entry) => entry.segment === segment);
    return color ? color.label : 'Banner blue';
  }

  function paint() {
    const stage = document.getElementById('stage');
    const select = document.getElementById('colorSelect');
    if (stage) stage.dataset.segment = chosen || autoSegment;
    if (!select) return;
    select.options[0].textContent = `Auto: ${labelOf(autoSegment)}`;
    select.value = chosen;
    select.classList.toggle('is-manual', Boolean(chosen));
  }

  function setup() {
    const select = document.getElementById('colorSelect');
    if (!select || select.options.length) return;
    select.append(new Option('Auto', ''));
    COLORS.forEach(({ segment, label }) => select.append(new Option(label, segment)));
    select.addEventListener('change', () => {
      chosen = select.value;
      paint();
    });
  }

  // Called each time a banner is shown. key: the laptop and branch on screen; a new key starts on Auto.
  function show(segment, key) {
    setup();
    autoSegment = segment || '';
    if (key !== shownFor) chosen = '';
    shownFor = key;
    const wrap = document.getElementById('colorSelectWrap');
    if (wrap) wrap.hidden = false;
    paint();
  }

  window.BannerColor = { show };
})();
