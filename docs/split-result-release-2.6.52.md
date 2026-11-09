# Split result feedback — 2.6.52

An automatic split that could not separate any parts left its explanation inside the split controls. Returning to Select destroyed those controls and removed the explanation, making an unchanged model look like a completed split in its assembled position.

Completed split attempts now have a persistent, dismissible result above the tool settings. Failed attempts say **No split made** and show the first recorded reason. Successful attempts confirm the number of newly created parts only after the edited source loads. Undo, another applied model edit or opening a new source clears the previous result.

The supplied alien still fails the existing mesh check with 22 non-manifold edges. No geometry or paint is changed, and no model repair is included in this release.

Validation: 82 Workbench tests pass, including navigation after rejection, dismissal, source replacement, commit timing and Undo. Browser checks reproduce the alien rejection, retain feedback after Select and Open & convert, and verify desktop and 390 px layouts. The production build completes; the design detector reports no findings.
