const $ = (id) => document.getElementById(id);
const USERNAME_KEY = 'saleskit.lastUsername';
let offlineAvailable = false;

function showMessage(text, type = 'error') {
  $('message').hidden = !text;
  $('message').className = `message is-${type}`;
  $('messageIcon').className = `bi ${type === 'error' ? 'bi-exclamation-circle' : 'bi-info-circle'}`;
  $('messageText').textContent = text;
}

function setBusy(busy) {
  $('submit').disabled = busy;
  $('submit').innerHTML = busy
    ? '<span class="spinner"></span> Signing in…'
    : '<i class="bi bi-box-arrow-in-right"></i> Sign in';
}

// The last username is kept here; the password only with "Remember me on this laptop" (encrypted, in the main
// process: remember-login.js).
function rememberUsername(name) {
  try {
    localStorage.setItem(USERNAME_KEY, name);
  } catch {}
}

function lastUsername() {
  try {
    return localStorage.getItem(USERNAME_KEY) || '';
  } catch {
    return '';
  }
}

$('togglePassword').addEventListener('click', () => {
  const input = $('password');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('togglePassword').innerHTML = `<i class="bi ${show ? 'bi-eye-slash' : 'bi-eye'}"></i>`;
  $('togglePassword').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  input.focus();
});

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = $('username').value.trim();
  const password = $('password').value;
  if (!username || !password) return;
  setBusy(true);
  showMessage('');
  const result = await window.saleskit.login(username, password, $('rememberMe').checked);
  if (result && result.ok) {
    rememberUsername(username);
    return; // SalesKit opens.
  }
  setBusy(false);
  showMessage(result ? result.error : 'Sign in failed.');
  $('offline').hidden = !(result && result.unreachable && offlineAvailable);
  $('password').select();
});

$('openAtStartup').addEventListener('change', async () => {
  $('openAtStartup').checked = await window.saleskit.setOpenAtStartup($('openAtStartup').checked);
});

$('continueOffline').addEventListener('click', async () => {
  const opened = await window.saleskit.continueOffline();
  if (!opened) showMessage('There is no saved data on this laptop yet. Connect to the internet to sign in.');
});

(async () => {
  const info = await window.saleskit.getLoginInfo();
  offlineAvailable = info.offlineAvailable;
  $('version').textContent = `SalesKit v${info.version}`;
  if (info.logo) {
    $('brandLogo').src = info.logo;
    $('brandLogo').hidden = false;
    $('brandName').hidden = true;
  }
  $('openAtStartup').checked = info.openAtStartup;
  const remembered = lastUsername();
  $('username').value = remembered;
  // A remembered password: sign in by itself (SalesKit opens); the form shows only if that does not work.
  if (info.autoLogin) {
    setBusy(true);
    const result = await window.saleskit.autoLogin();
    if (result && result.ok) return;
    setBusy(false);
    showMessage(result ? result.error : 'Please log in.');
    $('offline').hidden = !(result && result.unreachable && offlineAvailable);
  } else if (info.message) showMessage(info.message, 'info');
  (remembered ? $('password') : $('username')).focus();
})();
