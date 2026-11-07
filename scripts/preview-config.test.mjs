import test from 'node:test';
import assert from 'node:assert/strict';
import { configHash, normalizeConfig, parseComment, resolveRequest, isCurrentRequest, currentArtifact } from './preview-config.mjs';

const repo = { owner: 'NigelBreslaw', repo: 'slint-pr-preview' };
const example = { id: 'image-alignment', entry: 'examples/image-alignment.slint' };
const config = { examples: [example] };
const body = value => `/slint-preview\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
const comment = (id, value = config, login = 'writer') => ({
  id, body: body(value), html_url: `https://github.com/${repo.owner}/${repo.repo}/pull/1#issuecomment-${id}`,
  updated_at: '2026-11-08T00:00:00Z', user: { login, type: 'User' },
});
function fixture(comments = [comment(1)]) {
  const pr = { state: 'open', head: { sha: 'a'.repeat(40), repo: { full_name: `${repo.owner}/${repo.repo}` } }, base: { sha: 'b'.repeat(40) } };
  const github = {
    rest: {
      pulls: { get: async () => ({ data: pr }) },
      repos: { getCollaboratorPermissionLevel: async ({ username }) => ({ data: { permission: username === 'writer' ? 'write' : 'read' } }) },
      issues: { listComments() {} },
    },
    paginate: async () => comments,
  };
  return { github, repo, number: 1, pr, comments };
}

test('parses a fenced comment and normalizes omitted defaults deterministically', () => {
  const parsed = parseComment(body(config));
  assert.equal(parsed.examples[0].mode, 'compare');
  assert.equal(parsed.examples[0].width, 320);
  assert.equal(configHash(config), configHash({ schemaVersion: 1, examples: [{ height: 240, width: 320, mode: 'compare', ...example }] }));
  assert.equal(configHash(parsed), configHash(config));
});

test('rejects malformed payloads, typos, duplicate IDs, unsafe paths, and invalid dimensions', () => {
  for (const invalid of [body(config).replace('```json', '```yaml'), '/slint-preview\n```json\n{bad}\n```', '/slint-preview other\n{}']) {
    assert.throws(() => parseComment(invalid));
  }
  for (const patch of [{ mode: 'comparison' }, { widht: 100 }, { width: 0 }, { height: 4097 }, { entry: '../outside.slint' },
    { entry: 'examples/../outside.slint' }, { entry: 'examples\\outside.slint' }, { entry: 'examples/a.js' }, { id: 'bad id' }]) {
    assert.throws(() => normalizeConfig({ examples: [{ ...example, ...patch }] }));
  }
  assert.throws(() => normalizeConfig({ examples: [example, example] }));
  assert.throws(() => normalizeConfig({ examples: [], runtime: 'untrusted' }));
});

test('supports new-only UI and an optional baseline adapter', () => {
  const newOnly = normalizeConfig({ examples: [{ ...example, mode: 'new' }] });
  assert.equal(newOnly.examples[0].before, null);
  assert.throws(() => normalizeConfig({ examples: [{ ...example, mode: 'new', before: {} }] }));
  const adapted = normalizeConfig({ examples: [{ ...example, before: { entry: 'examples/old.slint' } }] });
  assert.equal(adapted.examples[0].before.entry, 'examples/old.slint');
  assert.equal(adapted.examples[0].before.font, adapted.examples[0].font);
});

test('uses one authorized configuration and ignores discussion, bot output, and reader commands', async () => {
  const f = fixture([comment(2, config, 'reader'), { ...comment(3), body: '<!-- slint-ui-preview --> result' }, comment(4)]);
  const request = await resolveRequest(f);
  assert.equal(request.configuration.commentId, 4);
  assert.equal(request.headSha, f.pr.head.sha);
  assert.equal(await resolveRequest({ ...f, sender: 'reader' }), null);
  assert.equal((await resolveRequest({ ...f, sender: 'writer' })).configuration.commentId, 4);
});

test('rejects duplicate or broken writer configurations instead of falling back', async () => {
  await assert.rejects(resolveRequest(fixture([comment(1), comment(2)])), /Keep one/);
  await assert.rejects(resolveRequest(fixture([{ ...comment(1), body: '/slint-preview\ninvalid' }])), /fenced/);
  assert.equal(await resolveRequest(fixture([])), null);
});

test('does not preview closed PRs or forks', async () => {
  const f = fixture();
  f.pr.state = 'closed';
  assert.equal(await resolveRequest(f), null);
  f.pr.state = 'open';
  f.pr.head.repo.full_name = 'someone/fork';
  assert.equal(await resolveRequest(f), null);
});

test('rejects stale configuration at the same source SHA, replaced comments, or moved Git revisions', async () => {
  const f = fixture();
  const first = await resolveRequest(f);
  f.comments[0] = comment(1, { examples: [{ ...example, mode: 'new' }] });
  const edited = await resolveRequest(f);
  assert.equal(first.headSha, edited.headSha);
  assert.equal(isCurrentRequest(first, edited), false);
  assert.equal(isCurrentRequest(edited, edited), true);
  assert.equal(isCurrentRequest(edited, { ...edited, headSha: 'c'.repeat(40) }), false);
  assert.equal(isCurrentRequest(edited, { ...edited, baseSha: 'c'.repeat(40) }), false);
  assert.equal(isCurrentRequest(edited, { ...edited, configuration: { ...edited.configuration, commentId: 9 } }), false);
  assert.equal(isCurrentRequest(edited, null), false);
});

test('rechecks frozen artifact configuration against the live PR before publishing', async () => {
  const f = fixture();
  const request = await resolveRequest(f);
  const manifest = { ...request, revisions: { before: { sha: 'b'.repeat(40) }, after: { sha: request.headSha } } };
  assert.equal(await currentArtifact({ ...f, manifest }), true);
  f.comments[0] = comment(1, { examples: [{ ...example, title: 'Edited without a commit' }] });
  assert.equal(await currentArtifact({ ...f, manifest }), false);
  await assert.rejects(currentArtifact({ ...f, manifest: { ...manifest, repository: 'another/repo' } }), /Invalid preview artifact/);
});
