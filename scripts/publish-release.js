// Uploads the built SalesKit installer to GitHub one file at a time.
// (electron-builder's own upload runs in parallel and can create two releases for the same version.)
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');

const { owner, repo } = pkg.build.publish;
const { version } = pkg;
const tag = `v${version}`;
const dist = path.join(__dirname, '..', pkg.build.directories.output);
const api = `https://api.github.com/repos/${owner}/${repo}`;
const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${process.env.GH_TOKEN}`,
  'X-GitHub-Api-Version': '2022-11-28'
};

// Local file → name on GitHub (electron-builder writes the hyphenated name into latest.yml / server.yml).
// SalesKit only; the server has its own release (publish-server.js). --with-server also puts the server in this
// release, once: servers from 1.0.20 and older still look for their update here (npm run release:handover).
const serverBuild = require('../server-builder.json');
const serverDist = path.join(__dirname, '..', serverBuild.directories.output);
const withServer = process.argv.includes('--with-server');
// (The server installer is already built with hyphens: server-builder.json → nsis.artifactName.)
const installerFiles = (folder, productName, fileVersion, updateFile) => {
  const installer = folder === serverDist
    ? serverBuild.nsis.artifactName.replace('${version}', fileVersion).replace('${ext}', 'exe')
    : `${productName} Setup ${fileVersion}.exe`;
  return [
    [folder, installer, installer.replace(/ /g, '-'), fileVersion],
    [folder, `${installer}.blockmap`, `${installer}.blockmap`.replace(/ /g, '-'), fileVersion],
    [folder, updateFile, updateFile, fileVersion]
  ];
};
const files = [
  ...installerFiles(dist, pkg.build.productName, version, 'latest.yml'),
  ...(withServer
    ? installerFiles(serverDist, serverBuild.productName, serverBuild.extraMetadata.version, `${serverBuild.publish.channel}.yml`)
    : [])
];

function fail(message) {
  console.error(`\nPublish stopped: ${message}\n`);
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
  for (const [folder, local] of files) {
    if (!fs.existsSync(path.join(folder, local))) fail(`${local} was not built. Run the build first.`);
  }
  for (const [folder, local, , fileVersion] of files.filter(([, name]) => name.endsWith('.yml'))) {
    const updateInfo = fs.readFileSync(path.join(folder, local), 'utf8');
    if (!updateInfo.startsWith(`version: ${fileVersion}\n`) && !updateInfo.startsWith(`version: ${fileVersion}\r\n`)) {
      fail(`${path.basename(folder)}/${local} is not for version ${fileVersion}. The build did not finish; run it again.`);
    }
  }

  // One published release per version: reuse it, or create it once.
  let release = await github(`${api}/releases/tags/${tag}`);
  if (release.status === 404) {
    release = await github(`${api}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_name: tag, name: version, draft: false, prerelease: false })
    });
    if (!release.ok) fail(`could not create release ${tag} (${release.body.message || release.status}). Was the tag pushed with "git push origin main ${tag}"?`);
    console.log(`Created release ${tag}`);
  } else if (!release.ok) {
    fail(`could not read release ${tag} (${release.body.message || release.status}).`);
  } else {
    console.log(`Using existing release ${tag}`);
  }

  const existing = new Map((release.body.assets || []).map((asset) => [asset.name, asset]));
  for (const [folder, local, remote] of files) {
    const data = fs.readFileSync(path.join(folder, local));
    const current = existing.get(remote);
    if (current && current.state === 'uploaded' && current.size === data.length) {
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
})().catch((error) => fail(error.message));
