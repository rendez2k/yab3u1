import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RUNNER_SOURCE} from '../shared/optimiserRunner.js';

test('local runner requires real G-code output and explicit sequential mode evidence',t=>{
  const available=spawnSync('python',['--version']);
  if(available.error?.code==='ENOENT'){t.skip('Python 3 is not installed');return;}
  const folder=mkdtempSync(join(tmpdir(),'yab3d-runner-test-'));
  try {
    const runner=join(folder,'runner.py');writeFileSync(runner,RUNNER_SOURCE);
    const code=String.raw`
import runpy, sys, pathlib, zipfile
scope=runpy.run_path(sys.argv[1])
timing=scope['timing']; output=scope['output_timing']
base=pathlib.Path(sys.argv[2])
t=timing('; model printing time: 1h; total estimated time: 1h 2m\n')
assert t['seconds']==3720 and t['toolChanges'] is None and not t['clearanceChecked']
assert timing('; total estimated time: 30m\n; print_sequence = by object\n')['clearanceChecked']
try:
    output(base)
    raise AssertionError('Empty output accepted')
except ValueError as e:
    assert 'no single-plate' in str(e)
with zipfile.ZipFile(base/'sliced.3mf','w') as z:
    z.writestr('Metadata/plate_1.gcode','; total estimated time: 2h\n')
assert output(base)['seconds']==7200
with zipfile.ZipFile(base/'sliced.3mf','w') as z:
    z.writestr('Metadata/plate_1.gcode','; total estimated time: 2h\n')
    z.writestr('Metadata/plate_2.gcode','; total estimated time: 3h\n')
try:
    output(base)
    raise AssertionError('Ambiguous multi-plate timing accepted')
except ValueError:
    pass
`;
    const result=spawnSync('python',['-c',code,runner,folder],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr||result.stdout);
  } finally {rmSync(folder,{recursive:true,force:true});}
});
