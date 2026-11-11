// The printed-sample calibration panel (calibrationPanel.js) in a minimal stand-in DOM: a
// version-3 profile (built-in colours sequences) is never enabled in Slicer blends, while a
// matching version-2 wall profile still is.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CALIBRATION_KEY, validateCalibration, BUILT_IN_CALIBRATION_REFUSAL} from '../shared/blendCalibration.js';

/** An element that answers every selector with its own child, so the panel can be driven by property. */
class Stub {
  constructor() { this.children = new Map(); this.textContent = ''; this.value = ''; this.checked = false; this.disabled = false;
    this.hidden = false; this.open = false; this.innerHTML = ''; this.dataset = {}; this.options = []; this.classList = {add() {}}; }
  querySelector(selector) { if (!this.children.has(selector)) this.children.set(selector, new Stub()); return this.children.get(selector); }
  querySelectorAll() { return []; }
  addEventListener() {}
  removeAttribute() {}
  setAttribute() {}
  scrollIntoView() {}
}
const store = new Map();
globalThis.localStorage = {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)};
const {mountCalibration} = await import('../shared/calibrationPanel.js');

const reels = ['#FF0000', '#0080C0', '#FFFFFF', '#000000'].map((color, i) => ({color, type: 'PLA', name: `Brand reel ${i + 1}`}));
const setup = {context: 'test', reels, target: 'snapmaker', nozzle: '0.4', height: 0.12, subdivideMixLayer: true};
const wall = {version: 2, surface: 'wall', revision: 1, name: 'Wall test', setup: 'U1, PLA, wall', context: 'test', reels,
  samples: [{a: 1, b: 3, percent: 50, color: '#66CC77'}]};
const v3 = {...wall, version: 3, construction: 'built-in', samples: [{sequence: [1, 3], color: '#66CC77'}]};

/** Mount the panel with a saved profile, then tick "Use these measurements". */
function enableWith(saved) {
  store.set(CALIBRATION_KEY, JSON.stringify(saved));
  const host = new Stub();
  const panel = mountCalibration(host, {getSetup: () => setup, onChange: () => {}});
  host.querySelector('[data-enable]').checked = true;
  host.querySelector('[data-enable]').onchange();
  return {panel, host, status: host.querySelector('[data-status]').textContent, coverage: host.querySelector('[data-coverage]').textContent};
}

test('a version-3 calibration file is accepted on import but never enabled', () => {
  assert.equal(validateCalibration(v3).version, 3, 'version 3 still validates');
  const {panel, host, status, coverage} = enableWith(v3);
  assert.equal(status, 'This calibration file is for built-in colours, which cannot use measured samples yet.');
  assert.equal(BUILT_IN_CALIBRATION_REFUSAL, status);
  assert.equal(panel.active(), null);
  assert.equal(host.querySelector('[data-enable]').checked, false);
  assert.doesNotMatch(coverage, /recorded recipes enabled/);
});

test('a matching version-2 wall profile can still be enabled', () => {
  const {panel, status, coverage} = enableWith(wall);
  assert.equal(status, 'Recorded measurements enabled for the matching reel set.');
  assert.equal(panel.active()?.version, 2);
  assert.match(coverage, /^1 recorded recipes enabled/);
});
