# Slint PR Preview Prototype

Preview a Slint component on its own, or compare it at two Git revisions.
This prototype belongs to NigelBreslaw and deploys to a personal Cloudflare Worker.

## Try It

Open [demonstration PR #1](https://github.com/NigelBreslaw/slint-pr-preview/pull/1) and follow its automated preview comment.
The left panel shows the original gallery control; the right panel shows rounded square alignment points.
Select points in either panel, reset the example, or switch to the after-only view.
Each panel also links to a component-only view.

The build and deployment run entirely in this personal repository.
The deployment token expires on February 5, 2027.
Replace the repository's `CLOUDFLARE_API_TOKEN` secret to keep deployments working after that date.

## Implementation Plan

1. Copy the visual editor gallery's image-alignment example into a standalone window.
   Keep the production control and theme files unchanged, with their upstream revision recorded.
   Use a fixed 320 × 240 viewport, the Inter font, light theme, and center alignment.
2. Build a small browser player using the published Slint 1.18.0 wasm interpreter.
   Compile the example's `.slint` source in the browser and load its bundled imports.
   Provide a component-only URL with no gallery navigation.
3. Add a comparison page with one isolated iframe per revision.
   Show before on the left and after on the right, with commit links and a reset action.
   Support an after-only view for new UI.
4. Package examples from the PR head and its merge base with `master`.
   Record both exact SHAs in the output.
   Package source locally and reference shared immutable fonts and runtime, so the deployed page needs no GitHub access.
5. Adapt Slint's `.github/workflows/deploy_preview.yaml` in this repository.
   Build on PR updates and configuration-comment edits, then publish the artifact in a separate `workflow_run` workflow.
   Use a dedicated personal Worker and repository secrets scoped to the personal Cloudflare account.
   Update one PR comment and a GitHub deployment after a successful publish.
   Ignore builds whose source revision or configuration has been superseded.
6. Open one demonstration PR that changes the copied control's appearance.
   Verify both versions render and respond independently at the deployed URL.
   Push a second commit to verify the preview link and PR comment update.

## First Prototype

The example reproduces the image-alignment section in the visual editor's inspector-controls gallery.
It imports the production `InspectorImageAlignment` control and supplies local selection state.
The standalone window replaces the surrounding editor and gallery.

The exporter bundles Slint imports and gives scripts and source bundles content-hashed URLs.
Deployed previews use one shared origin for content-addressed runtime and font files.
The parent preloads these assets and passes the configuration directly to each isolated player.
The players share a compiled wasm module and downloaded assets, with separate instances and UI state.
Reset reuses the compiled component and existing window; switching views keeps the players alive.
The deployment workflow adds immutable cache headers for the hashed assets.
The shared host also permits cross-origin loading and exposes resource timing for cache verification.

The prototype uses a single pinned interpreter for both source revisions.
It demonstrates component changes; comparing Slint compiler or renderer revisions requires separate runtime builds later.
Only branches in this personal repository can publish previews.

## Completion Criteria

- A PR in `NigelBreslaw/slint-pr-preview` produces a working Cloudflare preview URL.
- The comparison shows the actual files from the recorded base and head commits.
- Selecting an alignment in either frame leaves the other frame unchanged.
- The after-only and component-only URLs work independently.
- A later commit or configuration-comment edit updates the existing result comment without publishing a superseded build.
- No workflow or branch in `slint-ui/slint` changes.

## Configure a PR Preview

Add one PR comment starting with `/slint-preview`, followed by a fenced JSON block:

````markdown
/slint-preview

```json
{
  "examples": [
    {
      "id": "image-alignment",
      "title": "Image alignment",
      "entry": "examples/image-alignment.slint",
      "mode": "compare",
      "width": 320,
      "height": 240
    }
  ]
}
```
````

Edit that same comment to redeploy without a commit.
New commits reuse the current comment.
The separate bot result comment links back to the configuration and shows its hash.
No configuration manifest is checked into the PR.
The generated `manifest.json` belongs to the deployment artifact and freezes the comment configuration and source revisions.
Old version URLs retain their original configuration.

Use `mode: "new"` to show only the PR's UI.
Use `mode: "compare"` to show the merge base on the left and the PR head on the right.
If the component moved, add `"before": { "entry": "examples/old-name.slint" }` to that example.
The baseline adapter can also override `font`.
Both sides use the example's `width` and `height`.

The configuration supports up to ten examples with unique lowercase IDs.
`title` defaults to the ID, `mode` to `compare`, and the viewport to 320 × 240.
`font` defaults to the bundled Inter font.
Entry and font paths must be inside `examples/` or `vendor/`.
The interpreter version stays pinned by the trusted tooling.

Only comments from collaborators with write, maintain, or admin access configure previews.
Keep exactly one configuration comment; multiple authorized comments or invalid JSON fail the build with an actionable error.
The Actions run summary records the configuration link, hash, and source SHA.
Delete the configuration comment to stop future preview builds; existing version URLs remain available.
After recreating it, or to retry a failed build, run **Build UI Preview** manually with the PR number.

Builds use tooling from `master` and read the selected source files from the requested Git revisions.
They receive no Cloudflare credentials.
The deployment workflow rechecks the live PR and comment before uploading and before updating the result link.
Editing the bot result comment does not trigger a preview build.

## Local Development

Save the JSON from the configuration comment to a temporary file outside the repository, then run:

```sh
npm ci
npm run test:config
npm run build -- --manifest /tmp/slint-preview.json
npm run dev
```

To compare two commits with the same external configuration:

```sh
npm run build -- --base <base-sha> --head <head-sha> --manifest /tmp/slint-preview.json
npm test
```

The browser smoke checks exercise the prototype's image-alignment fixture in both `new` and `compare` modes.

## Shared Runtime and Font Hosting

`nigel-slint-preview-assets` serves the shared files at:

```text
https://nigel-slint-preview-assets.nigel-breslaw.workers.dev
```

Every deployed preview references the same absolute URLs for unchanged runtime and font bytes.
Runtime directories and font filenames use full SHA-256 hashes.
These files have a one-year immutable cache policy, CORS permission, and `Timing-Allow-Origin: *`.
The runtime bundle includes its JavaScript loader, wasm, and provenance; license files are retained alongside the assets.

The build checks a self-contained package locally, then produces a deployment package with shared URLs and a separate `shared-assets` artifact.
The deployment workflow publishes shared assets before uploading the PR preview version.
It retains all files in the existing catalog and verifies their hashes before adding new files.
A changed runtime or font gets a new URL; old preview URLs retain access to the old files.
Deployments are serialized across this prototype repository to preserve the shared catalog.
The catalog has a 1,000-file guard; it fails instead of silently dropping retained assets.

Local builds remain self-contained unless `--shared-assets-base <origin>` is supplied.
To verify cache reuse across two deployed preview origins, run:

```sh
npm run verify:shared-cache -- <first-preview-url> <second-preview-url> /tmp/slint-cache-evidence
```

This uses a fresh Chromium profile, opens both URLs, then restarts the browser with the same profile.
It requires positive cold transfer sizes, zero warm transfer sizes, and browser cache-hit evidence for wasm and font.
It saves screenshots and `verification.json`.
Cache reuse applies within a browser cache partition; separate app hosts or browser profiles may download their own copies.

## Personal Cloudflare Setup

The Worker is named `nigel-slint-pr-preview`.
Its configuration pins Nigel's personal account, so Slint's saved login cannot deploy it accidentally.
The local personal login is stored separately:

```sh
XDG_CONFIG_HOME="$HOME/Library/Preferences/slint-pr-preview-personal" npm run deploy
```

Set these repository secrets after authenticating to the personal account:

- `CLOUDFLARE_ACCOUNT_ID`: the personal account ID.
- `CLOUDFLARE_API_TOKEN`: a token scoped to that account with permission to edit Workers Scripts.

The deployment workflow generates the Cloudflare configuration from trusted workflow code.
It never runs scripts from the downloaded PR artifact.
Each PR deployment has its own version URL.
The default Worker URL changes only when a version is explicitly promoted.

## Upstream Sources and Licenses

`vendor/slint/provenance.json` records the source repository and exact revision.
The control and theme retain their original license headers.
The Inter font retains its OFL license.
The interpreter's release URL and checksums are recorded in `runtime/provenance.json`.
Prototype code is distributed under GPL-3.0-only; see `LICENSE`.

## Later Slint Integration

Move the player and exporter into Slint only after this prototype works in a real PR.
Then add a UI preview artifact to Slint's existing build and deployment workflows.
Keep example definitions usable by both the gallery and standalone player.
Separate runtimes, baseline adapters, more examples, and automated visual diffs can follow.
