import init, * as slint from './runtime/slint_wasm_interpreter.js';

const status = document.getElementById('status');
let instance;
const timeout = setTimeout(() => fail(new Error('The component did not finish loading within 30 seconds.')), 30000);
function fail(error) {
  clearTimeout(timeout);
  document.body.dataset.state = 'error';
  status.hidden = false;
  status.textContent = error.message || String(error);
}
window.addEventListener('error', (event) => fail(event.error || new Error(event.message)));
window.addEventListener('unhandledrejection', (event) => fail(event.reason));

try {
  const params = new URLSearchParams(location.search);
  const manifest = await (await fetch('./manifest.json')).json();
  const example = manifest.examples.find((item) => item.id === params.get('example')) || manifest.examples[0];
  const side = params.get('revision') === 'before' ? 'before' : 'after';
  if (side === 'before' && !example.before) throw new Error('This example has no previous version.');
  const definition = side === 'before' ? example.before : example;
  const revision = manifest.revisions[side];
  const base = new URL(revision.root, location.href);
  const sourceUrl = new URL(definition.entry, base);
  const load = async (url) => {
    const resource = new URL(url, sourceUrl);
    if (resource.origin !== base.origin || !resource.pathname.startsWith(base.pathname)) throw new Error('Import is outside this preview bundle.');
    const response = await fetch(resource);
    if (!response.ok) throw new Error(`Could not load ${resource.pathname}`);
    return response;
  };
  await init();
  slint.run_event_loop();
  if (definition.font) slint.register_font_from_memory(new Uint8Array(await (await load(new URL(definition.font, base))).arrayBuffer()));
  const source = await (await load(sourceUrl)).text();
  const result = await slint.compile_from_string(source, sourceUrl.href, async (url) => (await load(url)).text());
  if (!result.component) throw new Error(result.error_string || JSON.stringify(result.diagnostics));
  instance = await result.component.create('preview');
  await instance.show();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  clearTimeout(timeout);
  document.title = `${definition.title} · ${side} ${revision.sha.slice(0, 7)}`;
  document.body.dataset.state = 'ready';
  status.hidden = true;
} catch (error) {
  fail(error);
}
