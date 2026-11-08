import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const sharedAssetsBase = 'https://nigel-slint-preview-assets.nigel-breslaw.workers.dev';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const fontFile = file => /\.(ttf|otf|ttc|woff2?)$/i.test(file);
export const runtimeFiles = ['slint_wasm_interpreter.js', 'slint_wasm_interpreter_bg.wasm', 'provenance.json'];
export const runtimeDigest = bytes => sha256(JSON.stringify(runtimeFiles.map(file => [file, sha256(bytes[file])])));
export const catalogText = files => JSON.stringify({ schemaVersion: 1, files: [...files].sort((a, b) => a.path.localeCompare(b.path)) }, null, 2) + '\n';

export function validateCatalog(catalog) {
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.files) || catalog.files.length > 1000) throw new Error('Invalid shared asset catalog');
  const seen = new Set();
  for (const file of catalog.files) {
    if (!/^(runtime\/[a-f0-9]{64}\/(slint_wasm_interpreter\.js|slint_wasm_interpreter_bg\.wasm|provenance\.json)|fonts\/[a-f0-9]{64}\.(ttf|otf|ttc|woff2?)|licenses\/[a-f0-9]{64}\.txt)$/.test(file.path) ||
        !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 25 * 1024 * 1024 || seen.has(file.path)) {
      throw new Error(`Invalid shared asset: ${file.path}`);
    }
    if (!file.path.startsWith('runtime/') && path.basename(file.path).split('.')[0] !== file.sha256) throw new Error(`Asset path is not content-addressed: ${file.path}`);
    seen.add(file.path);
  }
  return catalog.files;
}

export function mergeCatalogs(existing, incoming) {
  const files = new Map(validateCatalog(existing).map(file => [file.path, file]));
  for (const file of validateCatalog(incoming)) {
    const old = files.get(file.path);
    if (old && (old.sha256 !== file.sha256 || old.size !== file.size)) throw new Error(`Cannot overwrite immutable asset: ${file.path}`);
    files.set(file.path, file);
  }
  if (files.size > 1000) throw new Error('Shared asset retention limit reached');
  return [...files.values()];
}

export const sharedHeaders = `/*
  Access-Control-Allow-Origin: *
  Timing-Allow-Origin: *
  Cross-Origin-Resource-Policy: cross-origin
/runtime/*
  Cache-Control: public, max-age=31536000, immutable
/fonts/*
  Cache-Control: public, max-age=31536000, immutable
/licenses/*
  Cache-Control: public, max-age=31536000, immutable
/catalog.json
  Cache-Control: no-store
`;

export async function prepareSharedAssets({ incomingDirectory, outputDirectory, base = sharedAssetsBase, bootstrap = false, fetcher = fetch }) {
  const readIncoming = async file => {
    let target = incomingDirectory;
    for (const part of file.split('/')) {
      target = path.join(target, part);
      if ((await lstat(target)).isSymbolicLink()) throw new Error(`Unexpected shared asset symlink: ${file}`);
    }
    if (!(await lstat(target)).isFile()) throw new Error(`Unexpected shared asset file: ${file}`);
    return readFile(target);
  };
  const incoming = JSON.parse(await readIncoming('catalog.json'));
  let existing = { schemaVersion: 1, files: [] };
  if (!bootstrap) {
    const response = await fetcher(`${base}/catalog.json`, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Cannot read retained asset catalog: HTTP ${response.status}`);
    existing = await response.json();
  }
  const files = mergeCatalogs(existing, incoming);
  const incomingPaths = new Set(incoming.files.map(file => file.path));
  const bytesByPath = new Map();
  for (const file of files) {
    let bytes;
    if (incomingPaths.has(file.path)) bytes = await readIncoming(file.path);
    else {
      const response = await fetcher(`${base}/${file.path}`, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Cannot retain ${file.path}: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (bytes.byteLength !== file.size || sha256(bytes) !== file.sha256) throw new Error(`Shared asset checksum mismatch: ${file.path}`);
    bytesByPath.set(file.path, bytes);
  }
  const groups = new Set(files.filter(file => file.path.startsWith('runtime/')).map(file => file.path.split('/')[1]));
  for (const digest of groups) {
    const bytes = Object.fromEntries(runtimeFiles.map(file => [file, bytesByPath.get(`runtime/${digest}/${file}`)]));
    if (runtimeFiles.some(file => !bytes[file]) || runtimeDigest(bytes) !== digest) throw new Error(`Invalid shared runtime bundle: ${digest}`);
  }
  await rm(outputDirectory, { recursive: true, force: true });
  for (const [file, bytes] of bytesByPath) {
    await mkdir(path.dirname(path.join(outputDirectory, file)), { recursive: true });
    await writeFile(path.join(outputDirectory, file), bytes);
  }
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, 'catalog.json'), catalogText(files));
  await writeFile(path.join(outputDirectory, '_headers'), sharedHeaders);
  await writeFile(path.join(outputDirectory, 'index.html'), '<!doctype html><title>Shared Slint preview assets</title><h1>Shared Slint preview assets</h1><p>Content-addressed runtime and fonts for Nigel’s PR previews.</p><p><a href="./catalog.json">Asset catalog and bundled license files</a></p>');
  return files;
}
