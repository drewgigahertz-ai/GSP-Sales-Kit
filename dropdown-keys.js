// Keyboard use of every open dropdown (Applications, Location, Recommendation, Exceed / Meet / Budget, Sales Kit
// Applications and Features, the presentation's picker):
//   ↑ / ↓ move the highlight over the visible options · Enter (or Space outside the search box) picks the
//   highlighted option, or ticks / unticks it · typing in the search box highlights the first match · Esc closes.
(function () {
  const OPTION = '.custom-dropdown-item, .app-checkbox-row, .feature-checkbox-row, .saleskit-presentation-picker label';
  const ACTIVE = 'is-key-active';

  const style = document.createElement('style');
  style.textContent = `
    .${ACTIVE} {
      outline: 2px solid #003ecb !important;
      outline-offset: -2px;
      background: #eef3ff !important;
    }
  `;
  document.head.appendChild(style);

  const visible = (element) => element && element.offsetParent !== null && !element.closest('[hidden]');

  // The dropdown that is open now, or null.
  function openMenu() {
    const picker = document.querySelector('.saleskit-presentation-picker');
    if (picker && visible(picker)) return picker;
    return [...document.querySelectorAll('.custom-dropdown-menu')].find((menu) => menu.style.display === 'block' && visible(menu)) || null;
  }

  const optionsOf = (menu) => [...menu.querySelectorAll(OPTION)].filter(visible);

  function highlight(menu, index) {
    const options = optionsOf(menu);
    menu.querySelectorAll(`.${ACTIVE}`).forEach((element) => element.classList.remove(ACTIVE));
    if (!options.length) return null;
    const option = options[Math.max(0, Math.min(options.length - 1, index))];
    option.classList.add(ACTIVE);
    option.scrollIntoView({ block: 'nearest' });
    return option;
  }

  const currentIndex = (menu) => optionsOf(menu).findIndex((option) => option.classList.contains(ACTIVE));

  // Picks an option the way a click would: a checkbox row ticks its box, anything else is clicked.
  function pick(menu, option) {
    const index = optionsOf(menu).indexOf(option);
    const box = option.querySelector('input[type="checkbox"]');
    if (box) box.click();
    else option.click();
    // Checkbox lists are rebuilt after a tick: keep the highlight where it was.
    setTimeout(() => {
      const again = openMenu();
      if (again) highlight(again, index);
    }, 30);
  }

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const menu = openMenu();
    if (!menu) return;
    const inText = event.target instanceof HTMLInputElement && event.target.type !== 'checkbox';
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const index = currentIndex(menu);
      highlight(menu, index < 0 ? 0 : index + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter' || (event.key === ' ' && !inText)) {
      const options = optionsOf(menu);
      const option = options.find((element) => element.classList.contains(ACTIVE)) || (event.key === 'Enter' ? options[0] : null);
      if (!option) return;
      event.preventDefault();
      event.stopPropagation();
      pick(menu, option);
    } else if (event.key === 'Escape' && menu.classList.contains('custom-dropdown-menu')) {
      event.preventDefault();
      event.stopPropagation();
      menu.style.display = 'none';
    }
  }, true);

  // Typing in a dropdown's search box highlights the first option that still shows.
  document.addEventListener('input', (event) => {
    const menu = openMenu();
    if (menu && menu.contains(event.target)) setTimeout(() => highlight(menu, 0), 0);
  }, true);
})();
