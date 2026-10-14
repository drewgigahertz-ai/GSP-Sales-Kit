const api = window.salesKitServer;
const $ = (id) => document.getElementById(id);
const LOG_ICONS = {
  success: 'bi-check-circle-fill',
  error: 'bi-x-circle-fill',
  warning: 'bi-exclamation-triangle-fill',
  request: 'bi-arrow-left-right',
  info: 'bi-info-circle-fill'
};

let state = null;
let settingsDirty = false;

function formatTime(iso, withDate = false) {
  if (!iso) return '—';
  const date = new Date(iso);
  return withDate
    ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function timeAgo(iso) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : formatTime(iso, true);
}

let toastTimer;
function toast(message, isError = false) {
  const element = $('toast');
  element.textContent = message;
  element.classList.toggle('is-error', isError);
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 2600);
}

// Runs a dashboard action, showing errors from the server as a toast.
async function run(button, action, successMessage) {
  if (button) button.disabled = true;
  try {
    const result = await action();
    if (successMessage) toast(successMessage);
    return result;
  } catch (error) {
    toast(String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);
    return null;
  } finally {
    if (button) button.disabled = false;
  }
}

function renderStatus() {
  const pill = $('statusPill');
  pill.classList.toggle('is-running', state.running);
  pill.classList.toggle('is-error', !state.running && Boolean(state.apiError));
  $('statusText').textContent = state.running ? `Running · port ${state.port}` : state.apiError ? 'Not sharing data' : 'Starting…';
  $('apiError').hidden = !state.apiError;
  $('apiErrorText').textContent = state.apiError;
  $('appVersion').textContent = `v${state.version}`;
}

function renderConnection() {
  const list = $('addressList');
  list.replaceChildren();
  if (!state.addresses.length) {
    list.innerHTML = '<div class="empty">No network connection found.</div>';
  }
  state.addresses.forEach((address) => {
    const row = document.createElement('div');
    row.className = 'copy-row';
    const code = document.createElement('code');
    code.textContent = address;
    const copy = document.createElement('button');
    copy.className = 'btn btn-sm btn-light btn-icon';
    copy.innerHTML = '<i class="bi bi-clipboard"></i> Copy';
    copy.addEventListener('click', () => run(copy, () => api.copyText(address), 'Address copied'));
    const config = document.createElement('button');
    config.className = 'btn btn-sm btn-light btn-icon';
    config.title = 'Copy client config for this address';
    config.innerHTML = '<i class="bi bi-clipboard-plus"></i>';
    config.addEventListener('click', () => run(config, () => api.copyClientConfig(address), 'Client config copied'));
    row.append(code, copy, config);
    list.appendChild(row);
  });
  $('tokenPreview').textContent = state.tokenPreview;
}

function renderSync() {
  const box = $('syncStatus');
  const last = state.lastSync;
  box.classList.remove('is-ok', 'is-error');
  if (state.syncing) {
    $('syncIcon').className = 'bi bi-arrow-repeat';
    $('syncHeadline').textContent = 'Syncing from Google Sheets…';
    $('syncDetail').textContent = last ? `Last sync ${timeAgo(last.at)}` : 'First sync';
  } else if (!last) {
    $('syncIcon').className = 'bi bi-clock-history';
    $('syncHeadline').textContent = 'No sync yet';
    $('syncDetail').textContent = state.serviceAccountPath ? 'Press “Sync now” to load the sheets.' : 'Choose the Google key in Settings first.';
  } else if (last.ok) {
    box.classList.add('is-ok');
    $('syncIcon').className = 'bi bi-check2-circle';
    $('syncHeadline').textContent = last.changed
      ? `Updated ${last.updatedCount} rows${last.deletedCount ? `, removed ${last.deletedCount}` : ''}`
      : 'Up to date — no changes';
    $('syncDetail').textContent = `${timeAgo(last.at)} · ${formatTime(last.at, true)} · took ${(last.durationMs / 1000).toFixed(1)} s`;
  } else {
    box.classList.add('is-error');
    $('syncIcon').className = 'bi bi-exclamation-triangle';
    $('syncHeadline').textContent = 'Last sync failed';
    $('syncDetail').textContent = `${last.error} · ${timeAgo(last.at)}`;
  }

  $('syncNow').disabled = state.syncing;
  $('syncNow').innerHTML = state.syncing
    ? '<span class="spinner-border spinner-border-sm me-1"></span> Syncing…'
    : '<i class="bi bi-arrow-clockwise"></i> Sync now';
  $('nextSync').textContent = state.nextSyncAt && !state.syncing
    ? `Next automatic sync at ${formatTime(state.nextSyncAt)} (every ${state.syncIntervalMinutes} min)`
    : '';
  renderProgress(state.syncing ? state.syncProgress : null);
}

function renderProgress(progress) {
  const visible = Boolean(state && state.syncing);
  $('syncProgressWrap').hidden = !visible;
  $('syncProgressText').hidden = !visible;
  if (!visible) return;
  let percent = 5;
  let text = 'Connecting to Google Sheets…';
  if (progress && progress.phase === 'sheets' && progress.total) {
    percent = Math.max(5, Math.round((progress.completed / progress.total) * 90));
    text = `Read ${progress.completed} of ${progress.total} sheets${progress.sheet ? ` · ${progress.sheet}` : ''}`;
  } else if (progress && progress.phase === 'sqlite') {
    percent = 95;
    text = progress.message;
  }
  $('syncProgressBar').style.width = `${percent}%`;
  $('syncProgressText').textContent = text;
}

function renderSettings() {
  const keyPath = $('keyPath');
  keyPath.textContent = state.serviceAccountPath || 'No key file chosen';
  keyPath.title = state.serviceAccountPath || '';
  keyPath.classList.toggle('key-missing', !state.serviceAccountPath);
  if (settingsDirty) return;
  $('spreadsheetId').value = state.spreadsheetId;
  const interval = $('syncInterval');
  if (![...interval.options].some((option) => Number(option.value) === state.syncIntervalMinutes)) {
    interval.add(new Option(`${state.syncIntervalMinutes} minutes`, state.syncIntervalMinutes));
  }
  interval.value = String(state.syncIntervalMinutes);
  $('port').value = state.port;
  $('autoStart').checked = state.autoStart;
  $('allowWithoutLogin').checked = state.allowWithoutLogin;
}

function renderData() {
  $('dbPath').textContent = state.database.path ? state.database.path.split(/[\\/]/).pop() : '';
  $('dbPath').title = state.database.path || '';
  const list = $('tableList');
  list.replaceChildren();
  if (!state.database.tables.length) {
    list.innerHTML = '<div class="empty">No data yet — run a sync.</div>';
    return;
  }
  state.database.tables.forEach(({ name, rowCount }) => {
    const item = document.createElement('div');
    item.className = 'table-item';
    const label = document.createElement('span');
    label.className = 'table-name';
    label.textContent = name.replace(/_/g, ' ');
    label.title = name;
    const count = document.createElement('span');
    count.className = 'table-count';
    count.textContent = rowCount.toLocaleString();
    item.append(label, count);
    item.title = `Open ${name} in the Data tab`;
    item.addEventListener('click', () => openSheet(name));
    list.appendChild(item);
  });
}

function render(nextState) {
  state = nextState;
  renderStatus();
  renderConnection();
  renderSync();
  renderSettings();
  renderData();
  renderBackups();
  renderSheetTabs();
  $('onlineBadge').hidden = !state.onlineDevices;
  $('onlineBadge').textContent = state.onlineDevices;
  // A sync or restore changed the data: refresh the open sheet.
  if (sheet.loadedVersion !== null && sheet.loadedVersion !== state.dataVersion && currentView === 'data') loadSheet();
}

function addLog(entry) {
  const item = document.createElement('li');
  item.className = `log-${entry.level}`;
  item.hidden = entry.level === 'request' && !$('showRequests').checked;
  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = formatTime(entry.time);
  const icon = document.createElement('i');
  icon.className = `bi ${LOG_ICONS[entry.level] || LOG_ICONS.info}`;
  const message = document.createElement('span');
  message.textContent = entry.message;
  item.append(time, icon, message);
  const list = $('logList');
  list.prepend(item);
  while (list.children.length > 300) list.lastElementChild.remove();
}

// ---------- Logo ----------

// The GigaHertz header logo from the LOGO sheet replaces the placeholder icon.
function applyLogos({ header } = {}) {
  const logo = $('headerLogo');
  if (header) logo.src = header;
  logo.hidden = !header;
  $('brandMark').hidden = Boolean(header);
  $('brandCompany').hidden = Boolean(header);
}

api.onLogos(applyLogos);
api.getLogos().then(applyLogos);

// ---------- Tabs ----------

let currentView = 'overview';

function showView(view) {
  currentView = view;
  document.querySelectorAll('.nav-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === view));
  document.querySelectorAll('.view').forEach((section) => { section.hidden = section.id !== `view-${view}`; });
  $('main').classList.toggle('is-data', view === 'data');
  if (view === 'data' && !sheet.table && state && state.database.tables.length) openSheet(state.database.tables[0].name);
  if (view === 'devices') loadDevices();
  if (view === 'users') loadUsers();
}

document.querySelectorAll('.nav-tab').forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.view)));

// ---------- Data: spreadsheet view ----------

const PAGE_SIZE = 100;
const sheet = { table: '', offset: 0, search: '', total: 0, columns: [], rows: [], loadedVersion: null, request: 0 };

function columnLetter(index) {
  let letter = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter;
  return letter;
}

function renderSheetTabs() {
  const tabs = $('sheetTabs');
  tabs.replaceChildren();
  state.database.tables.forEach(({ name, rowCount }) => {
    const tab = document.createElement('button');
    tab.className = `sheet-tab${name === sheet.table ? ' active' : ''}`;
    tab.setAttribute('role', 'tab');
    tab.textContent = name.replace(/_/g, ' ');
    const count = document.createElement('small');
    count.textContent = rowCount.toLocaleString();
    tab.appendChild(count);
    tab.addEventListener('click', () => openSheet(name));
    tabs.appendChild(tab);
  });
}

function openSheet(name) {
  if (currentView !== 'data') showView('data');
  sheet.table = name;
  sheet.offset = 0;
  sheet.search = '';
  $('sheetSearch').value = '';
  renderSheetTabs();
  loadSheet();
}

async function loadSheet() {
  if (!sheet.table) return;
  const request = ++sheet.request;
  const result = await run(null, () => api.getTableData(sheet.table, { limit: PAGE_SIZE, offset: sheet.offset, search: sheet.search }));
  if (!result || request !== sheet.request) return;
  Object.assign(sheet, { columns: result.columns, rows: result.rows, total: result.total, loadedVersion: state.dataVersion });
  renderSheet();
}

// Sheet row number from the row id (item_0012 is row 12 in Google Sheets).
function sheetRowNumber(row, index) {
  const match = /^item_(\d+)$/.exec(String(row.id || ''));
  return match ? Number(match[1]) : sheet.offset + index + 1;
}

function highlight(cell, text) {
  const query = sheet.search.toLowerCase();
  const at = query ? text.toLowerCase().indexOf(query) : -1;
  if (at < 0) {
    cell.textContent = text;
    return;
  }
  const mark = document.createElement('mark');
  mark.textContent = text.slice(at, at + query.length);
  cell.append(text.slice(0, at), mark, text.slice(at + query.length));
}

function selectCell(cell, ref, value) {
  document.querySelectorAll('#sheetGrid td.selected').forEach((item) => item.classList.remove('selected'));
  cell.classList.add('selected');
  $('formulaRef').textContent = ref;
  $('formulaValue').textContent = value === '' ? '(empty)' : value;
}

function renderSheet() {
  const columns = sheet.columns.filter((column) => column !== 'id');
  $('sheetTitle').textContent = sheet.table.replace(/_/g, ' ');
  const first = sheet.total ? sheet.offset + 1 : 0;
  const last = Math.min(sheet.offset + PAGE_SIZE, sheet.total);
  $('sheetCount').textContent = `${first.toLocaleString()}–${last.toLocaleString()} of ${sheet.total.toLocaleString()} rows${sheet.search ? ' matching' : ''} · ${columns.length} columns`;
  $('sheetPrev').disabled = sheet.offset === 0;
  $('sheetNext').disabled = last >= sheet.total;
  $('formulaRef').textContent = '—';
  $('formulaValue').textContent = 'Click a cell to see its full value.';

  const grid = $('sheetGrid');
  grid.replaceChildren();
  if (!sheet.rows.length) {
    const row = grid.insertRow();
    const cell = row.insertCell();
    cell.className = 'sheet-empty';
    cell.textContent = sheet.search ? 'No rows match your search.' : 'This sheet is empty.';
    return;
  }

  const head = grid.createTHead().insertRow();
  const corner = document.createElement('th');
  corner.className = 'row-head';
  corner.textContent = 'Row';
  head.appendChild(corner);
  columns.forEach((column, index) => {
    const th = document.createElement('th');
    const letter = document.createElement('span');
    letter.className = 'col-letter';
    letter.textContent = columnLetter(index);
    th.append(letter, column);
    th.title = column;
    head.appendChild(th);
  });

  const body = grid.createTBody();
  sheet.rows.forEach((row, rowIndex) => {
    const tr = body.insertRow();
    const rowNumber = sheetRowNumber(row, rowIndex);
    const rowHead = document.createElement('th');
    rowHead.className = 'row-head';
    rowHead.textContent = rowNumber;
    tr.appendChild(rowHead);
    columns.forEach((column, columnIndex) => {
      const value = row[column] === null || row[column] === undefined ? '' : String(row[column]);
      const cell = tr.insertCell();
      highlight(cell, value.replace(/\s*\n\s*/g, ' ⏎ '));
      cell.addEventListener('click', () => selectCell(cell, `${columnLetter(columnIndex)}${rowNumber} · ${column}`, value));
    });
  });
  $('sheetGridWrap').scrollTo({ top: 0 });
}

let searchTimer;
$('sheetSearch').addEventListener('input', (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    sheet.search = event.target.value.trim();
    sheet.offset = 0;
    loadSheet();
  }, 250);
});
$('sheetPrev').addEventListener('click', () => { sheet.offset = Math.max(0, sheet.offset - PAGE_SIZE); loadSheet(); });
$('sheetNext').addEventListener('click', () => { sheet.offset += PAGE_SIZE; loadSheet(); });
$('sheetReload').addEventListener('click', () => loadSheet());

// ---------- Devices ----------

function renderDevices(list) {
  $('devOnline').textContent = list.filter((device) => device.online && device.authorized).length;
  $('devTotal').textContent = list.length;
  const rows = $('deviceRows');
  rows.replaceChildren();
  if (!list.length) {
    rows.innerHTML = '<tr><td colspan="11" class="empty text-center py-4">No SalesKit laptop has connected yet.</td></tr>';
    return;
  }
  list.forEach((device) => {
    const tr = rows.insertRow();
    const addCell = (value, className = '') => {
      const cell = tr.insertCell();
      cell.textContent = value || '—';
      cell.className = className;
      return cell;
    };
    const [status, label] = !device.authorized ? ['rejected', 'Wrong key']
      : device.needsLogin ? ['offline', 'Not signed in']
        : device.online ? ['online', 'Online'] : ['offline', 'Offline'];
    const badge = document.createElement('span');
    badge.className = `state-badge state-${status}`;
    badge.textContent = label;
    tr.insertCell().appendChild(badge);

    const account = device.account;
    const userCell = addCell(account ? account.displayName : device.user ? `(${device.user})` : '', account ? 'device-name' : 'muted-small');
    userCell.title = account ? `Signed in as ${account.username}` : 'Not signed in. Shows the Windows user, if known.';
    addCell(account ? account.branch : '', account ? 'fw-semibold' : '');
    const laptop = [device.make, device.model].filter(Boolean).join(' · ');
    addCell(laptop);
    addCell(device.name || 'Unknown (SalesKit 1.0.1 or older)', device.name ? '' : 'muted-small');
    addCell(device.address, 'muted-small');
    addCell(device.version ? `v${device.version}` : '');
    const refresh = tr.insertCell();
    if (device.lastRefresh) {
      const when = document.createElement('div');
      when.textContent = formatTime(device.lastRefresh, true);
      const detail = document.createElement('div');
      const current = device.lastRefreshVersion === state.dataVersion;
      detail.className = `data-tag ${current ? 'is-current' : 'is-old'}`;
      detail.textContent = `${timeAgo(device.lastRefresh)} · ${current ? 'latest data' : 'older data'}`;
      refresh.title = current ? 'This laptop has the current data.' : 'The data changed after this laptop last loaded it.';
      refresh.append(when, detail);
    } else {
      refresh.textContent = '—';
    }
    addCell(timeAgo(device.lastSeen)).title = formatTime(device.lastSeen, true);
    addCell(device.requests.toLocaleString(), 'muted-small');
    const forget = document.createElement('button');
    forget.className = 'btn btn-sm btn-light btn-icon';
    forget.title = 'Remove from this list';
    forget.innerHTML = '<i class="bi bi-x-lg"></i>';
    forget.addEventListener('click', () => run(forget, () => api.forgetDevice(device.key)).then((next) => next && renderDevices(next)));
    const actions = tr.insertCell();
    actions.className = 'text-end';
    actions.appendChild(forget);
  });
}

function renderRejected(list) {
  $('devRejected').textContent = list.length;
  const rows = $('rejectedRows');
  rows.replaceChildren();
  if (!list.length) {
    rows.innerHTML = '<tr><td colspan="5" class="empty text-center py-4">No refused connections.</td></tr>';
    return;
  }
  list.forEach((entry) => {
    const tr = rows.insertRow();
    [entry.address, entry.requests.toLocaleString(), timeAgo(entry.lastSeen), formatTime(entry.firstSeen, true), entry.lastPath || '']
      .forEach((value, index) => {
        const cell = tr.insertCell();
        cell.textContent = value;
        if (index > 0) cell.className = 'muted-small';
      });
  });
}

async function loadDevices() {
  const [list, rejected] = await Promise.all([run(null, api.getDevices), run(null, api.getRejected)]);
  if (list) renderDevices(list);
  if (rejected) renderRejected(rejected);
}

$('clearRejected').addEventListener('click', (event) => run(event.currentTarget, api.clearRejected).then((next) => next && renderRejected(next)));

api.onDevices((list) => { if (currentView === 'devices') renderDevices(list); });
// Online/offline depends on time passing, so refresh the list while it is shown.
setInterval(() => { if (currentView === 'devices') loadDevices(); }, 30 * 1000);

// ---------- Users ----------

function renderUsers(list) {
  const active = list.filter((user) => !user.disabled).length;
  $('userSummary').textContent = `${list.length} user${list.length === 1 ? '' : 's'} · ${active} active`;
  const rows = $('userRows');
  rows.replaceChildren();
  if (!list.length) {
    rows.innerHTML = '<tr><td colspan="7" class="empty text-center py-4">No users yet. Add the first one above.</td></tr>';
    return;
  }
  list.forEach((user) => {
    const tr = rows.insertRow();
    const badge = document.createElement('span');
    badge.className = `state-badge ${user.disabled ? 'state-rejected' : 'state-online'}`;
    badge.textContent = user.disabled ? 'Disabled' : 'Active';
    tr.insertCell().appendChild(badge);
    const addCell = (value, className = '') => {
      const cell = tr.insertCell();
      cell.textContent = value || '—';
      cell.className = className;
      return cell;
    };
    addCell(user.displayName, 'device-name');
    addCell(user.username, 'muted-small');
    const branch = addCell(user.branch, 'fw-semibold');
    branch.title = 'Click to change the branch';
    branch.style.cursor = 'pointer';
    branch.addEventListener('click', () => editBranch(user, branch));
    const recent = user.lastLogin && Date.now() - new Date(user.lastLogin).getTime() < 24 * 60 * 60 * 1000;
    addCell(user.lastLogin ? `${formatTime(user.lastLogin, true)}${recent ? ` (${timeAgo(user.lastLogin)})` : ''}` : 'Never', 'muted-small');
    addCell(user.activeSessions ? `Yes (${user.activeSessions})` : 'No', user.activeSessions ? 'text-success fw-semibold' : 'muted-small');

    const actions = tr.insertCell();
    const box = document.createElement('div');
    box.className = 'user-actions';
    const button = (html, className, title, handler) => {
      const element = document.createElement('button');
      element.className = `btn btn-sm ${className} btn-icon`;
      element.innerHTML = html;
      element.title = title;
      element.addEventListener('click', () => handler(element));
      box.appendChild(element);
    };
    button('<i class="bi bi-key"></i> Password', 'btn-light', 'Set a new password', () => askPassword(user));
    if (user.activeSessions) {
      button('<i class="bi bi-box-arrow-right"></i>', 'btn-light', 'Sign out now', (element) =>
        run(element, () => api.signOutUser(user.username), `${user.displayName} signed out`).then((next) => next && renderUsers(next)));
    }
    button(user.disabled ? '<i class="bi bi-person-check"></i> Enable' : '<i class="bi bi-person-slash"></i> Disable',
      user.disabled ? 'btn-outline-success' : 'btn-outline-secondary',
      user.disabled ? 'Allow this user to log in again' : 'Block this user and sign them out',
      (element) => run(element, () => api.updateUser(user.username, { disabled: !user.disabled }),
        user.disabled ? 'User enabled' : 'User disabled').then((next) => next && renderUsers(next)));
    button('<i class="bi bi-trash3"></i>', 'btn-outline-danger', 'Delete this user', (element) => {
      if (!confirm(`Delete ${user.displayName} (${user.username})? They will no longer be able to log in.`)) return;
      run(element, () => api.removeUser(user.username), 'User deleted').then((next) => next && renderUsers(next));
    });
    actions.appendChild(box);
  });
}

async function loadUsers() {
  const [list, branches] = await Promise.all([run(null, api.getUsers), run(null, api.getBranches)]);
  if (list) renderUsers(list);
  if (branches) {
    $('branchOptions').replaceChildren(...branches.map((branch) => new Option(branch, branch)));
  }
}

// Inline branch editor: the cell becomes a small text field with the branch list.
function editBranch(user, cell) {
  if (cell.querySelector('input')) return;
  const input = document.createElement('input');
  input.className = 'form-control form-control-sm';
  input.style.width = '110px';
  input.value = user.branch;
  input.setAttribute('list', 'branchOptions');
  cell.replaceChildren(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const value = input.value.trim().toUpperCase();
    if (!save || !value || value === user.branch) {
      cell.textContent = user.branch;
      return;
    }
    run(null, () => api.updateUser(user.username, { branch: value }), `Branch set to ${value}`).then((next) => (next ? renderUsers(next) : (cell.textContent = user.branch)));
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

let passwordUser = null;
function askPassword(user) {
  passwordUser = user;
  $('passwordDialogFor').textContent = `For ${user.displayName} (${user.username}). They will be asked to log in again.`;
  $('passwordInput').value = '';
  $('passwordDialog').showModal();
  $('passwordInput').focus();
}
$('passwordCancel').addEventListener('click', () => $('passwordDialog').close());
$('passwordForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const user = passwordUser;
  run(event.submitter, () => api.setUserPassword(user.username, $('passwordInput').value), 'Password changed').then((next) => {
    if (!next) return;
    $('passwordDialog').close();
    renderUsers(next);
  });
});

$('addUserForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const next = await run(event.submitter, () => api.createUser({
    username: $('newUsername').value,
    displayName: $('newDisplayName').value,
    branch: $('newBranch').value,
    password: $('newPassword').value
  }), 'User added');
  if (!next) return;
  event.target.reset();
  renderUsers(next);
});

// ---------- Backups ----------

const BACKUP_REASONS = { 'before-sync': 'Before a sync', manual: 'Manual', 'before-restore': 'Before a restore' };

function formatSize(bytes) {
  return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function renderBackups() {
  const rows = $('backupRows');
  rows.replaceChildren();
  if (!state.backups.length) {
    rows.innerHTML = '<tr><td colspan="4" class="empty text-center py-4">No backups yet. One is made automatically before the next sync that changes data.</td></tr>';
    return;
  }
  state.backups.forEach((backup) => {
    const tr = rows.insertRow();
    tr.insertCell().textContent = `${formatTime(backup.createdAt, true)} (${timeAgo(backup.createdAt)})`;
    tr.insertCell().textContent = BACKUP_REASONS[backup.reason] || backup.reason;
    const size = tr.insertCell();
    size.className = 'muted-small';
    size.textContent = formatSize(backup.size);
    const actions = tr.insertCell();
    actions.className = 'text-end';
    const restore = document.createElement('button');
    restore.className = 'btn btn-sm btn-outline-danger btn-icon';
    restore.innerHTML = '<i class="bi bi-arrow-counterclockwise"></i> Restore';
    restore.addEventListener('click', () => {
      if (!confirm(`Restore the data from ${formatTime(backup.createdAt, true)}?\n\nUser accounts also go back to how they were then (including passwords). The current data is backed up first, and every SalesKit laptop reloads the restored data. The next sync from Google Sheets updates the sheet data again.`)) return;
      run(restore, () => api.restoreBackup(backup.name), 'Backup restored').then((next) => next && render(next));
    });
    actions.appendChild(restore);
  });
}

$('backupNow').addEventListener('click', (event) => run(event.currentTarget, api.backupNow, 'Backup saved').then((next) => next && render(next)));
$('openBackups').addEventListener('click', (event) => run(event.currentTarget, api.openBackupsFolder));

// ---------- Events ----------

$('syncNow').addEventListener('click', () => run(null, api.syncNow));
$('chooseKey').addEventListener('click', (event) => run(event.currentTarget, api.chooseKey).then((next) => next && render(next)));
$('copyToken').addEventListener('click', (event) => run(event.currentTarget, api.copyToken, 'Token copied'));
$('copyClientConfig').addEventListener('click', (event) => run(event.currentTarget, () => api.copyClientConfig(), 'Client config copied'));
$('newToken').addEventListener('click', (event) => {
  if (!confirm('Create a new token? Every SalesKit client stops connecting until it is rebuilt with the new token.')) return;
  run(event.currentTarget, api.newToken, 'New token created').then((next) => next && render(next));
});

$('settingsForm').addEventListener('input', () => { settingsDirty = true; });
$('settingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  const next = await run(button, () => api.updateSettings({
    spreadsheetId: $('spreadsheetId').value,
    syncIntervalMinutes: Number($('syncInterval').value),
    port: Number($('port').value),
    autoStart: $('autoStart').checked,
    allowWithoutLogin: $('allowWithoutLogin').checked
  }), 'Settings saved');
  if (next) {
    settingsDirty = false;
    render(next);
  }
});

$('showRequests').addEventListener('change', (event) => {
  document.querySelectorAll('#logList .log-request').forEach((item) => { item.hidden = !event.target.checked; });
});

api.onState(render);
api.onLog(addLog);
api.onSyncProgress((progress) => {
  if (state) state.syncProgress = progress;
  renderProgress(progress);
});

// Keep "x min ago" texts fresh.
setInterval(() => state && renderSync(), 30 * 1000);

(async () => {
  render(await api.getState());
  (await api.getLogs()).forEach(addLog);
})();
