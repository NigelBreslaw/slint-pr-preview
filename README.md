# Slint PR Preview Prototype

Preview a Slint component on its own, or compare it at two Git revisions.
This prototype belongs to NigelBreslaw and deploys to a personal Cloudflare Worker.

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
   Bundle source, fonts, and runtime so the deployed page needs no GitHub access.
5. Adapt Slint's `.github/workflows/deploy_preview.yaml` in this repository.
   Build and test on `pull_request`, then publish the artifact in a separate `workflow_run` workflow.
   Use a dedicated personal Worker and repository secrets scoped to the personal Cloudflare account.
   Update one PR comment and a GitHub deployment after a successful publish.
   Ignore superseded builds before updating the PR link.
6. Open one demonstration PR that changes the copied control's appearance.
   Verify both versions render and respond independently at the deployed URL.
   Push a second commit to verify the preview link and PR comment update.

## First Prototype

The example reproduces the image-alignment section in the visual editor's inspector-controls gallery.
It imports the production `InspectorImageAlignment` control and supplies local selection state.
The standalone window replaces the surrounding editor and gallery.

The exporter bundles Slint imports and gives the runtime, fonts, scripts, and source bundles content-hashed URLs.
The parent preloads these assets and passes the configuration directly to each isolated player.
The players share a compiled wasm module and downloaded assets, with separate instances and UI state.
Reset reuses the compiled component and existing window; switching views keeps the players alive.
The deployment workflow adds immutable cache headers for the hashed assets.

The prototype uses a single pinned interpreter for both source revisions.
It demonstrates component changes; comparing Slint compiler or renderer revisions requires separate runtime builds later.
Only branches in this personal repository can publish previews.

## Completion Criteria

- A PR in `NigelBreslaw/slint-pr-preview` produces a working Cloudflare preview URL.
- The comparison shows the actual files from the recorded base and head commits.
- Selecting an alignment in either frame leaves the other frame unchanged.
- The after-only and component-only URLs work independently.
- A later commit updates the existing PR comment without publishing an older build over it.
- No workflow or branch in `slint-ui/slint` changes.

## Local Development

```sh
npm ci
npm run build
npm run dev
```

To compare two commits:

```sh
npm run build -- --base <base-sha> --head <head-sha>
npm test
```

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
The default Worker URL serves a small landing page; each PR deployment has its own version URL.

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
