# MakerWorld → YAB3D (review)

Adds **Open in YAB3D** beside the MakerWorld download controls, with a choice of
**Analyse & convert** or **Full Spectrum**. It captures the authenticated original
3MF, resolves MakerWorld's CDN response when needed, and sends those original
bytes to a new YAB3D tab before the U1 converter runs.

The review extension targets `https://u1-reel-changes--yab3u1.netlify.app`.
It requires the matching receiver in `web/shared/modelHandoff.js`. No additional
extension permissions, model uploads, automatic exports or printer writes are
introduced. Existing U1 conversion and the IDM filename fix are retained.

## Build / install

1. Copy the installed MakerWorld-to-U1 **1.5.3.3** directory to a staging directory.
2. Run `python integrations/makerworld/patch.py <staging-directory>`.
3. Back up the installed extension. Copy the staged `manifest.json`, `content.js`
   and `yab3d-handoff.js` into it. The resulting version is **1.5.3.6**.
4. Reload the extension in Chrome's extensions page, then refresh MakerWorld.
5. Choose a print profile, choose the YAB3D workspace, and click **Open in YAB3D**.
   Complete MakerWorld login or verification if requested. Allow its popup.

The patcher rejects other extension versions rather than silently applying to
changed upstream code. The original extension and its licences remain separate;
this directory contains only the handoff and the patch instructions.

## Protocol and limits

- A new popup receives a random 128-bit nonce and the MakerWorld origin in its
  fragment. The receiver removes the fragment after opening.
- Both sides validate the exact message origin, source window, nonce and version.
- Up to 96 MiB, `.3mf` basename only, ZIP signature checked before the regular
  importer analyses the archive. The original model is never modified in transit.
- Receipt and successful parsing are separate acknowledgements. Failure is visible
  on both sides. Timeout, closing the popup, changing MakerWorld model or choosing
  a local file cancels the pending handoff.
- A loaded or loading receiver cannot be replaced. No model is persisted to browser
  storage, and the receiver never automatically exports or sends to a printer.

## Validation

`node --test web/tests/model-handoff.test.mjs web/tests/printer-bridge.test.mjs`
checks protocol isolation, file bounds, unchanged bytes, cancellation and failures.
`python -m unittest tests.test_site_build` checks published assets.

Review verification also exercised the actual sender in a browser isolated world
with cross-origin popups and both real YAB3D importers, using a painted 3MF fixture.
Captured ZIP and JSON/CDN inputs were checked against the patched orchestration:
both bypass conversion with byte-identical output. The existing five IDM/download
regression checks passed. MakerWorld authentication and live download are still
subject to the user's signed-in MakerWorld session and require a live smoke test.
