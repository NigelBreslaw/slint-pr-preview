const status = document.getElementById('status');
const manifest = JSON.parse(document.getElementById('preview-manifest').textContent);
const configuration = JSON.parse(document.getElementById('player-config')?.textContent || '{}');
const params = new URLSearchParams(location.search);
const exampleId = configuration.exampleId || params.get('example');
const example = manifest.examples.find(item => item.id === exampleId) || manifest.examples[0];
const side = (configuration.side || params.get('revision')) === 'before' ? 'before' : 'after';
const baseUrl = new URL('.', document.baseURI);
let component;
let instance;
let resetting = Promise.resolve();
const timeout = setTimeout(() => fail(new Error('The component did not finish loading within 30 seconds.')), 30000);

function notify(type, requestId) {
  if (parent !== window) parent.postMessage({ type, requestId }, baseUrl.origin);
}
function fail(error, requestId) {
  clearTimeout(timeout);
  document.body.dataset.state = 'error';
  status.hidden = false;
  status.textContent = error.message || String(error);
  notify('slint-preview-error', requestId);
}
async function show(requestId) {
  await instance.show();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  clearTimeout(timeout);
  document.body.dataset.state = 'ready';
  status.hidden = true;
  notify('slint-preview-ready', requestId);
}
window.addEventListener('error', event => fail(event.error || new Error(event.message)));
window.addEventListener('unhandledrejection', event => fail(event.reason));
window.addEventListener('message', event => {
  if (event.source !== parent || event.origin !== baseUrl.origin || event.data?.type !== 'slint-preview-reset') return;
  const requestId = event.data.requestId;
  resetting = resetting.then(async () => {
    if (!component || document.body.dataset.state !== 'ready') throw new Error('The component is not ready to reset.');
    document.body.dataset.state = 'resetting';
    instance = await component.create_with_existing_window(instance);
    await show(requestId);
  }).catch(error => fail(error, requestId));
});

try {
  if (side === 'before' && !example.before) throw new Error('This example has no previous version.');
  const definition = side === 'before' ? example.before : example;
  const revision = manifest.revisions[side];
  const virtualRoot = new URL(revision.root, baseUrl);
  const sourceUrl = new URL(definition.entry, virtualRoot);
  const shared = parent !== window ? parent.slintPreviewAssets : null;
  const fetchAsset = async file => {
    const response = await fetch(new URL(file, baseUrl));
    if (!response.ok) throw new Error(`Could not load ${file}`);
    return response;
  };
  const runtime = import(new URL(manifest.runtimeModule, baseUrl).href).then(async slint => {
    if (shared) await slint.default({ module_or_path: await shared.wasm });
    else await slint.default();
    slint.run_event_loop();
    return slint;
  });
  const sources = shared ? shared.sources(revision.sourceBundle) : fetchAsset(revision.sourceBundle).then(response => response.json());
  const font = definition.font
    ? shared ? shared.font(revision.assets[definition.font]) : fetchAsset(revision.assets[definition.font]).then(response => response.arrayBuffer())
    : Promise.resolve(null);
  const [slint, files, fontBytes] = await Promise.all([runtime, sources, font]);
  if (fontBytes) slint.register_font_from_memory(new Uint8Array(fontBytes));
  const load = async url => {
    const resource = new URL(url, sourceUrl);
    if (resource.origin !== virtualRoot.origin || !resource.pathname.startsWith(virtualRoot.pathname)) throw new Error('Import is outside this preview bundle.');
    const file = decodeURIComponent(resource.pathname.slice(virtualRoot.pathname.length));
    if (!(file in files)) throw new Error(`Could not load ${file}`);
    return files[file];
  };
  const result = await slint.compile_from_string(await load(sourceUrl), sourceUrl.href, load);
  if (!result.component) throw new Error(result.error_string || JSON.stringify(result.diagnostics));
  component = result.component;
  instance = await component.create('preview');
  await show();
  document.title = `${definition.title} · ${side} ${revision.sha.slice(0, 7)}`;
} catch (error) {
  fail(error);
}
