import test from 'node:test';
import assert from 'node:assert/strict';
import {facesInBrush,focusWeights,focusFingerprint,triangleArea} from '../shared/focusRegions.js';
import {scoreColourOutcome} from '../shared/colourPriorities.js';
import {recommendWorkflow} from '../shared/recommend.js';

test('brush samples only non-background frontmost IDs, with bottom-up and CSS scaling handled',()=>{
  const pixels=new Uint8Array(4*4*4);
  // Top-left is face 8; bottom-right is face 1. Zero is empty background.
  pixels[(3*4)*4]=9;pixels[3*4]=2;
  assert.deepEqual([...facesInBrush(pixels,4,4,8,8,1,1,1)], [8]);
  assert.deepEqual([...facesInBrush(pixels,4,4,8,8,7,7,1)], [1]);
  assert.equal(facesInBrush(pixels,4,4,8,8,4,4,1).size,0);
  assert.equal(facesInBrush(pixels,4,4,0,8,1,1,1).size,0);
});

test('marked weights count each source facet once, excluding absent and changed surfaces',()=>{
  const marks=[['a',2,'#FFFFFF',2],['a',2,'#FFFFFF',2],['b',4,'#FF0000',90],['a',5,'#FFFFFF',1],['a',6,'#000000',NaN]];
  assert.deepEqual(focusWeights(marks,[{focusKey:'a'},{focusKey:'a'}]),{'#FFFFFF':3});
  assert.deepEqual(focusWeights(marks,[{focusKey:'changed'}]),{});
  const p=new Float32Array([0,0,0,2,0,0,0,2,0]),s=new Int32Array([1]);
  assert.equal(triangleArea(p,0),2);
  assert.equal(focusFingerprint(p,s),focusFingerprint(p.slice(),s.slice()));
  assert.notEqual(focusFingerprint(p,s),focusFingerprint(p,new Int32Array([2])));
});

test('a small marked detail can outrank a dominant surface without changing either mapping',()=>{
  const a=[{original:'#FF0000',result:'#FF0000'},{original:'#FFFFFF',result:'#CCCCCC'}];
  const b=[{original:'#FF0000',result:'#FF5555'},{original:'#FFFFFF',result:'#FFFFFF'}];
  const before=structuredClone([a,b]),weights={'#FF0000':1000,'#FFFFFF':1};
  assert.ok(scoreColourOutcome(a,weights)<scoreColourOutcome(b,weights));
  assert.ok(scoreColourOutcome(a,weights,[],{'#FFFFFF':1})>scoreColourOutcome(b,weights,[],{'#FFFFFF':1}));
  assert.deepEqual([a,b],before);
});

test('regional priorities reach the real recommendation ranking and retain bundle identity',()=>{
  const sources={1:'#FF0000',2:'#FFFFFF'},weights={'#FF0000':1000,'#FFFFFF':1};
  const bundles=[{id:'red',reels:['#FF0000','#CCCCCC'].map(color=>({color,type:'PLA'}))},{id:'white',reels:['#FF5555','#FFFFFF'].map(color=>({color,type:'PLA'}))}];
  const input={sources,weights,bundles,capacity:2,blends:false};
  assert.equal(recommendWorkflow(input).bundleId,'red');
  assert.equal(recommendWorkflow({...input,focusWeights:{'#FFFFFF':1}}).bundleId,'white');
  assert.equal(recommendWorkflow(input).bundleId,'red','clearing marks restores the original ranking');
});
