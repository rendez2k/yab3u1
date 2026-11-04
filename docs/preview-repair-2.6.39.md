# Workbench 2.6.39 — preview and quantity-panel repair

4 November 2026.

The live Grinch workspace lost its preview because the requested 213.3 × 236.2 mm group failed the U1 layout check, including its reserved areas. The interactive preview called the same strict placement routine as export, cleared the canvas on failure, and left its error inside the Project panel.

Interactive previews now show the remaining source objects at their original positions when a requested layout cannot fit. A visible notice explains that extra copies have not been arranged and the layout needs attention before export. Removed objects remain removed. Fixing the layout restores the arranged copies and clears the warning. Geometry errors other than a rejected fit are still reported as errors.

Both Convert and Full Spectrum expose preview problems beside the canvas. Saved thumbnails and project exports retain their strict layout validation. This change does not move, scale or repair the source geometry, or make an invalid print arrangement printable.

Object quantity rows in the Workbench inspector now place the name, swatches and dimensions above the quantity controls. The previous two-column layout squeezed filenames into a narrow strip at normal desktop sidebar widths. Both colour workflows use the same corrected rows.

Validation: 14 Node test results pass across preview recovery, worker selection, Spectrum placement, layout, object layout and Workbench composition, including 13 additional layout assertions in the legacy runner. Regression coverage checks retained source positions, omitted objects, cached recolouring, restored copies and blocked thumbnail/Convert/Spectrum output. Browser checks use the local Grinch variant, a deliberately undersized layout, mode switching and a 276 px inspector content area. The original live workspace was inspected without reloading or discarding its edits.

No physical print or new slicer validation is claimed. The fix takes effect after refreshing and reopening a model.
