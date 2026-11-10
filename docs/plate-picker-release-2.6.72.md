# Workbench 2.6.71 – 2.6.72 — large projects

## 2.6.71 — higher limits

Single-project limits were raised from 96 MB to 512 MB for the file and from 256 MB to 480 MB for each unpacked member. Batch conversion keeps 96 MB per file. Note that the reader also stops when everything it unpacks together passes 512 MB, so a very large multi-plate project can still be refused when opened whole.

## 2.6.72 — plate picker

`experiments/workbench/project-trim.js` reads a project in two passes. The first skips every `3D/Objects/*.model` file and any G-code, and reads only the root model, the settings and the thumbnails, which is enough to list plates, their objects, the model files each needs, and those files' unpacked sizes from the archive directory. The second pass reads only the model files the chosen plates need and writes a new project: unchosen plates, their objects, build items, relationships, thumbnails and assembly records are removed; nothing in a kept object is rewritten.

The picker is offered when a `.3mf` of at least 40 MB has two or more plates with objects stored in separate model files. Anything else, including a project whose geometry sits inside the root model, opens as before. It is asked for files the user opens or drops, in either colour method, and not for internal reloads after a model edit, a switch of colour method, or a restored session.

## Validation

- 4 new tests: listing without reading model files; a trimmed project that reads back with only the chosen plate, identical kept model files and the same colours in use; keeping several plates; and fallbacks for files that cannot be split, including the repository's two-plate fixture.
- 116 Workbench tests and 169 web tests pass. `web/tests/real_file.test.mjs` fails as before.
- Headless Chromium, synthetic 55 MB project with six plates of 29 MB each: the list appeared in about 0.1 s; Cancel left the workspace untouched; choosing two plates opened in about 6 s with exactly those plates; export downloaded; after a reload, Reopen restored the trimmed project without asking again.

## Not tested

- The 187 MB project that prompted this work. Whether it lists depends on it storing objects in separate model files, which slicer projects normally do.
- Projects where one object file is shared by objects on different plates, beyond the repository fixture.
- A chosen plate whose own model unpacks to more than 480 MB; that is still refused.
