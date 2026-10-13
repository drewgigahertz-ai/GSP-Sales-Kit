// Runs after `npm run release`: SalesKit laptops only update when the GitHub release for this version
// is a single release containing the installer, its blockmap and latest.yml.
const { version } = require('../package.json');
const { owner, repo } = require('../package.json').build.publish;

const tag = `v${version}`;
const installer = `GigaHertz-SalesKit-Setup-${version}.exe`;
const required = [installer, `${installer}.blockmap`, 'latest.yml'];

(async () => {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=30`, {
    headers: { Accept: 'application/vnd.github+json', ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) }
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  const releases = (await response.json()).filter((release) => release.tag_name === tag && !release.draft);

  const problems = [];
  if (releases.length === 0) problems.push(`There is no published release ${tag}.`);
  if (releases.length > 1) problems.push(`There are ${releases.length} published releases named ${tag}. Turn the extra ones into drafts on GitHub.`);
  const assets = releases.flatMap((release) => release.assets.filter((asset) => asset.state === 'uploaded').map((asset) => asset.name));
  required.filter((name) => !assets.includes(name)).forEach((name) => problems.push(`Missing file: ${name}`));

  if (problems.length) {
    console.error(`\nRelease ${tag} is NOT ready — laptops will not update:\n  - ${problems.join('\n  - ')}\n`);
    process.exit(1);
  }
  console.log(`\nRelease ${tag} verified: ${required.join(', ')}. Laptops will pick it up at their next update check.\n`);
})().catch((error) => {
  console.error(`\nCould not verify release ${tag}: ${error.message}\n`);
  process.exit(1);
});
