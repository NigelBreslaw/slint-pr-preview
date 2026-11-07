import { readFile, writeFile } from 'node:fs/promises';
import { currentArtifact, resolveRequest } from './preview-config.mjs';

export async function prepareBuild({ github, context, core }) {
  const number = Number(context.payload.issue?.number ?? context.payload.pull_request?.number ?? context.payload.inputs?.pull_request);
  const request = await resolveRequest({
    github, repo: context.repo, number,
    sender: context.eventName === 'issue_comment' ? context.payload.sender.login : undefined,
  });
  if (!request) {
    core.notice('No authorized configuration for this open, same-repository PR. Add one /slint-preview comment to enable previews.');
    return;
  }
  await writeFile('preview-request.json', JSON.stringify(request, null, 2));
  core.setOutput('head', request.headSha);
  core.setOutput('base', request.baseSha);
  core.setOutput('number', request.pullRequest);
  await core.summary.addHeading(`UI preview for PR #${number}`)
    .addLink('Configuration comment', request.configuration.url)
    .addRaw(`\n\nConfiguration: \`${request.configuration.hash}\`\n\nSource: \`${request.headSha}\``).write();
}

export async function checkArtifact({ github, context, core }) {
  const manifest = JSON.parse(await readFile('preview-deploy/dist/manifest.json', 'utf8'));
  if (!(await currentArtifact({ github, repo: context.repo, manifest }))) {
    core.notice('The PR or configuration changed; skipping this superseded preview.');
    return;
  }
  core.setOutput('number', manifest.pullRequest);
  core.setOutput('head', manifest.headSha);
  core.setOutput('hash', manifest.configuration.hash);
}

export async function publishPreview({ github, context, core }) {
  const manifest = JSON.parse(await readFile('preview-deploy/dist/manifest.json', 'utf8'));
  if (!(await currentArtifact({ github, repo: context.repo, manifest }))) {
    core.notice('The PR or configuration changed during deployment; leaving its preview link unchanged.');
    return;
  }
  const url = process.env.PREVIEW_URL.replace(/\/$/, '');
  const marker = '<!-- slint-ui-preview -->';
  const body = `${marker}\n[Open interactive UI preview](${url}/) · [After only](${url}/?view=after)\n\nBefore: \`${manifest.revisions.before.sha.slice(0, 7)}\` · After: \`${manifest.headSha.slice(0, 7)}\`\n\n[Edit preview configuration](${manifest.configuration.url}) · Configuration: \`${manifest.configuration.hash.slice(0, 12)}\``;
  const comments = await github.paginate(github.rest.issues.listComments, { ...context.repo, issue_number: manifest.pullRequest });
  const existing = comments.find(comment => comment.user.type === 'Bot' && comment.body.includes(marker));
  if (existing) await github.rest.issues.updateComment({ ...context.repo, comment_id: existing.id, body });
  else await github.rest.issues.createComment({ ...context.repo, issue_number: manifest.pullRequest, body });
  const { data: deployment } = await github.rest.repos.createDeployment({
    ...context.repo, ref: manifest.headSha, environment: `pr-preview-${manifest.pullRequest}`,
    auto_merge: false, required_contexts: [], transient_environment: true, production_environment: false,
    description: `UI configuration ${manifest.configuration.hash.slice(0, 12)}`,
  });
  await github.rest.repos.createDeploymentStatus({
    ...context.repo, deployment_id: deployment.id, state: 'success', environment_url: `${url}/`,
    log_url: `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
  });
  await core.summary.addLink('Deployed preview', `${url}/`).addRaw(`\n\n${body}`).write();
}
