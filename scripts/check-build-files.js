// Before a release: every local file the app or the server loads with require() must be packed by its build
// (package.json build.files for the app, server-builder.json files for the server). A file missing there makes
// the installed program stop at start with "Cannot find module". Run by npm run release and release:server.
const fs = require('fs'); const path = require('path');
const root = path.resolve(__dirname, '..');
function walk(entry) {
  const seen = new Set(); const todo = [entry];
  while (todo.length) {
    const f = todo.pop(); if (seen.has(f)) continue; seen.add(f);
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
      let t = path.resolve(path.dirname(f), m[1]);
      for (const c of [t, t + '.js', t + '.json', path.join(t, 'index.js')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) { t = c; break; }
      if (t.endsWith('.js')) todo.push(t); else seen.add(t);
    }
  }
  return [...seen].map((f) => path.relative(root, f).split(path.sep).join('/'));
}
const server = JSON.parse(fs.readFileSync(path.join(root, 'server-builder.json'), 'utf8')).files;
const inServer = (f) => server.includes(f) || (f.startsWith('server/') && server.includes('server/**/*'));
const missServer = walk(path.join(root, 'server/main.js')).filter((f) => !inServer(f));
const app = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build.files;
const excluded = new Set(app.filter((x) => x.startsWith('!')).map((x) => x.slice(1)));
const missApp = walk(path.join(root, 'electron/main.js')).filter((f) => excluded.has(f));
console.log('server build missing:', missServer.length ? missServer : 'none');
console.log('app build missing:', missApp.length ? missApp : 'none');
process.exit(missServer.length || missApp.length ? 1 : 0);
