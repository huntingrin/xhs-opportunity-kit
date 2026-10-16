#!/usr/bin/env node
/**
 * Regenerates the self-contained entry points shipped inside the agent skill.
 *
 * Why this exists: `skills/xhs-opportunity-kit/` is packaged and distributed as a
 * portable agent skill. A skill directory has no installation step and no
 * node_modules, so the CLI and the MCP server are bundled here with their
 * dependencies inlined. The outputs are committed on purpose — the skill package
 * must work from a plain copy of the repository.
 *
 * Requires Node >= 22.13 at run time (node:sqlite is a builtin and stays external).
 * Run `npm run bundle:skill` after changing src/ and commit both the source and the
 * regenerated scripts.
 */
import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = join(root, 'skills', 'xhs-opportunity-kit', 'scripts');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

// The bundled dependency graph contains CommonJS packages (the MCP SDK pulls in
// cross-spawn), so ESM output needs a real require() for their dynamic requires.
const banner = [
  '/*!',
  ' * Generated file — do not edit by hand.',
  ` * @huntingrin/xhs-opportunity-kit ${pkg.version}`,
  ' * Source and license: https://github.com/huntingrin/xhs-opportunity-kit',
  ' * Rebuild with: npm run bundle:skill',
  ' *',
  ' * Why it is committed: the agent skill ships without node_modules, so this entry',
  ' * point inlines its dependencies. It requires Node >= 22.13 and no install step.',
  ' */',
  "import { createRequire as __createRequire } from 'node:module';",
  'const require = __createRequire(import.meta.url);',
].join('\n');

const targets = [
  { entry: 'src/cli.ts', outfile: join(outdir, 'xhs-opportunity.mjs') },
  { entry: 'src/mcp-server.ts', outfile: join(outdir, 'xhs-opportunity-mcp.mjs') },
];

/** Package directory of an esbuild input path, or null when the file is first-party. */
function packageDirOf(input, base) {
  const marker = 'node_modules/';
  const index = input.lastIndexOf(marker);
  if (index === -1) return null;
  const rest = input.slice(index + marker.length).split('/');
  const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  return join(base, input.slice(0, index + marker.length), name);
}

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENSE-MIT'];

/** Collects every bundled dependency with its version, license and copyright line. */
async function collectThirdParty(inputs, base) {
  const found = new Map();
  for (const input of Object.keys(inputs)) {
    const dir = packageDirOf(input, base);
    if (!dir || found.has(dir)) continue;
    found.set(dir, null);
    try {
      const meta = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      const files = await readdir(dir);
      const licenseFile = LICENSE_FILES.find(candidate => files.includes(candidate));
      let holder = '', licenseText = '';
      if (licenseFile) {
        licenseText = (await readFile(join(dir, licenseFile), 'utf8')).trim();
        holder = (licenseText.split('\n').find(line => /copyright/i.test(line)) || '').trim();
      }
      found.set(dir, { name: meta.name, version: meta.version, license: meta.license || '', holder, licenseText });
    } catch { /* not a readable package; the bundle still lists nothing for it */ }
  }
  return [...found.values()].filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

await mkdir(outdir, { recursive: true });
let bundledInputs = {};
for (const { entry, outfile } of targets) {
  const result = await build({
    entryPoints: [join(root, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    banner: { js: banner },
    legalComments: 'eof',
    logLevel: 'warning',
    metafile: true,
  });
  const bytes = Object.values(result.metafile.outputs)[0].bytes;
  bundledInputs = { ...bundledInputs, ...result.metafile.inputs };
  console.log(`bundled ${entry} -> ${outfile.replace(`${root}/`, '')} (${(bytes / 1024).toFixed(1)} kB)`);
}

// The bundles inline third-party code, so the skill package needs the notices.
const thirdParty = await collectThirdParty(bundledInputs, root);
// One section per distinct license, with the copyright line left to the table above.
const licenseTexts = new Map();
for (const pkgEntry of thirdParty) {
  const key = pkgEntry.license || 'unlisted';
  if (licenseTexts.has(key) || !pkgEntry.licenseText) continue;
  const text = pkgEntry.licenseText.split('\n')
    .map(line => (/copyright/i.test(line) ? '<copyright holder — see the table above>' : line))
    .join('\n').trim();
  licenseTexts.set(key, text);
}
const notices = [
  '# Bundled third-party notices',
  '',
  '`scripts/xhs-opportunity.mjs` and `scripts/xhs-opportunity-mcp.mjs` are generated bundles in',
  'which the packages below are inlined. Generated by `npm run bundle:skill` — do not edit by hand.',
  'Each package keeps its own copyright line in the table; the license terms are reproduced below,',
  'once per distinct license.',
  '',
  '| Package | Version | License | Copyright |',
  '| --- | --- | --- | --- |',
  ...thirdParty.map(p => `| ${p.name} | ${p.version} | ${p.license || 'see package'} | ${p.holder || '—'} |`),
  '',
  ...[...licenseTexts.entries()].flatMap(([license, text]) => [`## ${license}`, '', '```text', text, '```', '']),
].join('\n');
await writeFile(join(root, 'skills', 'xhs-opportunity-kit', 'THIRD-PARTY.md'), notices, 'utf8');
console.log(`wrote skills/xhs-opportunity-kit/THIRD-PARTY.md (${thirdParty.length} packages)`);

// esbuild carries the source shebang over; assert it so the scripts stay runnable.
for (const { outfile } of targets) {
  const text = await readFile(outfile, 'utf8');
  if (!text.startsWith('#!/usr/bin/env node\n')) throw new Error(`missing shebang in ${outfile}`);
  await writeFile(outfile, text, { encoding: 'utf8', mode: 0o755 });
}
