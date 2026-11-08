import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { catalogText, mergeCatalogs, prepareSharedAssets, runtimeDigest, runtimeFiles, sha256, sharedHeaders, validateCatalog } from './shared-assets.mjs';

const catalog = files => ({ schemaVersion: 1, files });
const font = text => {
  const bytes = Buffer.from(text), hash = sha256(bytes);
  return { bytes, file: { path: `fonts/${hash}.ttf`, sha256: hash, size: bytes.length } };
};

test('retains old content-addressed files when a font changes', () => {
  const old = font('old font'), next = font('new font');
  assert.deepEqual(mergeCatalogs(catalog([old.file]), catalog([next.file])), [old.file, next.file]);
  assert.deepEqual(mergeCatalogs(catalog([old.file]), catalog([old.file])), [old.file]);
});

test('rejects overwritten paths, traversal, fake hashes, and duplicate catalog entries', () => {
  const old = { path: `runtime/${'a'.repeat(64)}/provenance.json`, sha256: 'b'.repeat(64), size: 10 };
  assert.throws(() => mergeCatalogs(catalog([old]), catalog([{ ...old, sha256: 'c'.repeat(64) }])), /overwrite immutable/);
  for (const file of [{ ...font('font').file, path: '../secret' }, { ...font('font').file, sha256: 'a'.repeat(64) }]) {
    assert.throws(() => validateCatalog(catalog([file])));
  }
  assert.throws(() => validateCatalog(catalog([old, old])));
});

test('prepares a complete append-only site and verifies retained downloads', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'slint-assets-test-'));
  try {
    const old = font('old font'), next = font('new font');
    const incoming = path.join(root, 'incoming'), output = path.join(root, 'out');
    await mkdir(path.join(incoming, 'fonts'), { recursive: true });
    await writeFile(path.join(incoming, next.file.path), next.bytes);
    await writeFile(path.join(incoming, 'catalog.json'), catalogText([next.file]));
    const requests = [];
    const fetcher = async url => {
      requests.push(url);
      return new Response(url.endsWith('/catalog.json') ? JSON.stringify(catalog([old.file])) : old.bytes);
    };
    await prepareSharedAssets({ incomingDirectory: incoming, outputDirectory: output, base: 'https://assets.example', fetcher });
    assert.deepEqual(await readFile(path.join(output, old.file.path)), old.bytes);
    assert.deepEqual(await readFile(path.join(output, next.file.path)), next.bytes);
    assert.equal(JSON.parse(await readFile(path.join(output, 'catalog.json'))).files.length, 2);
    assert.deepEqual(requests, ['https://assets.example/catalog.json', `https://assets.example/${old.file.path}`]);
    assert.equal(await readFile(path.join(output, '_headers'), 'utf8'), sharedHeaders);
    await assert.rejects(prepareSharedAssets({ incomingDirectory: incoming, outputDirectory: output, base: 'https://assets.example', fetcher: async url => new Response(url.endsWith('/catalog.json') ? JSON.stringify(catalog([old.file])) : 'corrupt') }), /checksum mismatch/);
    assert.deepEqual(await readFile(path.join(output, old.file.path)), old.bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects an incomplete runtime bundle before publishing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'slint-runtime-test-'));
  try {
    const bytes = Object.fromEntries(runtimeFiles.map(file => [file, Buffer.from(file)]));
    const digest = runtimeDigest(bytes), file = `runtime/${digest}/${runtimeFiles[0]}`;
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), bytes[runtimeFiles[0]]);
    await writeFile(path.join(root, 'catalog.json'), catalogText([{ path: file, size: bytes[runtimeFiles[0]].length, sha256: sha256(bytes[runtimeFiles[0]]) }]));
    await assert.rejects(prepareSharedAssets({ incomingDirectory: root, outputDirectory: path.join(root, 'out'), bootstrap: true }), /Invalid shared runtime bundle/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
