// Flyers: the Reco Table's customer at the top of the flyer (sent by flyer-bridge.js from reco-customer.js).
// While a customer name is entered on the Reco Table: "Prepared for <name>", the segment (Recommendation) as a
// banner, the three laptops on the Reco Table result (Exceed / Meet / Budget) as cards, and the chosen
// applications as tags; the branch's target markets follow below as before. Without a name, nothing is added.
(function () {
  var style = document.createElement("style");
  style.textContent = [
    ".cust-head { display: flex; align-items: baseline; justify-content: center; gap: 10px; margin: 0 0 4px; }",
    ".cust-head .cust-label { color: var(--sec); font-family: var(--font-heading); font-size: var(--font-size-xs);",
    "  font-weight: 800; letter-spacing: .2em; text-transform: uppercase; }",
    ".cust-head .cust-name { color: var(--sec); font-family: var(--font-heading); font-size: 24px; font-weight: 900;",
    "  line-height: 1.1; overflow-wrap: anywhere; }",
    ".cust-apps { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 4px; margin: 5px 0 0; }",
    ".cust-apps .lab { margin-right: 4px; color: var(--sec); font-family: var(--font-heading); font-size: var(--font-size-xxs);",
    "  font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }",
    ".cust-apps .app { padding: 2px 9px; border: 1px solid var(--sec1); border-radius: 999px; background: #fff;",
    "  color: var(--text-default-color, #111); font-family: var(--font-body); font-size: var(--font-size-xxs); font-weight: 700; }",
    ".cust-sep { margin: 10px 0 6px; border-top: 2px dashed #cbd5e1; }"
  ].join("\n");
  document.head.appendChild(style);

  var customer = null;
  var TIERS = ["exceed", "meet", "budget"];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // The Reco Table's customer, or null; laptops: the three cards' data, added to the flyer's laptops.
  function set(next, laptops, allLaptops) {
    customer = next || null;
    Object.keys(laptops || {}).forEach(function (k) { allLaptops[k] = laptops[k]; });
  }

  function name() {
    return customer && String(customer.name || "").trim();
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

  // HTML for the top of the flyer; cardHtml and colourIndex come from flyer.html.
  function html(cardHtml, colourIndex) {
    var s = section();
    if (!s) return "";
    var cls = " s" + colourIndex(s.title);
    var apps = (customer.apps || []).filter(Boolean);
    return '<div class="cust-head' + cls + '" id="market-cust"><span class="cust-label">Prepared for</span>' +
      '<span class="cust-name">' + esc(name()) + "</span></div>" +
      '<div class="banner' + cls + '"><span>' + esc(s.title) + "</span></div>" +
      '<div class="row' + cls + '">' + s.slots.map(cardHtml).join("") + "</div>" +
      (apps.length ? '<div class="cust-apps' + cls + '"><span class="lab">Applications</span>' +
        apps.map(function (app) { return '<span class="app">' + esc(app) + "</span>"; }).join("") + "</div>" : "") +
      '<div class="cust-sep"></div>';
  }

  window.FlyerCustomer = { set: set, name: name, section: section, html: html };
})();
