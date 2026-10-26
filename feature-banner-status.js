// Features dropdowns (Sales Kit and presentation): which of the result's 3 laptops (Exceed, Meet, Budget) have a
// banner for a feature. Each feature shows 3 dots in that order (green: has a banner, red: none), and the list is
// split into Recommended (at least one banner) and Not recommended (no banner on any of the 3). Before a result is
// generated there are no laptops to check: one plain list with grey dots.
(function () {
  const TIERS = ['exceed', 'meet', 'budget'];

  const style = document.createElement('style');
  style.textContent = `
    .feature-dots {
      display: inline-flex;
      gap: 3px;
      margin-left: auto;
      padding-left: 8px;
      flex: none;
    }

    .feature-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #cbd5e1;
    }

    .feature-dot.has-banner {
      background: #16a34a;
    }

    .feature-dot.no-banner {
      background: #dc2626;
    }

    /* The row number badges (A3, A11, ...) all take the same width, so the dots line up. */
    #salesKitFeaturesCheckboxesList .feature-checkbox-row .badge {
      min-width: 2.9em;
      text-align: center;
    }

    .feature-group-head {
      padding: 5px 12px 3px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      color: #64748b;
      font-size: 0.66rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .feature-group-head.is-recommended {
      color: #15803d;
    }

    .feature-group-head.is-not-recommended {
      color: #b91c1c;
    }

    .feature-is-not-recommended label,
    label.feature-is-not-recommended {
      opacity: .6;
    }
  `;
  document.head.appendChild(style);

  // The result's laptops, or [] before a result is generated.
  function laptops() {
    try {
      const found = TIERS.map((tier) => getSelectedLaptopForTier(tier));
      return found.every((laptop) => laptop && laptop.sku) ? found : [];
    } catch {
      return [];
    }
  }

  // { known, recommended, dots: [{ name, has }] } for a feature.
  function statusOf(feature, list = laptops()) {
    if (!list.length) return { known: false, recommended: true, dots: TIERS.map(() => ({ name: '', has: null })) };
    const dots = list.map((laptop) => ({
      name: laptop.title || laptop.sku,
      has: getUkspBanners(laptop.sku, feature).length > 0
    }));
    return { known: true, recommended: dots.some((dot) => dot.has), dots };
  }

  function dotsElement(status) {
    const wrap = document.createElement('span');
    wrap.className = 'feature-dots';
    status.dots.forEach((dot) => {
      const mark = document.createElement('span');
      mark.className = `feature-dot${dot.has === true ? ' has-banner' : dot.has === false ? ' no-banner' : ''}`;
      if (dot.name) mark.title = `${dot.name}: ${dot.has ? 'has banner' : 'no banner'}`;
      wrap.appendChild(mark);
    });
    return wrap;
  }

  function groupHead(recommended) {
    const head = document.createElement('div');
    head.className = `feature-group-head ${recommended ? 'is-recommended' : 'is-not-recommended'}`;
    head.textContent = recommended ? 'Recommended' : 'Not recommended';
    return head;
  }

  // Features to tick with Select All: the recommended ones once a result exists, else all of them.
  function recommendedOnly(features) {
    const list = laptops();
    if (!list.length) return features;
    return features.filter((feature) => statusOf(feature, list).recommended);
  }

  // Sales Kit Features dropdown: dots on each row, rows split into the two groups (rows keep their order).
  function groupSalesKitList() {
    const container = document.getElementById('salesKitFeaturesCheckboxesList');
    if (!container) return;
    container.querySelectorAll('.feature-group-head, .feature-dots').forEach((element) => element.remove());
    const list = laptops();
    const rows = [...container.querySelectorAll('.feature-checkbox-row')];
    const recommended = [];
    const notRecommended = [];
    rows.forEach((row) => {
      const box = row.querySelector('input[type="checkbox"]');
      const status = statusOf(box ? box.value : '', list);
      row.classList.toggle('feature-is-not-recommended', status.known && !status.recommended);
      const badge = row.querySelector('.badge');
      row.insertBefore(dotsElement(status), badge);
      (status.recommended ? recommended : notRecommended).push(row);
    });
    if (!list.length) return;
    container.replaceChildren(
      ...(recommended.length ? [groupHead(true), ...recommended] : []),
      ...(notRecommended.length ? [groupHead(false), ...notRecommended] : [])
    );
  }

  // When the result's laptops change (a new recommendation or a swapped laptop), every Recommended feature is
  // ticked and every Not recommended one unticked; changes made by hand afterwards stay until the laptops change
  // again. Returns true when the selection changed.
  let resultKey = null;
  function untickNotRecommendedForNewResult() {
    const list = laptops();
    const key = list.map((laptop) => laptop.sku).join('|');
    if (!list.length || key === resultKey) return false;
    resultKey = key;
    const recommended = getActiveFeaturesList().filter((feature) => statusOf(feature, list).recommended);
    const same = recommended.length === selectedFeatures.length && recommended.every((feature) => selectedFeatures.includes(feature));
    if (same) return false;
    selectedFeatures = recommended;
    return true;
  }

  window.FeatureBannerStatus = {
    statusOf, laptops, dotsElement, groupHead, recommendedOnly, groupSalesKitList, untickNotRecommendedForNewResult
  };
})();
