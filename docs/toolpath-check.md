# Checking a sliced file against the model

`tools/check-built-in-toolpaths.mjs` compares sliced G-code with the exported 3MF and reports which reel the slicer put on each stretch of visible outer wall. It needs Node and a sliced file; it does not need the app.

**A toolpath check shows where the slicer puts each reel. It says nothing about the colour of a print.**

## Slice from the command line (Windows)

```
"C:/Program Files/Snapmaker_Orca/snapmaker-orca.exe" --arrange 0 --orient 0 --slice 0 --outputdir <folder> <exported.3mf>
```

Or slice in the app and export the G-code.

## Blends from the slicer's table: Baked colours and the Fine blend profile

```
node tools/check-built-in-toolpaths.mjs <plate.gcode> --model <exported.3mf> --blends
```

These exports leave the model painted with blend numbers and put each blend's layer pattern in the slicer's blend table. For every blend written as a layer pattern, the check looks at its visible outer wall layer by layer and asks whether the reel used is the one the pattern names. It tries every starting layer of the pattern and reports the best, so it does not assume where the slicer starts counting.

- **PASS**: at least 99% of the judged wall follows the pattern at one starting layer.
- **FAIL**: it does not, at any starting layer. The slicer is not reading the row as written.
- Blends written as plain ratios (two reels with Subdivide Mix Layer) are listed with the share of each reel, not judged by layer.
- Only the outer wall is judged, so the Fine blend profile's inner-wall pattern is not checked.

## Models with reels painted in directly

```
node tools/check-built-in-toolpaths.mjs <plate.gcode> --model <exported.3mf>
```

Each outer-wall move is judged against the reel painted on the model beside it. This is the mode the Built-in colours work uses.

## Where this came from

The checker and the dual-wall fix in 2.6.87 were brought across from the Built-in colours draft (pull request 22). The Built-in colours engine itself is not on main.
