// Uploads the built SalesKit Server to its own GitHub release, "server-updates" (a pre-release, so SalesKit
// laptops never take it for their update). The installed server checks server.yml there (server/updater.js) and
// updates itself; SalesKit laptops are not touched. Each upload replaces the previous server files.
// The server's version is server-builder.json → extraMetadata.version; raise it before each server release.
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');
const serverBuild = require('../server-builder.json');

const { owner, repo } = pkg.build.publish;
const version = serverBuild.extraMetadata.version;
const tag = 'server-updates';
const dist = path.join(__dirname, '..', serverBuild.directories.output);
const api = `https://api.github.com/repos/${owner}/${repo}`;
const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${process.env.GH_TOKEN}`,
  'X-GitHub-Api-Version': '2022-11-28'
};

// The installer is built with hyphens (server-builder.json → nsis.artifactName), the name server.yml gives:
// GitHub would change spaces in an uploaded file name.
const installer = serverBuild.nsis.artifactName.replace('${version}', version).replace('${ext}', 'exe');
const updateFile = `${serverBuild.publish.channel}.yml`;
// Local file → name on GitHub (the same).
const files = [
  [installer, installer],
  [`${installer}.blockmap`, `${installer}.blockmap`],
  [updateFile, updateFile]
];

function fail(message) {
  console.error(`\nServer publish stopped: ${message}\n`);
  process.exit(1);
}

// Retries brief network drops ("fetch failed"); GitHub's own error answers are returned as-is.
async function github(url, options = {}, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
      const body = await response.json().catch(() => ({}));
      return { status: response.status, ok: response.ok, body };
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
    }
  }
}

(async () => {
  if (!process.env.GH_TOKEN) fail('GH_TOKEN is not set.');
  for (const [local] of files) {
    if (!fs.existsSync(path.join(dist, local))) fail(`${local} was not built. Run "npm run dist:server" first.`);
  }
  const updateInfo = fs.readFileSync(path.join(dist, updateFile), 'utf8');
  if (!/^version: (\S+)\r?$/m.test(updateInfo) || updateInfo.match(/^version: (\S+)\r?$/m)[1] !== version) {
    fail(`${serverBuild.directories.output}/${updateFile} is not for version ${version}. The build did not finish; run it again.`);
  }

  // The one "server-updates" release: reuse it, or create it once (as a pre-release).
  let release = await github(`${api}/releases/tags/${tag}`);
  if (release.status === 404) {
    release = await github(`${api}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        name: 'SalesKit Server updates',
        body: 'SalesKit Server downloads its updates from here. SalesKit laptops do not use this release.',
        draft: false,
        prerelease: true
      })
    });
    if (!release.ok) fail(`could not create the ${tag} release (${release.body.message || release.status}).`);
    console.log(`Created release ${tag}`);
  } else if (!release.ok) {
    fail(`could not read the ${tag} release (${release.body.message || release.status}).`);
  }

  // Older server versions are removed; files of this version already uploaded whole are kept.
  const wanted = new Set(files.map(([, remote]) => remote));
  const existing = new Map((release.body.assets || []).map((asset) => [asset.name, asset]));
  for (const asset of release.body.assets || []) {
    if (!wanted.has(asset.name)) {
      await github(`${api}/releases/assets/${asset.id}`, { method: 'DELETE' });
      console.log(`  − ${asset.name} (older version)`);
    }
  }
  // server.yml last, so a server never sees the new version before its installer is there.
  for (const [local, remote] of files) {
    const data = fs.readFileSync(path.join(dist, local));
    const current = existing.get(remote);
    if (current && current.state === 'uploaded' && current.size === data.length && remote !== updateFile) {
      console.log(`  ✓ ${remote} already uploaded`);
      continue;
    }
    if (current) await github(`${api}/releases/assets/${current.id}`, { method: 'DELETE' });
    const upload = await github(
      `https://uploads.github.com/repos/${owner}/${repo}/releases/${release.body.id}/assets?name=${encodeURIComponent(remote)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: data }
    );
    if (!upload.ok) fail(`uploading ${remote} failed (${upload.body.message || upload.status}).`);
    console.log(`  ↑ ${remote} (${(data.length / 1048576).toFixed(1)} MB)`);
  }
  console.log(`\nSalesKit Server ${version} published. Servers pick it up at their next hourly check (or Updates → Check now).\n`);
})().catch((error) => fail(error.message));
