**iDither follow-up: what to bring into YAB3D next**

Checked 4 November 2026 against the three supplied videos, the current wiki, the downloadable U1 coaster project and Bambu's exact PLA Palette product page. This supplements the [Full Spectrum roadmap](full-spectrum-next-steps-2026-11-04.md) and [2.6.38 implementation record](full-spectrum-release-2.6.38.md). Workbench 2.6.39 repairs preview recovery and the quantity panel; it does not add the optical methods proposed here.

The useful direction is one workflow with three starting choices: **keep the model's solid colours**, **use my existing reels**, or **use a named mixing pack**. Each should lead to the same reversible preview, editing tools and native project export. CMYK/CMYKW deserves a prominent route without removing exact solid-colour printing.

Implementation update: [2.6.40](full-spectrum-release-2.6.40.md) delivers the verified catalogue update and the first reversible pack-comparison improvements below. Its optional importance control weights whole source colours; it is not the regional brush proposed in priority 3. Physical optical validation remains outstanding.

**What the videos demonstrate**

| Source and evidence | Takeaway for YAB3D |
| --- | --- |
| [Three toolheads and PETG supports](https://www.youtube.com/watch?v=RrOnknBSEO8), inspected at key frames around 0:25–0:59 and 1:19–1:29. A four-colour palette becomes a three-colour palette with a visibly different prediction; PETG is then assigned to the fourth filament and support interface in the slicer. No transcript was available. | The core three-PLA-plus-PETG workflow already exists in YAB3D. Improve its explanation: show exactly which model colours deteriorate when a reel is removed, allow another choice immediately, and make the exported interface assignment inspectable. This video alone does not validate our support settings or the user's historical failed print. |
| [Recolour any file](https://www.youtube.com/watch?v=IYtByVtZcII), transcript reviewed. Around 1:05–1:38, the author prefers a black-containing set for eyes and a mouth; a white-containing set predicts purplish dark detail. Around 2:34, the author compares that result with a physical print. | Compare important details as well as overall colour error. Offer a close view of faces or logos when choosing CMYK versus CMYW. The actual product set and calibration matter; swapping a neutral reel is not guaranteed to preserve dark detail. |
| [Model-to-print walkthrough](https://www.youtube.com/watch?v=6YPYYhtjcrk), transcript reviewed. Around 2:31–2:48 an FBX import requests its texture images; around 3:05–3:52 the user compares a palette and opens the exported project in Orca. At 3:24 the author notes that the preview was outdated. | Finish import with useful dependency prompts, keep the comparison beside the model, and hand over a configured native project. YAB3D supports painted 3MF, GLB and OBJ ZIP, but not this FBX dependency workflow. Predictions must remain labelled estimates until validated. |

**Additional wiki features**

The [iDither wiki](https://idither.com/wiki.php#focus-brush) describes a Focus Brush that weights a selected region during palette ranking, a Colour Threshold for simplifying small colour variations, ordered outer/inner-wall mixing, top-surface interweave, and Variable Optical Layers with subdivision disabled. These are distinct controls with different construction requirements. Some wiki capability statements differ from newer pages, so export compatibility needs checking against an actual downloaded project.

For YAB3D, region weighting should extend the existing exact-colour priorities. Colour simplification should have its own reversible detail preview. The remaining optical methods need separate generators, compatibility checks and print samples; adding similarly named switches to the current recipe exporter would not implement them.

**What the coaster file actually contains**

I inspected the U1 project downloaded from the [official coaster demo](https://idither.com/coaster). Its metadata specifies a Snapmaker U1 with 0.4 mm nozzles, four physical PLA Full Spectrum filaments, 0.08 mm regular layers and a 0.28 mm first layer. `dithering_local_z_mode` and `mixed_filament_advanced_dithering` are both `0`.

It has one model object with 15 parts, including separate coloured caps/undersides, artwork, a roof, coloured wall pieces, backing and an infill core. Parts carry different wall and shell settings. This is evidence of a deliberately constructed multi-part optical example, not proof that the same process works on arbitrary figurines. I have not sliced or physically printed this downloaded project.

The relevant YAB3D experiment is a small flat-art generator with explicit coloured geometry and preserved part settings, followed by sliced-path and physical comparison. Keep it separate from our existing virtual blend recipes. The demo also reinforces why a general default of enabling subdivision for every kind of colour output would be wrong.

**The exact Bambu pack**

The user's [PLA Palette CMYKW product](https://uk.store.bambulab.com/products/pla-palette-cmykw) is a retail set of five 1 kg reels. Bambu identifies CMYW as opaque and the black reel as translucent. Its [official swatch PDF](https://store.bblcdn.com/s7/default/8a89cc11c9ce4421a9593f9ee9580982/Bambu_PLA_Palette_Hex_Code.pdf) supplies these display colours:

| Product | Display hex |
| --- | --- |
| Cyan | `#0090DA` |
| Magenta | `#E24585` |
| Yellow | `#FCE300` |
| Key | `#000000` |
| White | `#FFFFFF` |

These are display swatches, not measured blend recipes. Full CMYKW needs five available physical inputs. A four-input U1 needs a deliberate subset; reserving PETG leaves three model inputs. AMS compatibility alone does not establish that any particular printer setup can use all five simultaneously.

YAB3D 2.6.39 still carries the earlier conservative Bambu entries as curated combinations with nominal CMY swatches. The next catalogue revision should use this verified retail identity and official swatches, retain stable product IDs, record the black reel's different optical class, and continue to say that YAB3D's mixtures are unmeasured. A CMYW subset should remain distinct from the complete five-reel retail pack. Saved calibration must not silently transfer when the products or construction change.

**Recommended implementation order**

| Priority | User-visible result | Completion evidence |
| --- | --- | --- |
| 1. Accurate bundle profiles | Select the exact pack and edition, see its physical input requirement, and compare CMYK, CMYW or CMYKW where the hardware permits. Update the Bambu catalogue from the newly supplied source. | Stable identity through rearrangement/export; official swatches and optical classes; estimates distinguished from measured mixtures. |
| 2. Better colour decisions | Keep solid colours, use owned reels or choose a pack in the same Colours panel. Show a few useful candidates and a close-up of altered details. Removing a reel or reserving PETG immediately updates the comparison. | Repeated comparisons preserve camera, selection, layout and Undo; no automatic workspace reset or silent palette application. |
| 3. Important-region selection | Brush over a face, logo or another important region and give it more weight when choosing a palette. | Ranking changes for a controlled example while source geometry and unselected paint remain intact. |
| 4. Calibrated predictions | Measure the actual pack with separate wall and roof samples; retain printer, layers, wall construction and provenance. | Held-out samples and photographs under consistent lighting; no profile reused across incompatible products or settings. |
| 5. A meaningful speed/detail choice | Simplify tiny colour patches reversibly and distinguish colour error from estimated printing cost. | Compare current-slicer toolpaths, time and material usage. A recipe count or an unexplained multiplier is not a time prediction. |
| 6. Separate optical experiments | Start with a reproducible flat-art sample, then investigate ordered walls and optical layer schedules individually. | Closed geometry, correct part settings, compatible sliced paths and measured physical results for each method before normal release. |
| 7. More dependable imports and examples | Add an FBX-plus-textures path if demand warrants it, along with small named reference projects for existing formats. | Missing textures are explained; dependencies resolve predictably; sample projects record exact reels and settings. |

Items 1–5 build on the existing product catalogue, reversible previews, PETG mapping, calibration inputs and native export. Items 6–7 introduce substantial new capabilities. None of the research establishes an accuracy or print-time advantage for either application without equivalent physical tests.

The next useful print comparison is the Grinch plus wall/roof and supported-detail coupons using the exact Bambu pack when it arrives. Compare a direct solid-colour version against a bundle-driven version, recording slicer versions, effective settings, time, material and photographs. Keep subdivision as a separate variable. This gives the new optical work a reproducible baseline instead of relying on screenshots or palette scores.
