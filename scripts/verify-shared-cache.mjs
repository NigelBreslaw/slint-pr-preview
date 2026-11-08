import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const [firstUrl, secondUrl, outputDirectory = 'cache-evidence'] = process.argv.slice(2);
if (!firstUrl || !secondUrl || new URL(firstUrl).origin === new URL(secondUrl).origin) throw new Error('Pass two preview URLs with different origins and an optional evidence directory');
const manifests = await Promise.all([firstUrl, secondUrl].map(async url => {
  const response = await fetch(new URL('manifest.json', url));
  assert.equal(response.status, 200);
  return response.json();
}));
const fontUrl = manifest => manifest.revisions.after.assets[manifest.examples[0].font];
assert.ok(manifests[0].sharedAssetsBase);
assert.equal(manifests[0].runtimeWasm, manifests[1].runtimeWasm);
assert.equal(fontUrl(manifests[0]), fontUrl(manifests[1]));
const assets = { wasm: manifests[0].runtimeWasm, font: fontUrl(manifests[0]) };
for (const url of Object.values(assets)) assert.equal(new URL(url).origin, manifests[0].sharedAssetsBase);
await mkdir(outputDirectory, { recursive: true });
const profile = await mkdtemp(path.join(os.tmpdir(), 'slint-shared-cache-'));
let context;
const results = [];
async function openPreview(url, label, manifest) {
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  const requests = new Map(), servedFromCache = new Set(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await client.send('Network.enable');
  await client.send('Network.setCacheDisabled', { cacheDisabled: false });
  client.on('Network.requestWillBeSent', event => requests.set(event.requestId, { url: event.request.url }));
  client.on('Network.requestServedFromCache', event => servedFromCache.add(event.requestId));
  client.on('Network.responseReceived', ({ requestId, response }) => {
    const request = requests.get(requestId);
    if (request) Object.assign(request, { fromDiskCache: response.fromDiskCache, fromServiceWorker: response.fromServiceWorker, status: response.status, headers: response.headers });
  });
  client.on('Network.loadingFinished', event => {
    const request = requests.get(event.requestId);
    if (request) request.encodedBytes = event.encodedDataLength;
  });
  await page.goto(url);
  for (const side of manifest.examples[0].mode === 'compare' ? ['before', 'after'] : ['after']) {
    await page.frameLocator(`iframe[data-side="${side}"]`).locator('body[data-state="ready"]').waitFor({ timeout: 45000 });
  }
  await page.screenshot({ path: path.join(outputDirectory, `${label}.png`), fullPage: true });
  const timings = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => ({
    url: entry.name, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize,
  })));
  const measured = {};
  for (const [name, assetUrl] of Object.entries(assets)) {
    const entries = timings.filter(entry => entry.url === assetUrl);
    const network = [...requests].filter(([, request]) => request.url === assetUrl).map(([id, request]) => ({ ...request, servedFromCache: servedFromCache.has(id) }));
    assert.ok(entries.length && entries.some(entry => entry.decodedBodySize > 0), `${label}: missing detailed timing for ${name}`);
    assert.ok(network.length, `${label}: missing CDP evidence for ${name}`);
    measured[name] = { url: assetUrl, transferBytes: entries.reduce((sum, entry) => sum + entry.transferSize, 0), decodedBytes: Math.max(...entries.map(entry => entry.decodedBodySize)), requests: network };
  }
  assert.deepEqual(errors, []);
  results.push({ label, previewUrl: url, assets: measured });
  await page.close();
}
try {
  context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1100, height: 820 } });
  await openPreview(firstUrl, 'first-preview-cold', manifests[0]);
  await openPreview(secondUrl, 'different-preview-warm', manifests[1]);
  await context.close();
  context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1100, height: 820 } });
  await openPreview(secondUrl, 'different-preview-after-browser-restart', manifests[1]);
  for (const name of Object.keys(assets)) {
    assert.ok(results[0].assets[name].transferBytes > 0, `Cold ${name} was not transferred`);
    for (const result of results.slice(1)) {
      assert.equal(result.assets[name].transferBytes, 0, `${result.label}: ${name} transferred again`);
      assert.ok(result.assets[name].requests.every(request => request.fromDiskCache || request.servedFromCache), `${result.label}: no browser cache hit for ${name}`);
      assert.ok(result.assets[name].requests.every(request => !request.fromServiceWorker), 'A service worker supplied the asset');
    }
  }
  await writeFile(path.join(outputDirectory, 'verification.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), browserVersion: context.browser()?.version(), manifests, results }, null, 2) + '\n');
  console.log(JSON.stringify(results.map(result => ({ label: result.label, previewUrl: result.previewUrl, wasmTransferBytes: result.assets.wasm.transferBytes, fontTransferBytes: result.assets.font.transferBytes })), null, 2));
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
