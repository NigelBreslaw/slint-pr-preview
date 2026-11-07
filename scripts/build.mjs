import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const git = (...args) => execFileSync('git', args, { maxBuffer: 24 * 1024 * 1024 });
const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, args) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), args[index + 1]]);
  return pairs;
}, []));
const commit = (ref) => git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).toString().trim();
const head = commit(options.head || 'HEAD');
const base = commit(options.base || head);
const readAt = (sha, file) => git('show', `${sha}:${file}`);
const manifestAt = (sha) => JSON.parse(readAt(sha, 'preview.json'));
const afterManifest = manifestAt(head);
const beforeManifest = manifestAt(base);

if (afterManifest.schemaVersion !== 1 || beforeManifest.schemaVersion !== 1) throw new Error('Unsupported preview manifest');
if (afterManifest.runtime !== beforeManifest.runtime) throw new Error('This prototype requires the same interpreter version on both sides');

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('web', 'dist', { recursive: true });
const revisions = {};
for (const [name, sha] of [['before', base], ['after', head]]) {
  const root = `versions/${name}/`;
  const files = git('ls-tree', '-r', '--name-only', sha, '--', 'examples', 'vendor').toString().trim().split('\n').filter(Boolean);
  for (const file of files) {
    if (file.split('/').includes('..') || path.isAbsolute(file)) throw new Error(`Invalid path: ${file}`);
    const target = path.join('dist', root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, readAt(sha, file));
  }
  revisions[name] = { sha, root };
}

const runtimeFiles = ['slint_wasm_interpreter.js', 'slint_wasm_interpreter_bg.wasm', 'provenance.json'];
await mkdir('dist/runtime', { recursive: true });
const provenance = JSON.parse(readAt(head, 'runtime/provenance.json'));
for (const file of runtimeFiles) {
  const bytes = readAt(head, `runtime/${file}`);
  if (file !== 'provenance.json' && createHash('sha256').update(bytes).digest('hex') !== provenance.sha256[file]) {
    throw new Error(`Runtime checksum mismatch: ${file}`);
  }
  await writeFile(`dist/runtime/${file}`, bytes);
}

const examples = afterManifest.examples.map((example) => {
  if (!/^[a-z0-9-]+$/.test(example.id) || !['compare', 'new'].includes(example.mode)) throw new Error('Invalid example');
  for (const key of ['entry', 'font']) {
    if (!example[key] || path.isAbsolute(example[key]) || example[key].split('/').includes('..')) throw new Error(`Invalid ${key}`);
  }
  const before = beforeManifest.examples.find((candidate) => candidate.id === example.id);
  if (example.mode === 'compare' && !before) throw new Error(`No baseline for ${example.id}; set mode to new`);
  if (before && (before.width !== example.width || before.height !== example.height)) throw new Error('Comparison viewports must match');
  return { ...example, before: before || null };
});
await writeFile('dist/manifest.json', JSON.stringify({
  schemaVersion: 1,
  repository: process.env.GITHUB_REPOSITORY || 'NigelBreslaw/slint-pr-preview',
  pullRequest: process.env.PR_NUMBER || null,
  runtime: afterManifest.runtime,
  revisions,
  examples,
}, null, 2) + '\n');
await cp('LICENSE', 'dist/LICENSE');
console.log(`Packaged ${examples.length} example(s): ${base.slice(0, 7)} → ${head.slice(0, 7)}`);
