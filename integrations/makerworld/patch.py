"""Patch a COPY of the installed 1.5.3.3 extension. Never alters download handlers."""
import json
import pathlib
import shutil
import sys

root = pathlib.Path(sys.argv[1])
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
if manifest['version'] != '1.5.3.3':
    raise SystemExit('Expected extension 1.5.3.3; inspect a newer version before patching.')
path = root / 'content.js'
content = path.read_text(encoding='utf-8')
def replace(old, new):
    global content
    if content.count(old) != 1:
        raise SystemExit('Extension changed: expected one occurrence of ' + old[:90])
    content = content.replace(old, new)
replace('async function startConversion(btn, localFile = null)', 'async function startConversion(btn, localFile = null, yabHandoff = null)')
replace('await triggerMakerWorldDownload();', 'await triggerMakerWorldDownload(yabHandoff?.signal);')
replace('function triggerMakerWorldDownload() {', 'function triggerMakerWorldDownload(signal) {')
replace('      let finished = false;\n      let readyTimer;', '''      let finished = false;
      let readyTimer;
      const onAbort = () => fail(new Error('YAB3D transfer cancelled.'));
''')
replace('        clearTimeout(readyTimer);\n        window.removeEventListener(\'__u1_3mf\', onFile);', '''        clearTimeout(readyTimer);
        signal?.removeEventListener('abort', onAbort);
        window.removeEventListener('__u1_3mf', onFile);''')
replace("      window.addEventListener('__u1_3mf', onFile);", '''      if (signal?.aborted) { fail(new Error('YAB3D transfer cancelled.')); return; }
      signal?.addEventListener('abort', onAbort, {once:true});
      window.addEventListener('__u1_3mf', onFile);''')
anchor = '      // -------------------------------------------------------------------------\n      // 4. Read extension settings'
replace(anchor, '''      if (yabHandoff) {
        await yabHandoff.send(buffer, mwName || 'MakerWorld-model.3mf');
        _resultState = 'ready';
        return;
      }

''' + anchor)
replace('    } catch (err) {\n      const failedStage =', '''    } catch (err) {
      if (yabHandoff) {
        yabHandoff.fail(err.message || 'The original MakerWorld project could not be captured.');
        _resultState = 'ready';
        return;
      }
      const failedStage =''')
anchor = '    const primaryButton =\n      primaryButtonMatch.button;'
replace(anchor, anchor + '''

    globalThis.YAB3DModelHandoff.mount({
      button: primaryButton, busy: () => isConverting,
      capture: handoff => startConversion(findButton(), null, handoff),
    });
''')
path.write_text(content, encoding='utf-8')
manifest['version'] = '1.5.3.6'
manifest['version_name'] = '1.5.3.6 - YAB3D review handoff'
scripts = next(s['js'] for s in manifest['content_scripts'] if 'content.js' in s['js'])
scripts.insert(scripts.index('content.js'), 'yab3d-handoff.js')
(root / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
shutil.copyfile(pathlib.Path(__file__).with_name('yab3d-handoff.js'), root / 'yab3d-handoff.js')
print('Patched', root)
