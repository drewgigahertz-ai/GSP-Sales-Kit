// SalesKit user accounts and login sessions. Accounts live in the server database (table __saleskit_users);
// passwords are stored as salted scrypt hashes, never as text.
const crypto = require('node:crypto');
const fs = require('node:fs');

const SESSION_IDLE_MS = 12 * 60 * 60 * 1000; // a session ends after 12 hours without use
const MAX_FAILURES = 5; // wrong passwords before a lock
const LOCK_MS = 15 * 60 * 1000;
const USERNAME = /^[a-z0-9._-]{3,32}$/;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

function passwordMatches(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored || '').split(':');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function checkPassword(password) {
  if (String(password || '').length < 8) throw new Error('Passwords need at least 8 characters.');
}

// database: needs loadUsers(), saveUser(user) and deleteUser(username).
// legacyFile: an older users.json to import once (renamed to users.json.imported afterwards).
function createUserStore(database, { legacyFile = '' } = {}) {
  let users = database.loadUsers();

  if (!Object.keys(users).length && legacyFile && fs.existsSync(legacyFile)) {
    try {
      const imported = JSON.parse(fs.readFileSync(legacyFile, 'utf8')) || {};
      Object.values(imported).forEach((user) => database.saveUser(user));
      fs.renameSync(legacyFile, `${legacyFile}.imported`);
      users = database.loadUsers();
    } catch {}
  }

  const sessions = new Map(); // session key -> { username, createdAt, lastUsed }
  const failures = new Map(); // "user:<name>" / "ip:<address>" -> { count, lockedUntil }

  function save(user) {
    database.saveUser(user);
  }

  // Reads the accounts again, e.g. after a database backup was restored.
  function reload() {
    users = database.loadUsers();
    for (const [key, session] of sessions) {
      if (!users[session.username] || users[session.username].disabled) sessions.delete(key);
    }
  }

  function publicUser(user) {
    const { passwordHash, ...rest } = user;
    const activeSessions = [...sessions.values()].filter((session) => session.username === user.username).length;
    return { ...rest, activeSessions };
  }

  function get(username) {
    const user = users[String(username || '').trim().toLowerCase()];
    if (!user) throw new Error('That user does not exist.');
    return user;
  }

  function list() {
    return Object.values(users).map(publicUser).sort((a, b) => a.username.localeCompare(b.username));
  }

  function create({ username, displayName, branch, password }) {
    const name = String(username || '').trim().toLowerCase();
    if (!USERNAME.test(name)) throw new Error('Usernames are 3–32 characters: letters, numbers, dot, dash or underscore.');
    if (users[name]) throw new Error('That username is already taken.');
    if (!String(branch || '').trim()) throw new Error('Choose the user\'s branch.');
    checkPassword(password);
    users[name] = {
      username: name,
      displayName: String(displayName || '').trim() || name,
      branch: String(branch).trim().toUpperCase(),
      passwordHash: hashPassword(password),
      disabled: false,
      createdAt: new Date().toISOString(),
      lastLogin: null
    };
    save(users[name]);
    return publicUser(users[name]);
  }

  function update(username, changes = {}) {
    const user = get(username);
    if (changes.displayName !== undefined) user.displayName = String(changes.displayName).trim() || user.username;
    if (changes.branch !== undefined) {
      if (!String(changes.branch).trim()) throw new Error('Choose the user\'s branch.');
      user.branch = String(changes.branch).trim().toUpperCase();
    }
    if (changes.disabled !== undefined) {
      user.disabled = Boolean(changes.disabled);
      if (user.disabled) signOut(user.username);
    }
    save(user);
    return publicUser(user);
  }

  function setPassword(username, password) {
    const user = get(username);
    checkPassword(password);
    user.passwordHash = hashPassword(password);
    save(user);
    signOut(user.username);
    return publicUser(user);
  }

  function remove(username) {
    const user = get(username);
    signOut(user.username);
    delete users[user.username];
    database.deleteUser(user.username);
  }

  // Ends every open session of a user; their SalesKit asks them to log in again.
  function signOut(username) {
    for (const [key, session] of sessions) {
      if (session.username === username) sessions.delete(key);
    }
  }

  function lockState(key) {
    const entry = failures.get(key);
    return entry && entry.lockedUntil > Date.now() ? entry : null;
  }

  function recordFailure(key) {
    const entry = failures.get(key) || { count: 0, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= MAX_FAILURES) {
      entry.lockedUntil = Date.now() + LOCK_MS;
      entry.count = 0;
    }
    failures.set(key, entry);
  }

  // Returns { sessionKey, user } or throws an Error with a message the login screen can show.
  function login(username, password, address) {
    const name = String(username || '').trim().toLowerCase();
    const userKey = `user:${name}`;
    const ipKey = `ip:${address}`;
    if (lockState(userKey) || lockState(ipKey)) {
      throw Object.assign(new Error('Too many wrong passwords. Try again in 15 minutes.'), { code: 'locked' });
    }
    const user = users[name];
    // Hash even for unknown users, so the answer takes the same time either way.
    const ok = user ? passwordMatches(password, user.passwordHash) : (passwordMatches(password, hashPassword('x')), false);
    if (!ok) {
      recordFailure(userKey);
      recordFailure(ipKey);
      throw Object.assign(new Error('Wrong username or password.'), { code: 'invalid' });
    }
    if (user.disabled) throw Object.assign(new Error('This account is disabled. Contact your administrator.'), { code: 'disabled' });

    failures.delete(userKey);
    failures.delete(ipKey);
    user.lastLogin = new Date().toISOString();
    save(user);
    const sessionKey = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    sessions.set(sessionKey, { username: user.username, createdAt: now, lastUsed: now });
    return { sessionKey, user: publicUser(user) };
  }

  // The signed-in user for a session key, or null.
  function userForSession(sessionKey) {
    const session = sessions.get(String(sessionKey || ''));
    if (!session) return null;
    const user = users[session.username];
    if (!user || user.disabled || Date.now() - session.lastUsed > SESSION_IDLE_MS) {
      sessions.delete(sessionKey);
      return null;
    }
    session.lastUsed = Date.now();
    return user;
  }

  function logout(sessionKey) {
    sessions.delete(String(sessionKey || ''));
  }

  return { list, create, update, setPassword, remove, signOut, login, logout, userForSession, reload };
}

module.exports = { createUserStore };
