// Flyers: when a laptop has more than one promo row in NEW PRICING for the branch, its SRP gets a small chevron
// (like the Reco Table's price): clicking it lists every promo title with its SRP (12MOS) and cash price, and
// picking one shows that promo's SRP and cash discount on every card of that laptop. The pick is remembered per
// branch and laptop on this laptop, and forgotten when that promo row is gone after a refresh. The chevron and
// the list never show in Print or Download.
(function () {
  var style = document.createElement("style");
  style.textContent = [
    ".promo-pick { margin-left: auto; margin-right: 4px; padding: 0 3px; border: 0; background: none; color: var(--text-muted, #94a3b8);",
    "  font-size: 10px; line-height: 1; cursor: pointer; opacity: .55; transition: opacity .15s, transform .15s; align-self: center; }",
    ".promo-pick:hover, .promo-pick:focus-visible { opacity: 1; }",
    ".promo-pick.unpicked { color: #d97706; opacity: 1; }",
    ".promo-pick.is-open { transform: rotate(180deg); opacity: 1; }",
    ".promo-menu { position: fixed; z-index: 2000; min-width: 260px; max-width: 340px; max-height: 280px; overflow-y: auto; margin: 0;",
    "  padding: 4px 0; list-style: none; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;",
    "  box-shadow: 0 10px 24px rgba(15, 23, 42, .14); font: 500 12px var(--font-body, 'Segoe UI', sans-serif); color: #334155; }",
    ".promo-menu[hidden] { display: none; }",
    ".promo-menu .pm-head { padding: 4px 10px 6px; color: #94a3b8; font-size: 11px; font-weight: 700; border-bottom: 1px solid #eef2f7; }",
    ".promo-menu button { display: flex; width: 100%; justify-content: space-between; gap: 10px; padding: 5px 10px; border: 0;",
    "  border-bottom: 1px dashed #e2e8f0; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }",
    ".promo-menu li:last-child button { border-bottom: 0; }",
    ".promo-menu button:hover, .promo-menu button:focus-visible { background: #f1f5ff; outline: none; }",
    ".promo-menu button.is-shown { color: #0012b3; font-weight: 700; }",
    ".promo-menu small { display: block; color: #94a3b8; font-weight: 500; }",
    ".promo-menu .pm-price { flex: none; text-align: right; white-space: nowrap; font-weight: 700; }",
    ".promo-menu .pm-price small { font-weight: 600; }",
    "@media print { .promo-pick, .promo-menu { display: none !important; } }"
  ].join("\n");
  document.head.appendChild(style);

  var ctx = null;   // { laptop(desc), branch(), key(v), esc(s), money(v), onPick(desc) } from flyer.html
  var menu = null, openBtn = null;

  function storeKey(desc) { return "saleskit-flyer-promo-" + ctx.key(ctx.branch()) + "-" + ctx.key(desc); }
  function same(a, b) { return a.title === b.title && a.cash === b.cash && a.twelveMonths === b.twelveMonths; }

  // The laptop's promo rows with a 12MOS price that apply at the branch (rows for every branch, or naming it).
  function rows(desc) {
    var p = ctx.laptop(desc);
    var branch = ctx.key(ctx.branch());
    return ((p && p.promoRows) || []).filter(function (r) {
      return r.twelveMonths != null && (!r.branch || r.branch.split(",").map(ctx.key).indexOf(branch) !== -1);
    });
  }
  function several(desc) { return rows(desc).length > 1; }

  // The promo picked for this laptop at this branch, or null (none picked, or that row is gone).
  function chosen(desc) {
    if (!ctx || !desc || !ctx.branch()) return null;
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(storeKey(desc)) || "null"); } catch (e) {}
    if (!saved) return null;
    var list = rows(desc);
    var row = list.length > 1 ? list.find(function (r) { return same(r, saved); }) : null;
    if (!row) { try { localStorage.removeItem(storeKey(desc)); } catch (e) {} }
    return row || null;
  }

  // After the cards are drawn: a chevron in the SRP of every card whose laptop has several promos.
  function mark(root) {
    closeMenu();
    if (!ctx) return;
    Array.prototype.forEach.call(root.querySelectorAll(".card[data-model]"), function (card) {
      var desc = card.getAttribute("data-model");
      var srp = card.querySelector(".srp");
      if (!srp || !several(desc)) return;
      var picked = !!chosen(desc);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "promo-pick no-print" + (picked ? "" : " unpicked");
      btn.setAttribute("data-html2canvas-ignore", "");
      btn.setAttribute("aria-haspopup", "listbox");
      btn.title = rows(desc).length + " promos" + (picked ? "" : " · none picked yet");
      btn.setAttribute("aria-label", "Choose the promo price");
      btn.innerHTML = '<i class="bi bi-chevron-down" aria-hidden="true"></i>';
      btn.addEventListener("click", function (e) { e.stopPropagation(); openBtn === btn ? closeMenu() : openMenu(btn, desc); });
      srp.insertBefore(btn, srp.querySelector(".val"));
    });
  }

  function openMenu(btn, desc) {
    closeMenu();
    if (!menu) {
      menu = document.createElement("ul");
      menu.className = "promo-menu no-print";
      menu.setAttribute("role", "listbox");
      menu.setAttribute("data-html2canvas-ignore", "");
      document.body.appendChild(menu);
      menu.addEventListener("click", function (e) { e.stopPropagation(); });
      menu.addEventListener("keydown", function (e) {
        var items = Array.prototype.slice.call(menu.querySelectorAll("button"));
        var i = items.indexOf(document.activeElement);
        if (e.key === "ArrowDown") { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
        else if (e.key === "Escape") { e.preventDefault(); closeMenu(true); }
        else if (e.key === "Tab") { closeMenu(false); }
      });
    }
    var list = rows(desc);
    // The row the card shows: the picked one, else the first with the app's own price.
    var p = ctx.laptop(desc);
    var auto = (p.branchPrices && p.branchPrices[ctx.key(ctx.branch())]) || p.prices || {};
    var shown = chosen(desc) || list.find(function (r) { return r.cash === auto.cash && r.twelveMonths === auto.twelveMonths; });
    menu.innerHTML = '<li class="pm-head">' + list.length + " promos · pick the price for this flyer</li>" +
      list.map(function (r, i) {
        return '<li><button type="button" role="option" data-i="' + i + '"' + (r === shown ? ' class="is-shown" aria-selected="true"' : "") + ">" +
          "<span>" + ctx.esc(r.title) + (r.dates ? "<small>" + ctx.esc(r.dates) + "</small>" : "") + "</span>" +
          '<span class="pm-price">' + ctx.money(r.twelveMonths) + "<small>Cash " + (r.cash == null ? "—" : ctx.money(r.cash)) + "</small></span>" +
          "</button></li>";
      }).join("");
    Array.prototype.forEach.call(menu.querySelectorAll("button"), function (b) {
      b.addEventListener("click", function () { pick(desc, list[+b.getAttribute("data-i")]); });
    });
    menu.hidden = false;
    var r = btn.getBoundingClientRect();
    var left = Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8));
    var top = r.bottom + 4;
    if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 4);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
    openBtn = btn;
    btn.classList.add("is-open");
    btn.setAttribute("aria-expanded", "true");
    (menu.querySelector(".is-shown") || menu.querySelector("button")).focus();
  }

  function closeMenu(refocus) {
    if (menu) menu.hidden = true;
    if (openBtn) {
      openBtn.classList.remove("is-open");
      openBtn.setAttribute("aria-expanded", "false");
      if (refocus && document.body.contains(openBtn)) openBtn.focus();
    }
    openBtn = null;
  }

  function pick(desc, row) {
    if (!row) return;
    try { localStorage.setItem(storeKey(desc), JSON.stringify({ title: row.title, cash: row.cash, twelveMonths: row.twelveMonths })); } catch (e) {}
    closeMenu();
    ctx.onPick(desc);
  }

  document.addEventListener("click", function () { closeMenu(false); });
  window.addEventListener("resize", function () { closeMenu(false); });
  document.addEventListener("scroll", function (e) { if (e.target !== menu) closeMenu(false); }, true);

  window.FlyerPromos = {
    init: function (context) { ctx = context; },
    mark: mark,
    chosen: chosen,
    several: several
  };
})();
