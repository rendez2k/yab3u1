# Workbench 2.6.67 – 2.6.68

## 2.6.67 — hand placement everywhere

Full Spectrum's layout now carries the same `manual` map as Convert: it is part of `layoutSettings()`, applied by the Workbench patch, cleared when a project or plate is loaded, and passed in the context exchanged between the two colour methods. The drag tool is mounted for both.

Move, turn & resize has X and Y fields for the one selected object, pre-filled with its current centre. Move applies the same checks as a drag. The preview canvas sets `touch-action: none` so a touch drag reaches the tool.

## 2.6.68 — one workspace

The shell no longer has a start screen, a workspace picker or a "remember my choice" option. `chooseWorkspace` remains as the internal switch between the full workspace and Simple view, which is the former Quick conversion layout offered from the App menu and stored as `yab3d-view`. A stored `yab3d-workspace-choice` of `quick` is honoured once as Simple view.

Convert and Full Spectrum are still two engines, each in its own frame, with their own colour state. What changed is how they are presented: as two colour methods in Colours. Model edits, the destination, quantities and hand-placed positions carry across when the other method next loads the model.

## Validation

- 112 Workbench tests pass; production build succeeds.
- Headless Chromium with the built-in sample:
  - Convert: typing 60, 200 was refused as prime-tower space; 999, 200 was kept on the bed at 232.9, 200.
  - Switching to Full Spectrum blends kept that position; typing 150, 100 there moved the object, and Undo returned it.
  - A touch drag at 390 x 844 (CDP touch events) selected and moved the object.
  - First visit opens the workspace with no start screen; the sample loads from the empty state.
  - Simple view hides the rail, turns the header into a direct download, persists across a reload and switches back.
  - A browser with the old Quick choice stored starts in Simple view.
  - No page errors.

## Known limits

- The two colour methods still keep separate colour choices; choosing colours in one does not change the other.
- A plate layout changed in one method after the other has already loaded the model is not pushed across until the model changes.
- Hand placement was not exercised in Full Spectrum by mouse drag in this pass (typed position and Undo were); it uses the same tool.
- Touch was tested with synthetic events, not on a physical device. Two-finger gestures are unchanged.
- Not tested with real projects, the MakerWorld extension handoff, a slicer, or browsers other than Chromium.
