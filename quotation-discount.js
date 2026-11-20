// Discounts on the Quotation page (quotation.html): per laptop and on the whole quotation. A discount is typed as a
// peso amount ("2000", "₱2,000") or a percent ("5%"). It never goes below 0 or above the price it is taken from.
(function () {
  function number(text) {
    var n = Number(String(text == null ? "" : text).replace(/[^\d.]/g, ""));
    return isFinite(n) ? n : 0;
  }
  function round2(n) { return Math.round(n * 100) / 100; }
  function money(n) { return (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  // "5%" → { percent: 5 }, "2,000" → { amount: 2000 }, "" or 0 → null.
  function parse(text) {
    var t = String(text == null ? "" : text).trim();
    if (!t) return null;
    var n = number(t);
    if (!(n > 0)) return null;
    return /%/.test(t) ? { percent: Math.min(n, 100) } : { amount: n };
  }

  // The pesos taken off price (0 when there is no discount).
  function amountOff(price, text) {
    var d = parse(text), p = Math.max(0, Number(price) || 0);
    if (!d || !p) return 0;
    return round2(Math.min(p, d.percent !== undefined ? p * d.percent / 100 : d.amount));
  }

  // { off, net, label } for a price and a typed discount; label like "Less 5% (4,349.95)" or "Less 2,000.00".
  function apply(price, text) {
    var p = Math.max(0, Number(price) || 0), off = amountOff(p, text), d = parse(text);
    var label = !off ? "" : d.percent !== undefined ? "Less " + (+d.percent.toFixed(2)) + "% (" + money(off) + ")" : "Less " + money(off);
    return { off: off, net: round2(p - off), label: label };
  }

  // The discount as it is kept in the draft: "5%" or "2000" (blank when it is no discount).
  function clean(text) {
    var d = parse(text);
    if (!d) return "";
    return d.percent !== undefined ? (+d.percent.toFixed(2)) + "%" : String(round2(d.amount));
  }

  window.QuotationDiscount = { parse: parse, amountOff: amountOff, apply: apply, clean: clean };
})();
