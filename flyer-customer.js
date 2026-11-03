// Flyers: the Reco Table's customer at the top of the flyer (sent by flyer-bridge.js from reco-customer.js).
// While a customer name is entered: a box with "Prepared for <name>", the segment (Recommendation) as a banner,
// the three laptops on the Reco Table result (Exceed / Meet / Budget) as cards, and the chosen applications as
// logos; the branch's target markets follow below as before. Without a name, nothing is added.
// The name can also be typed here (sidebar Customer name, or on the flyer itself); it goes back to the Reco Table.
// The applications can be chosen here too (sidebar picker); that only changes the flyer, never the segment.
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
    "  color: var(--text-default-color, #111); font-family: var(--font-body); font-size: var(--font-size-xxs); font-weight: 700; }",
    /* Sidebar: Applications picker for the flyer */
    "#customerApps { position: relative; }",
    "#customerApps[hidden] { display: none; }",
    ".capps-btn { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 8px; text-align: left; cursor: pointer; }",
    ".capps-btn span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".capps-btn b { flex: none; padding: 0 7px; border-radius: 999px; background: #e0e7ff; color: #1e3a8a; font-size: 11px; }",
    ".capps-panel { position: absolute; z-index: 30; left: 0; right: 0; top: calc(100% + 4px); padding: 6px;",
    "  border: 1px solid #cbd5e1; border-radius: 10px; background: #fff; box-shadow: 0 12px 28px rgba(15, 23, 42, .16); }",
    ".capps-panel[hidden] { display: none; }",
    ".capps-panel input[type=search] { width: 100%; margin-bottom: 6px; padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 6px; font: inherit; font-size: 12px; }",
    ".capps-list { max-height: 260px; overflow-y: auto; }",
    ".capps-list label { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 6px; font-size: 12px; cursor: pointer; }",
    ".capps-list label:hover { background: #f1f5ff; }",
    ".capps-list img { width: 18px; height: 18px; object-fit: contain; }",
    ".capps-foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 6px; padding: 6px 4px 0;",
    "  border-top: 1px solid #e2e8f0; color: #64748b; font-size: 11px; }",
    ".capps-foot button { padding: 0; border: 0; background: none; color: #1d4ed8; font: inherit; font-weight: 700; cursor: pointer; }",
    ".capps-foot button[hidden] { display: none; }"
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

  // Applications chosen on the Flyers tab (names), or null = the Reco Table's. They only change the flyer: the
  // Reco Table and its segment stay as they are. New applications chosen on the Reco Table replace them.
  var chosenApps = null;
  var recoAppsKey = "";

  function appName(app) { return typeof app === "string" ? app : app.name; }

  function shownApps() {
    if (!customer) return [];
    if (!chosenApps) return (customer.apps || []).filter(Boolean);
    var all = customer.allApps || customer.apps || [];
    return chosenApps.map(function (n) {
      return all.find(function (app) { return appName(app) === n; }) || n;
    });
  }

  // The Reco Table's customer, or null; laptops: the three cards' data, added to the flyer's laptops.
  function set(next, laptops, allLaptops) {
    customer = next || null;
    Object.keys(laptops || {}).forEach(function (k) { allLaptops[k] = laptops[k]; });
    var key = ((customer && customer.apps) || []).map(appName).join("|");
    if (key !== recoAppsKey) {
      recoAppsKey = key;
      chosenApps = null;
    }
    var input = document.getElementById("customerInput");
    if (input && document.activeElement !== input) input.value = name();
    drawPicker();
  }

  // ---------- Sidebar: Applications picker ----------
  var pickerOpen = false;
  var pickerQuery = "";

  function drawPicker() {
    var box = document.getElementById("customerApps");
    if (!box) return;
    box.hidden = !name();
    if (box.hidden) { pickerOpen = false; box.innerHTML = ""; return; }
    var shown = shownApps().map(appName);
    var all = (customer.allApps && customer.allApps.length ? customer.allApps : customer.apps || []);
    var q = pickerQuery.trim().toLowerCase();
    var listed = all.filter(function (app) { return !q || appName(app).toLowerCase().indexOf(q) !== -1; });
    box.innerHTML = '<label class="field-label">Applications on the flyer</label>' +
      '<button type="button" class="side-input capps-btn" aria-haspopup="listbox" aria-expanded="' + pickerOpen + '"' +
      ' title="Choose the applications shown on the flyer (the segment does not change)">' +
      "<span>" + (shown.length ? esc(shown.join(", ")) : "None") + "</span><b>" + shown.length + "</b></button>" +
      '<div class="capps-panel"' + (pickerOpen ? "" : " hidden") + ">" +
      '<input type="search" placeholder="Search applications" value="' + esc(pickerQuery) + '" spellcheck="false">' +
      '<div class="capps-list" role="listbox">' + listed.map(function (app) {
        var n = appName(app), icon = typeof app === "string" ? "" : app.icon;
        return '<label><input type="checkbox" data-app="' + esc(n) + '"' + (shown.indexOf(n) !== -1 ? " checked" : "") + ">" +
          (icon ? '<img data-src="' + esc(icon) + '" alt="">' : "") + "<span>" + esc(n) + "</span></label>";
      }).join("") + (listed.length ? "" : '<div class="capps-foot">No application matches.</div>') + "</div>" +
      '<div class="capps-foot"><span>Only changes the flyer, not the segment.</span>' +
      '<button type="button" data-reco' + (chosenApps ? "" : " hidden") + ">Use the Reco Table's</button></div>" +
      "</div>";
    if (typeof fillPictures === "function") fillPictures(box);
  }

  document.addEventListener("click", function (e) {
    var box = document.getElementById("customerApps");
    if (!box || box.hidden) return;
    if (e.target.closest(".capps-btn")) {
      pickerOpen = !pickerOpen;
      drawPicker();
      if (pickerOpen) box.querySelector("input[type=search]").focus();
    } else if (e.target.closest("[data-reco]")) {
      chosenApps = null;
      drawPicker();
      hooks.redraw();
    } else if (pickerOpen && !box.contains(e.target)) {
      pickerOpen = false;
      drawPicker();
    }
  });

  document.addEventListener("change", function (e) {
    var app = e.target && e.target.getAttribute && e.target.getAttribute("data-app");
    if (app === null || app === undefined) return;
    var names = shownApps().map(appName).filter(function (n) { return n !== app; });
    if (e.target.checked) names.push(app);
    chosenApps = names;
    drawPicker();
    hooks.redraw();
  });

  document.addEventListener("input", function (e) {
    if (!e.target || !e.target.closest || !e.target.closest(".capps-panel") || e.target.type !== "search") return;
    pickerQuery = e.target.value;
    var at = e.target.selectionStart;
    drawPicker();
    var search = document.querySelector("#customerApps input[type=search]");
    if (search) { search.focus(); search.setSelectionRange(at, at); }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && pickerOpen) {
      pickerOpen = false;
      drawPicker();
    }
  });

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
    var apps = shownApps();
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
    if (had !== Boolean(name())) {
      hooks.redraw();
      drawPicker();
    } else hooks.changed();
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
