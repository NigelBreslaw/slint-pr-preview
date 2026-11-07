import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeConfig, configHash } from './preview-config.mjs';

const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, args) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), args[index + 1]]);
  return pairs;
}, []));
const git = (...args) => execFileSync('git', args, { cwd: options['source-dir'] || '.', maxBuffer: 24 * 1024 * 1024 });
const commit = (ref) => git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).toString().trim();
const head = commit(options.head || 'HEAD');
const base = commit(options.base || head);
const readAt = (sha, file) => git('show', `${sha}:${file}`);
if (!options.manifest && !options.request) throw new Error('Pass --manifest <local-json> or --request <CI-request-json>');
const request = options.request ? JSON.parse(await readFile(options.request, 'utf8')) : null;
const config = normalizeConfig(request?.configuration.config ?? JSON.parse(await readFile(options.manifest, 'utf8')));
if (request && (request.headSha !== head || request.configuration.hash !== configHash(config))) throw new Error('Request does not match the build');

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await mkdir('dist/assets', { recursive: true });
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 20);
async function asset(name, extension, bytes) {
  const file = `assets/${name}-${digest(bytes)}${extension}`;
  await writeFile(`dist/${file}`, bytes);
  return file;
}
const revisions = {};
const sourceFiles = {};
for (const [name, sha] of [['before', base], ['after', head]]) {
  const root = `versions/${name}/`;
  const files = git('ls-tree', '-r', '--name-only', sha, '--', 'examples', 'vendor').toString().trim().split('\n').filter(Boolean);
  const sources = {};
  const assets = {};
  for (const file of files) {
    if (file.split('/').includes('..') || path.isAbsolute(file)) throw new Error(`Invalid path: ${file}`);
    const target = path.join('dist', root, file);
    await mkdir(path.dirname(target), { recursive: true });
    const bytes = readAt(sha, file);
    await writeFile(target, bytes);
    if (file.endsWith('.slint')) sources[file] = bytes.toString();
    else assets[file] = await asset('file', path.extname(file), bytes);
  }
  sourceFiles[name] = sources;
  const sourceBundle = await asset('sources', '.json', JSON.stringify(sources));
  revisions[name] = { sha, root, sourceBundle, assets };
}

const runtimeFiles = ['slint_wasm_interpreter.js', 'slint_wasm_interpreter_bg.wasm', 'provenance.json'];
const runtimeBytes = Object.fromEntries(await Promise.all(runtimeFiles.map(async file => [file, await readFile(`runtime/${file}`)])));
const provenance = JSON.parse(runtimeBytes['provenance.json']);
const runtimeRoot = `assets/runtime-${digest(Buffer.concat(Object.values(runtimeBytes)))}/`;
await mkdir(`dist/${runtimeRoot}`, { recursive: true });
for (const file of runtimeFiles) {
  const bytes = runtimeBytes[file];
  if (file !== 'provenance.json' && createHash('sha256').update(bytes).digest('hex') !== provenance.sha256[file]) {
    throw new Error(`Runtime checksum mismatch: ${file}`);
  }
  await writeFile(`dist/${runtimeRoot}${file}`, bytes);
}

const examples = config.examples.map((example) => {
  const before = example.mode === 'compare' ? { ...example, ...(example.before || {}), before: null } : null;
  for (const [side, definition] of [['after', example], ...(before ? [['before', before]] : [])]) {
    if (!(definition.entry in sourceFiles[side])) throw new Error(`Missing ${side} entry: ${definition.entry}; use mode new for new components`);
    if (!(definition.font in revisions[side].assets)) throw new Error(`Missing ${side} font: ${definition.font}`);
  }
  return { ...example, before };
});
const manifest = {
  schemaVersion: 1,
  ...(request || {
    repository: 'NigelBreslaw/slint-pr-preview', pullRequest: null, headSha: head, baseSha: base,
    configuration: { commentId: null, url: null, updatedAt: null, hash: configHash(config), config },
  }),
  runtime: provenance.version,
  runtimeModule: `${runtimeRoot}slint_wasm_interpreter.js`,
  runtimeWasm: `${runtimeRoot}slint_wasm_interpreter_bg.wasm`,
  runtimeProvenance: `${runtimeRoot}provenance.json`,
  revisions,
  examples,
};
const scriptData = value => JSON.stringify(value).replace(/</g, '\\u003c');
const playerScript = await asset('player', '.js', await readFile('web/player.js'));
const appScript = await asset('app', '.js', await readFile('web/app.js'));
const stylesheet = await asset('style', '.css', await readFile('web/style.css'));
const playerHtml = (await readFile('web/player.html', 'utf8'))
  .replace('./player.js', `./${playerScript}`)
  .replace('<!--PREVIEW_MANIFEST-->', `<script id="preview-manifest" type="application/json">${scriptData(manifest)}</script>`);
await writeFile('dist/player.html', playerHtml);
const preload = new Set([
  manifest.runtimeWasm,
  ...Object.values(revisions).map(revision => revision.sourceBundle),
  ...examples.flatMap(example => [revisions.after.assets[example.font], ...(example.before ? [revisions.before.assets[example.before.font]] : [])]),
]);
const preloads = `<link rel="modulepreload" href="./${manifest.runtimeModule}">\n` +
  [...preload].map(file => `<link rel="preload" href="./${file}" as="fetch" crossorigin>`).join('\n');
const indexHtml = (await readFile('web/index.html', 'utf8'))
  .replace('./app.js', `./${appScript}`)
  .replace('./style.css', `./${stylesheet}`)
  .replace('<!--PREVIEW_PRELOADS-->', preloads)
  .replace('<!--PREVIEW_MANIFEST-->', `<script id="preview-manifest" type="application/json">${scriptData({ ...manifest, playerHtml })}</script>`);
await writeFile('dist/index.html', indexHtml);
await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
await cp('LICENSE', 'dist/LICENSE');
console.log(`Packaged ${examples.length} example(s): ${base.slice(0, 7)} → ${head.slice(0, 7)}`);
