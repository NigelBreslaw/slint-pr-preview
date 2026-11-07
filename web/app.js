const element = (id) => document.getElementById(id);
try {
  const response = await fetch('./manifest.json');
  if (!response.ok) throw new Error('The preview manifest could not be loaded.');
  const manifest = await response.json();
  const params = new URLSearchParams(location.search);
  const select = element('example');
  for (const example of manifest.examples) select.add(new Option(example.title, example.id));
  select.value = manifest.examples.some((example) => example.id === params.get('example')) ? params.get('example') : manifest.examples[0].id;
  let view = params.get('view') === 'after' ? 'after' : 'compare';

  if (manifest.pullRequest) {
    const link = document.createElement('a');
    link.textContent = `${manifest.repository} #${manifest.pullRequest}`;
    link.href = `https://github.com/${manifest.repository}/pull/${manifest.pullRequest}`;
    element('pull-request').append(link);
  }

  function render() {
    const example = manifest.examples.find((item) => item.id === select.value);
    const compare = view === 'compare' && example.mode === 'compare';
    element('title').textContent = example.title;
    element('description').textContent = compare ? 'Before on the left. After on the right. Try either example.' : 'Try the UI from this pull request.';
    element('compare').disabled = example.mode === 'new';
    element('compare').setAttribute('aria-pressed', String(compare));
    element('after').setAttribute('aria-pressed', String(!compare));
    const container = element('previews');
    container.replaceChildren();
    container.classList.toggle('single', !compare);
    for (const side of compare ? ['before', 'after'] : ['after']) {
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
      frame.src = `./player.html?example=${encodeURIComponent(example.id)}&revision=${side}`;
      frame.width = example.width;
      frame.height = example.height;
      frame.dataset.side = side;
      viewport.append(frame);
      const embed = document.createElement('a');
      embed.className = 'standalone';
      embed.href = frame.src;
      embed.textContent = 'Open component only ↗';
      panel.append(heading, viewport, embed);
      container.append(panel);
    }
    const next = new URLSearchParams({ example: example.id, view: compare ? 'compare' : 'after' });
    history.replaceState(null, '', `?${next}`);
  }
  select.addEventListener('change', render);
  element('compare').addEventListener('click', () => { view = 'compare'; render(); });
  element('after').addEventListener('click', () => { view = 'after'; render(); });
  element('reset').addEventListener('click', render);
  render();
} catch (error) {
  element('title').textContent = 'Preview unavailable';
  element('error').hidden = false;
  element('error').textContent = error.message;
}
