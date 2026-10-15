// Branch accounts (any branch except HO and ALL) receive every branch's stock from the server together with
// their home branch (data.homeBranch). SalesKit then:
// - opens on the Reco Table in SMT mode each time it starts, with the Location locked to the home branch;
// - asks "Switch to OSD?" every time they switch to OSD, where all locations can be chosen (starting on
//   the home branch);
// - locks the Location to the home branch again when they switch back to SMT.
(function () {
  let homeBranch = null;
  let landed = false;
  let originalSwitch = null;

  function mode() {
    try {
      return selectedRecommendationMode;
    } catch {
      return 'OSD';
    }
  }

  // SMT: locked to the home branch. OSD: any location.
  function lockForMode() {
    if (!homeBranch || typeof applyBranchLock !== 'function') return;
    applyBranchLock(mode() === 'SMT' ? homeBranch : null);
  }

  function confirmSwitchToOsd() {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'branch-mode-backdrop';
      backdrop.innerHTML = `
        <div class="branch-mode-dialog" role="alertdialog" aria-modal="true" aria-labelledby="branchModeTitle" aria-describedby="branchModeText">
          <h5 id="branchModeTitle" class="fw-bold mb-2"><i class="bi bi-exclamation-triangle-fill text-warning me-2"></i>Switch to OSD?</h5>
          <p id="branchModeText" class="mb-4"></p>
          <div class="d-flex justify-content-end gap-2">
            <button type="button" class="btn btn-light border rounded-pill px-3" data-answer="stay">Stay in SMT</button>
            <button type="button" class="btn btn-primary rounded-pill px-3" data-answer="switch">Switch to OSD</button>
          </div>
        </div>`;
      backdrop.querySelector('#branchModeText').textContent = `OSD shows stock for all branches, not only ${homeBranch}.`;
      const finish = (answer) => {
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        resolve(answer);
      };
      const onKey = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      };
      backdrop.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-answer]');
        if (button) finish(button.dataset.answer === 'switch');
        else if (event.target === backdrop) finish(false);
      });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(backdrop);
      backdrop.querySelector('[data-answer="stay"]').focus();
    });
  }

  // Called when SalesKit data is applied; branch is data.homeBranch (empty for HO and ALL accounts).
  window.applyBranchHome = function (branch) {
    homeBranch = branch ? String(branch).trim().toUpperCase() : null;
    if (!homeBranch) return;
    if (!landed) {
      landed = true;
      if (originalSwitch && mode() !== 'SMT') originalSwitch('SMT');
      try {
        if (currentActiveView !== 'recotable' && typeof navigateTo === 'function') navigateTo('recotable');
      } catch {}
    }
    lockForMode();
  };

  // Loaded with defer, so the page's own script (switchRecommendationMode) has already run.
  (() => {
    if (typeof window.switchRecommendationMode !== 'function') return;
    originalSwitch = window.switchRecommendationMode;
    window.switchRecommendationMode = function (requested) {
      const target = String(requested).toUpperCase() === 'SMT' ? 'SMT' : 'OSD';
      if (homeBranch && target === 'OSD' && mode() !== 'OSD') {
        confirmSwitchToOsd().then((confirmed) => {
          if (!confirmed) return;
          originalSwitch('OSD');
          lockForMode();
        });
        return;
      }
      originalSwitch(target);
      lockForMode();
    };
  })();
})();
