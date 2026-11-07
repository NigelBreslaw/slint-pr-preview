const element = id => document.getElementById(id);
try {
  const manifest = JSON.parse(element('preview-manifest').textContent);
  const params = new URLSearchParams(location.search);
  const select = element('example');
  for (const example of manifest.examples) select.add(new Option(example.title, example.id));
  select.value = manifest.examples.some(example => example.id === params.get('example')) ? params.get('example') : manifest.examples[0].id;
  element('runtime-info').href = new URL(manifest.runtimeProvenance, location.href);
  let view = params.get('view') === 'after' ? 'after' : 'compare';
  let currentExample;
  let requestId = 0;
  const panels = new Map();
  const pendingReset = new Set();
  const assetRequests = new Map();
  const loadAsset = async file => {
    const response = await fetch(new URL(file, document.baseURI));
    if (!response.ok) throw new Error(`Could not load ${file}`);
    return response;
  };
  function sharedAsset(file, read) {
    if (!assetRequests.has(file)) {
      const request = loadAsset(file).then(read);
      request.catch(() => {});
      assetRequests.set(file, request);
    }
    return assetRequests.get(file);
  }
  const wasm = WebAssembly.compileStreaming(loadAsset(manifest.runtimeWasm));
  wasm.catch(() => {});
  window.slintPreviewAssets = {
    wasm,
    sources: file => sharedAsset(file, response => response.json()),
    font: file => sharedAsset(file, response => response.arrayBuffer()),
  };
  for (const side of ['before', 'after']) {
    const example = manifest.examples.find(item => item.id === select.value);
    const definition = side === 'before' ? example.before : example;
    if (!definition) continue;
    const revision = manifest.revisions[side];
    window.slintPreviewAssets.sources(revision.sourceBundle);
    if (definition.font) window.slintPreviewAssets.font(revision.assets[definition.font]);
  }

  if (manifest.pullRequest) {
    const link = document.createElement('a');
    link.textContent = `${manifest.repository} #${manifest.pullRequest}`;
    link.href = `https://github.com/${manifest.repository}/pull/${manifest.pullRequest}`;
    element('pull-request').append(link);
  }

  function updateReset() {
    element('reset').disabled = pendingReset.size > 0 || [...panels.values()].some(panel => !panel.hidden && panel.querySelector('iframe').dataset.state !== 'ready');
  }
  function render() {
    const example = manifest.examples.find(item => item.id === select.value);
    const compare = view === 'compare' && example.mode === 'compare';
    element('title').textContent = example.title;
    element('description').textContent = compare ? 'Before on the left. After on the right. Try either example.' : 'Try the UI from this pull request.';
    element('compare').disabled = example.mode === 'new';
    element('compare').setAttribute('aria-pressed', String(compare));
    element('after').setAttribute('aria-pressed', String(!compare));
    const container = element('previews');
    if (currentExample !== example.id) {
      container.replaceChildren();
      panels.clear();
      pendingReset.clear();
      currentExample = example.id;
    }
    container.classList.toggle('single', !compare);
    const sides = compare ? ['before', 'after'] : ['after'];
    for (const [side, panel] of panels) panel.hidden = !sides.includes(side);
    for (const side of sides) {
      if (panels.has(side)) continue;
      const revision = manifest.revisions[side];
      const panel = document.createElement('article');
      const heading = document.createElement('h2');
      heading.textContent = side === 'before' ? 'Before' : 'After';
      const sha = document.createElement('a');
      sha.textContent = revision.sha.slice(0, 7);
      sha.href = `https://github.com/${manifest.repository}/commit/${revision.sha}`;
      heading.append(' ', sha);
      const viewport = document.createElement('div');
      viewport.className = 'viewport';
      const frame = document.createElement('iframe');
      frame.title = `${side === 'before' ? 'Before' : 'After'}: ${example.title}`;
      const configuration = JSON.stringify({ exampleId: example.id, side }).replace(/</g, '\\u003c');
      const baseUrl = new URL('.', document.baseURI).href;
      frame.srcdoc = manifest.playerHtml.replace('<!--PLAYER_CONFIG-->', `<base href="${baseUrl}"><script id="player-config" type="application/json">${configuration}</script>`);
      frame.width = example.width;
      frame.height = example.height;
      frame.dataset.side = side;
      frame.dataset.state = 'loading';
      viewport.append(frame);
      const embed = document.createElement('a');
      embed.className = 'standalone';
      embed.href = `./player?example=${encodeURIComponent(example.id)}&revision=${side}`;
      embed.textContent = 'Open component only ↗';
      panel.append(heading, viewport, embed);
      panels.set(side, panel);
      if (side === 'before') container.prepend(panel);
      else container.append(panel);
    }
    updateReset();
    const next = new URLSearchParams({ example: example.id, view: compare ? 'compare' : 'after' });
    history.replaceState(null, '', `?${next}`);
  }
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || !['slint-preview-ready', 'slint-preview-error'].includes(event.data?.type)) return;
    const panel = [...panels.values()].find(panel => panel.querySelector('iframe').contentWindow === event.source);
    if (!panel) return;
    panel.querySelector('iframe').dataset.state = event.data.type === 'slint-preview-ready' ? 'ready' : 'error';
    if (event.data.requestId === requestId) pendingReset.delete(event.source);
    updateReset();
  });
  select.addEventListener('change', render);
  element('compare').addEventListener('click', () => { view = 'compare'; render(); });
  element('after').addEventListener('click', () => { view = 'after'; render(); });
  element('reset').addEventListener('click', () => {
    requestId += 1;
    for (const panel of panels.values()) {
      if (panel.hidden) continue;
      const frame = panel.querySelector('iframe');
      pendingReset.add(frame.contentWindow);
      frame.contentWindow.postMessage({ type: 'slint-preview-reset', requestId }, location.origin);
    }
    updateReset();
  });
  render();
} catch (error) {
  element('title').textContent = 'Preview unavailable';
  element('error').hidden = false;
  element('error').textContent = error.message;
}
