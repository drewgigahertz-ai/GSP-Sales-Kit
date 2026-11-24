// Payment terms for the Quotation page (quotation.html): the Payment term dropdown's choices, in the price matrix's
// order, and the "Exclusive price for:" wording printed under the price. The keys match the term prices the server
// sends (banner-data.js TERM_PRICE_COLUMNS).
(function () {
  var TERMS = [
    { key: "cash", label: "CASH", text: "Cash on Hand, Bank Transfer or Check Payment only." },
    { key: "m3", label: "3 MOS", text: "Straight payment, Debit, 3 months installment, BillEase or GGives." },
    { key: "m6", label: "6 MOS", text: "6 months installment: BDO, Citibank, PNB, Security Bank, UnionBank, BPI, EastWest, Metrobank, RCBC or HSBC." },
    { key: "m9", label: "9 MOS", text: "9 months installment, all banks." },
    { key: "m12", label: "12 MOS", text: "12 months installment: BDO, BPI, Citibank, EastWest, HSBC, Metrobank, PNB, RCBC, Security Bank or UnionBank." },
    { key: "m24", label: "24 MOS (HSBC, METROBANK, PNB, EWB & UNIONBANK)", text: "24 months installment: HSBC, Metrobank, PNB, EastWest or UnionBank." },
    { key: "hc", label: "HOME CREDIT", text: "Home Credit." },
    { key: "m18", label: "18 MOS", text: "18 months installment: BDO, BPI, Citibank, EastWest, HSBC, Metrobank, PNB, RCBC, Security Bank or UnionBank." },
    { key: "bdo24", label: "BDO 24 MOS", text: "24 months installment: BDO." },
    { key: "m24b", label: "24 MOS (RCBC, SECURITY & BPI)", text: "24 months installment: RCBC, Security Bank or BPI." }
  ];
  var byKey = {};
  TERMS.forEach(function (t) { byKey[t.key] = t; });
  // Months for the monthly amount ("₱4,166.58 a month"); cash, 3 months (straight payment) and Home Credit have none.
  var MONTHS = { m6: 6, m9: 9, m12: 12, m18: 18, m24: 24, bdo24: 24, m24b: 24 };

  window.QuotationTerms = {
    list: TERMS,
    months: MONTHS,
    get: function (key) { return byKey[key] || byKey.cash; },
    // The amount a month for a term price, or null for a term without months.
    monthly: function (key, price) { return MONTHS[key] && price != null ? Number(price) / MONTHS[key] : null; }
  };
})();
