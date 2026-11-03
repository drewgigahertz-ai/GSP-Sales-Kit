// Flyers: the Reco Table's customer at the top of the flyer (sent by flyer-bridge.js from reco-customer.js).
// While a customer name is entered: a box with "Prepared for <name>", the segment (Recommendation) as a banner,
// the three laptops on the Reco Table result (Exceed / Meet / Budget) as cards, and the chosen applications as
// logos; the branch's target markets follow below as before. Without a name, nothing is added.
// The name can also be typed here (sidebar Customer name, or on the flyer itself); it goes back to the Reco Table.
(function () {
  var style = document.createElement("style");
  style.textContent = [
    ".cust-box { margin: 0 0 10px; padding: 8px 8px 10px; border: 2px solid var(--sec); border-radius: 8px; }",
    ".cust-box .banner { margin-top: 4px; }",
    ".cust-head { display: flex; align-items: baseline; justify-content: center; gap: 10px; margin: 0 0 4px; }",
    ".cust-head .cust-label { color: var(--sec); font-family: var(--font-heading); font-size: var(--font-size-xs);",
    "  font-weight: 800; letter-spacing: .2em; text-transform: uppercase; }",
    ".cust-head .cust-name { min-width: 40px; color: var(--sec); font-family: var(--font-heading); font-size: 24px;",
    "  font-weight: 900; line-height: 1.1; overflow-wrap: anywhere; outline: none; }",
    ".cust-head .cust-name:hover, .cust-head .cust-name:focus { background: rgba(0, 0, 0, .04); border-radius: 4px; }",
    ".capturing .cust-head .cust-name:hover, .capturing .cust-head .cust-name:focus { background: none; }",
    ".cust-apps { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 10px; margin: 8px 0 0; }",
    ".cust-apps .lab { margin-right: 2px; color: var(--sec); font-family: var(--font-heading); font-size: var(--font-size-xxs);",
    "  font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }",
    ".cust-apps .app { display: flex; width: 34px; height: 34px; align-items: center; justify-content: center; }",
    ".cust-apps .app img { max-width: 100%; max-height: 100%; object-fit: contain; }",
    ".cust-apps .app.no-logo { width: auto; padding: 2px 9px; border: 1px solid var(--sec1); border-radius: 999px;",
    "  color: var(--text-default-color, #111); font-family: var(--font-body); font-size: var(--font-size-xxs); font-weight: 700; }"
  ].join("\n");
  document.head.appendChild(style);

  var customer = null;
  var TIERS = ["exceed", "meet", "budget"];
  var hooks = { redraw: function () {}, changed: function () {}, sendName: function () {} };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // flyer.html's redraw (whole flyer), changed (checklist) and sendName (back to the Reco Table).
  function init(next) { hooks = next; }

  // The Reco Table's customer, or null; laptops: the three cards' data, added to the flyer's laptops.
  function set(next, laptops, allLaptops) {
    customer = next || null;
    Object.keys(laptops || {}).forEach(function (k) { allLaptops[k] = laptops[k]; });
    var input = document.getElementById("customerInput");
    if (input && document.activeElement !== input) input.value = name();
  }

  function name() {
    return (customer && String(customer.name || "").trim()) || "";
  }

  // The customer section as a flyer section ({ title, slots, market: "cust" }), or null when there is no name.
  function section() {
    if (!name()) return null;
    return {
      title: customer.segment || "Recommended",
      slots: TIERS.map(function (tier) { return (customer.laptops && customer.laptops[tier]) || ""; }),
      market: "cust"
    };
  }

  // Applications: { name, icon } (older SalesKit: just the name).
  function appHtml(app) {
    var title = typeof app === "string" ? app : app.name;
    var icon = typeof app === "string" ? "" : app.icon;
    return icon
      ? '<span class="app" title="' + esc(title) + '"><img data-src="' + esc(icon) + '" alt="' + esc(title) + '"></span>'
      : '<span class="app no-logo">' + esc(title) + "</span>";
  }

  // HTML for the top of the flyer; cardHtml and colourIndex come from flyer.html.
  function html(cardHtml, colourIndex) {
    var s = section();
    if (!s) return "";
    var cls = " s" + colourIndex(s.title);
    var apps = (customer.apps || []).filter(Boolean);
    return '<div class="cust-box' + cls + '" id="market-cust">' +
      '<div class="cust-head"><span class="cust-label">Prepared for</span>' +
      '<span class="cust-name" contenteditable="true" spellcheck="false" title="Click to change the name">' + esc(name()) + "</span></div>" +
      '<div class="banner"><span>' + esc(s.title) + "</span></div>" +
      '<div class="row">' + s.slots.map(cardHtml).join("") + "</div>" +
      (apps.length ? '<div class="cust-apps"><span class="lab">Applications</span>' + apps.map(appHtml).join("") + "</div>" : "") +
      "</div>";
  }

  // A name typed here: the flyer follows (the whole section appears or goes when it starts or ends), and the
  // Reco Table gets it back.
  function typed(value, from) {
    var had = Boolean(name());
    customer = Object.assign({}, customer || { laptops: {}, apps: [] }, { name: value });
    var input = document.getElementById("customerInput");
    if (from !== input && input) input.value = value;
    var shown = document.querySelector(".cust-head .cust-name");
    if (from !== shown && shown) shown.textContent = value;
    if (had !== Boolean(name())) hooks.redraw();
    else hooks.changed();
    hooks.sendName(value);
  }

  document.addEventListener("input", function (e) {
    if (e.target && e.target.id === "customerInput") typed(e.target.value, e.target);
    else if (e.target && e.target.classList && e.target.classList.contains("cust-name")) typed(e.target.textContent.trim(), e.target);
  });
  // Enter ends editing on the flyer (one line).
  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target && e.target.classList && e.target.classList.contains("cust-name")) {
      e.preventDefault();
      e.target.blur();
    }
  });

  window.FlyerCustomer = { init: init, set: set, name: name, section: section, html: html };
})();
