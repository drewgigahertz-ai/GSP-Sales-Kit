// Features and Applications dropdowns (Sales Kit and presentation): for each item, 3 dots for the result's laptops
// (Exceed, Meet, Budget, in that order). Features: green when that laptop has a banner for the feature.
// Applications: green when that laptop has a value in DV for the application. Red otherwise. Each list is split
// into Recommended (at least one green) and Not recommended (all red). Before a result is generated there are no
// laptops to check: one plain list with grey dots.
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
    #salesKitFeaturesCheckboxesList .feature-checkbox-row .badge,
    #salesKitAppsCheckboxesList .app-checkbox-row .badge {
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

  // { known, recommended, dots: [{ name, has, label }] }; has(laptop) says whether that laptop has the item.
  function statusWith(has, list, labels) {
    if (!list.length) return { known: false, recommended: true, dots: TIERS.map(() => ({ name: '', has: null })) };
    const dots = list.map((laptop) => {
      const yes = has(laptop);
      return { name: laptop.title || laptop.sku, has: yes, label: yes ? labels[0] : labels[1] };
    });
    return { known: true, recommended: dots.some((dot) => dot.has), dots };
  }

  // A feature: does each laptop have a banner for it?
  function statusOf(feature, list = laptops()) {
    return statusWith((laptop) => getUkspBanners(laptop.sku, feature).length > 0, list, ['has banner', 'no banner']);
  }

  // An application: does each laptop have a value for it in DV (the same exact cell the table shows)?
  function appStatusOf(app, list = laptops()) {
    return statusWith((laptop) => Boolean(getDvAppValue(app, laptop)), list, ['has data', 'not applicable']);
  }

  function dotsElement(status) {
    const wrap = document.createElement('span');
    wrap.className = 'feature-dots';
    status.dots.forEach((dot) => {
      const mark = document.createElement('span');
      mark.className = `feature-dot${dot.has === true ? ' has-banner' : dot.has === false ? ' no-banner' : ''}`;
      if (dot.name) mark.title = `${dot.name}: ${dot.label}`;
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

  // Applications to tick with Select All: the recommended ones once a result exists, else all of them.
  function recommendedAppsOnly(apps) {
    const list = laptops();
    if (!list.length) return apps;
    return apps.filter((app) => appStatusOf(app, list).recommended);
  }

  // A Sales Kit dropdown: dots on each row, rows split into the two groups (rows keep their order).
  // statusOfRow(row, list) gives the row's status.
  function groupList(containerId, rowSelector, statusOfRow) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.feature-group-head, .feature-dots').forEach((element) => element.remove());
    const list = laptops();
    const rows = [...container.querySelectorAll(rowSelector)];
    const recommended = [];
    const notRecommended = [];
    rows.forEach((row) => {
      const status = statusOfRow(row, list);
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

  const checkboxValue = (row) => {
    const box = row.querySelector('input[type="checkbox"]');
    return box ? box.value : '';
  };

  // Sales Kit Features dropdown.
  function groupSalesKitList() {
    groupList('salesKitFeaturesCheckboxesList', '.feature-checkbox-row', (row, list) => statusOf(checkboxValue(row), list));
  }

  // Sales Kit Applications dropdown (each row's checkbox holds the application's id).
  function groupSalesKitAppsList() {
    groupList('salesKitAppsCheckboxesList', '.app-checkbox-row', (row, list) => {
      const app = APP_DATABASE.find((entry) => entry.id === checkboxValue(row));
      return app ? appStatusOf(app, list) : statusWith(() => false, [], []);
    });
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
    statusOf, appStatusOf, laptops, dotsElement, groupHead, recommendedOnly, recommendedAppsOnly,
    groupSalesKitList, groupSalesKitAppsList, untickNotRecommendedForNewResult
  };
})();
