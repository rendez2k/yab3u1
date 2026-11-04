MakerWorld to Snapmaker U1 - local Chrome repair 1.5.3.3

Removes the global onDeterminingFilename override introduced in 1.5.3.2.
That override competed with IDM's own filename suggestion and caused Chrome's
extension warning. Chrome conversion now requests a normal named download link,
retaining the named File and model/3mf media type. IDM/Chrome controls the save
and completion. No extra permissions were added; the converter is unchanged.

Five targeted automated checks passed: named link, error cleanup, no global
filename listener, separate Chrome/Firefox paths, and unchanged permissions.
The new path still needs a real download check with IDM enabled.

Activate: Reload the MakerWorld extension in chrome://extensions, then refresh
MakerWorld. Existing stored error messages can be cleared; they are not proof
of a new failure. Expected output name ends in -U1.3mf.

This is an unofficial local patch, not an upstream release.
