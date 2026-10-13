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

// Remember only the username on this laptop (never the password).
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
  const result = await window.saleskit.login(username, password);
  if (result && result.ok) {
    rememberUsername(username);
    return; // SalesKit opens.
  }
  setBusy(false);
  showMessage(result ? result.error : 'Sign in failed.');
  $('offline').hidden = !(result && result.unreachable && offlineAvailable);
  $('password').select();
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
  if (info.message) showMessage(info.message, 'info');
  const remembered = lastUsername();
  $('username').value = remembered;
  (remembered ? $('password') : $('username')).focus();
})();
