import { createHash } from 'node:crypto';

export const command = '/slint-preview';
const defaultFont = 'vendor/slint/tools/editor/ui/assets/Inter-VariableFont.ttf';
const writable = new Set(['admin', 'maintain', 'write']);

function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`Unknown ${label} field: ${key}`);
  }
}
function text(value, label, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${label}`);
  return value;
}
function sourcePath(value, label) {
  text(value, label, 300);
  if (!/^(examples|vendor)\//.test(value) || value.split('/').some(part => !part || part === '.' || part === '..') || /[\\\x00-\x1f:]/.test(value)) {
    throw new Error(`${label} must be a relative path under examples/ or vendor/`);
  }
  return value;
}
function size(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 4096) throw new Error(`${label} must be an integer from 1 to 4096`);
  return value;
}
function definition(value, fallback = {}) {
  const entry = sourcePath(value.entry ?? fallback.entry, 'entry');
  if (!entry.endsWith('.slint')) throw new Error('entry must name a .slint file');
  return {
    entry,
    font: sourcePath(value.font ?? fallback.font ?? defaultFont, 'font'),
  };
}
export function normalizeConfig(value) {
  object(value, ['schemaVersion', 'examples'], 'configuration');
  if ((value.schemaVersion ?? 1) !== 1) throw new Error('Unsupported configuration schemaVersion');
  if (!Array.isArray(value.examples) || !value.examples.length || value.examples.length > 10) throw new Error('Configure 1 to 10 examples');
  const ids = new Set();
  const examples = value.examples.map(example => {
    object(example, ['id', 'title', 'entry', 'font', 'width', 'height', 'mode', 'before'], 'example');
    const id = text(example.id, 'id', 64);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || ids.has(id)) throw new Error(`Invalid or duplicate example id: ${id}`);
    ids.add(id);
    const mode = example.mode ?? 'compare';
    if (!['compare', 'new'].includes(mode)) throw new Error('mode must be compare or new');
    const after = definition(example);
    let before = null;
    if (example.before !== undefined && example.before !== null) {
      if (mode === 'new') throw new Error('before is only valid in compare mode');
      object(example.before, ['entry', 'font'], 'before');
      before = definition(example.before, after);
    }
    return {
      id, title: text(example.title ?? id, 'title'), ...after,
      width: size(example.width ?? 320, 'width'), height: size(example.height ?? 240, 'height'),
      mode, before,
    };
  });
  return { schemaVersion: 1, examples };
}
export function configHash(config) {
  return createHash('sha256').update(JSON.stringify(normalizeConfig(config))).digest('hex');
}
export function isConfigComment(body = '') {
  return body.replace(/\r\n/g, '\n').split('\n')[0].trim() === command;
}
export function parseComment(body) {
  if (!isConfigComment(body)) throw new Error(`Start the configuration comment with ${command}`);
  const payload = body.replace(/\r\n/g, '\n').split('\n').slice(1).join('\n').trim();
  const match = /^```json\s*\n([\s\S]*?)\n```$/.exec(payload);
  if (!match) throw new Error('Put one fenced json block after /slint-preview');
  let value;
  try { value = JSON.parse(match[1]); } catch (error) { throw new Error(`Invalid preview JSON: ${error.message}`); }
  return normalizeConfig(value);
}

export async function resolveRequest({ github, repo, number, sender }) {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Specify a PR number');
  const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: number });
  const repository = `${repo.owner}/${repo.repo}`;
  if (pr.state !== 'open' || pr.head.repo?.full_name !== repository) return null;
  const permissions = new Map();
  async function canWrite(username) {
    if (!permissions.has(username)) {
      const { data } = await github.rest.repos.getCollaboratorPermissionLevel({ ...repo, username });
      permissions.set(username, writable.has(data.permission));
    }
    return permissions.get(username);
  }
  if (sender && !(await canWrite(sender))) return null;
  const comments = await github.paginate(github.rest.issues.listComments, { ...repo, issue_number: number });
  const candidates = [];
  for (const comment of comments) {
    if (isConfigComment(comment.body) && comment.user.type !== 'Bot' && await canWrite(comment.user.login)) candidates.push(comment);
  }
  if (!candidates.length) return null;
  if (candidates.length > 1) throw new Error('Keep one /slint-preview configuration comment; delete the extra configuration comments');
  const comment = candidates[0];
  const config = parseComment(comment.body);
  return {
    repository, pullRequest: number, headSha: pr.head.sha, baseSha: pr.base.sha,
    configuration: { commentId: comment.id, url: comment.html_url, updatedAt: comment.updated_at, hash: configHash(config), config },
  };
}

export function isCurrentRequest(snapshot, current) {
  return Boolean(current && snapshot.repository === current.repository && snapshot.pullRequest === current.pullRequest &&
    snapshot.headSha === current.headSha && snapshot.baseSha === current.baseSha &&
    snapshot.configuration?.commentId === current.configuration.commentId && snapshot.configuration?.hash === current.configuration.hash);
}

export async function currentArtifact({ github, repo, manifest }) {
  if (manifest.repository !== `${repo.owner}/${repo.repo}` || manifest.revisions?.after?.sha !== manifest.headSha ||
      !/^[a-f0-9]{40}$/.test(manifest.revisions?.before?.sha ?? '') ||
      manifest.configuration?.hash !== configHash(manifest.configuration?.config)) throw new Error('Invalid preview artifact metadata');
  const current = await resolveRequest({ github, repo, number: manifest.pullRequest });
  return isCurrentRequest(manifest, current);
}
