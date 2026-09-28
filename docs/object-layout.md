# Separate object layout and converter printer setup

The main converter starts in **Automatic** mode. Loading a model keeps its source set together. Clicking **Fill plate** compares whole-set and separate-object packing, chooses the better capacity, and reports complete sets and total object count. The selected arrangement is shown in the control. **Undo Fill plate** restores the previous layout.

Two explicit layout choices remain available:

- **Keep the original set together** preserves the relative placement of every selected object. Copies repeats that entire set, including empty space between parts.
- **Pack separate objects** translates each root object independently. Its components, cutouts, scale and orientation stay together. Quantities per object can omit an object (zero) or repeat it up to 64 times. Copies repeats the complete quantities list.

Multiple existing instances of the same root remain a group; the quantity label says how many linked instances are in each group. Keep the original arrangement when separate root objects need their relative positions, such as an assembly intended to print in place.

The packer tries several deterministic rectangle orders. Fill plate reports complete sets it found to fit, not a mathematically optimal capacity. It does not rotate, resize or nest irregular outlines. The U1 keeps its 270 mm bed, 4 mm edge clearance, optional 60 × 70 mm tower corner, spacing and estimated print-addition clearance. Slicing is still required to check actual support and tower reach. Search is bounded to 64 sets and 512 root groups.

The source-derived placement plan drives the archive, simplified preview and thumbnail. Changing quantities refits the preview camera. The original mesh coordinates and paint remain in the exported file.

An unchanged Fill result is explained visibly. When keeping the set together limits capacity, an inline action offers the better separate-object result. Impossible layouts still block export, and their clearance details open automatically.

**Send filament setup to U1** is available on the main converter as well as Full Spectrum. The direct address, check, slot review and send controls are the main flow, all within YAB3D. The converter uses the same final palette calculation as export, including slot swaps, repainting, unused-colour cleanup and reserved process slots. It needs no Apply palette step. Full Spectrum still sends its applied physical palette.

Spool Studio Bridge is a collapsed alternative and currently expects four assigned reels. Direct connection also supports fewer reels, leaves unused slots alone and shows which occupied slots will change. Both flows require explicit review and send; loading or exporting a model sends nothing. Direct sending still checks idle state, linked Spoolman assignments, expired/changed reviews and read-back verification. A paused printer can be inspected, but all send selections remain disabled. The address is kept in session storage for this tab; API keys are never saved.

When browser local-network or CORS rules block the public page, the local launcher serves the same app and proxies only the existing restricted metadata operations. `--review` selects the review build; `--recolour` opens Full Spectrum instead of the converter. Printer security settings are not changed.

Validation for 2.6.10:

- Deterministic packing, quantities, tower/edge/spacing clearance, height limits and impossible-layout blocking.
- Negative volumes and component transforms survive packed native Snapmaker, Bambu and Orca exports.
- Main-converter printer palettes match export after slot ordering and cleanup.
- Browser test of the supplied pumpkin: three original sets fit using separate object boxes; a custom five-body, 21-object arrangement exported with the selected quantities, original orientation/scale/vertices, four colours, source layer height and supports.
- Desktop/mobile browser rendering, preview and download; mocked partial-slot printer review, explicit send, unchanged unused slots, verification, changed-palette invalidation and printing block.

The new pumpkin export has not been physically printed or sliced in Snapmaker Orca as part of these checks. No real printer settings were changed during testing.
