# Spool Studio Bridge handoff

In Full Spectrum, apply a four-slot palette, open **Send filament setup to U1**, then choose **Use my Spool Studio Bridge**. The signed-in Spool Studio printer page receives the four physical colours and materials in slot order. Blended colours remain in the project.

Spool Studio selects a library entry only when one available supported entry matches the requested material and colour. Multiple matches require a choice; absent matches leave the picker empty. The review explicitly identifies a different chosen colour or material. Finish and optional physical-reel tracking remain part of Spool Studio's review.

Each slot is reviewed and sent separately through the existing account-bound bridge. No new local launcher, API key or desktop update is required. Printing and stale or unsupported printer states keep sending disabled. This updates filament metadata, not the print file, temperatures or a running job.

The nonce-bound `yab3d-printer` v1 popup protocol checks both origin and window identity. YAB3D sends four `{color, material}` records, never a model or credentials. Spool Studio returns minimal outcomes for request IDs associated internally with this handoff; account IDs, library IDs and printer keys stay there. Only server-reported readback verification produces a verified message. Changing the applied palette cancels the handoff and clears its review; already-confirmed requests may still finish. Reloading/closing either tab requires reopening the handoff.

The companion implementation is in `rendez2k/spool-studio`: `out/yab3d-printer.js` and the existing printer page. That receiver must be deployed at `https://spool-studio.uk` before enabling this route on YAB3D. Direct Moonraker/local-launcher access remains a separate, collapsed fallback.

Validation: protocol tests cover origin/nonce/window rejection, bounded data, progress and cancellation. Browser checks use synthetic account data and intercepted printer requests to cover printing, matching, per-slot review, readback feedback and mobile layout. These checks do not establish a successful hardware send; verify a real slot after the current print finishes.
