import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('shared deployment omits binary copies and preloads the exact public asset URLs', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'slint-package-test-'));
  try {
    const config = path.join(temporary, 'config.json');
    await writeFile(config, JSON.stringify({ examples: [{ id: 'image-alignment', entry: 'examples/image-alignment.slint' }] }));
    execFileSync(process.execPath, ['scripts/build.mjs', '--manifest', config, '--shared-assets-base', 'https://assets.example']);
    const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
    const html = await readFile('dist/index.html', 'utf8');
    const preloadUrls = [...html.matchAll(/<link rel="(?:modulepreload|preload)" href="([^"]+)"/g)].map(match => match[1]);
    const font = manifest.revisions.after.assets[manifest.examples[0].font];
    for (const url of [manifest.runtimeWasm, manifest.runtimeModule, font]) {
      assert.equal(new URL(url).origin, 'https://assets.example');
      assert.ok(preloadUrls.includes(url), `Missing exact preload URL: ${url}`);
    }
    assert.ok(preloadUrls.every(url => !url.startsWith('./https:')));
    assert.deepEqual((await readdir('dist', { recursive: true })).filter(file => /\.(wasm|ttf|otf|ttc)$/.test(file)), []);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
