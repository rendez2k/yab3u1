import assert from 'node:assert/strict';
import {surfaceAreas,colourWeights} from '../shared/surfaceWeights.js';
import {recommendWorkflow} from '../shared/recommend.js';

const whole=[0,0,0,10,0,0,0,10,0]; // area 50
const split=[0,0,0,5,0,0,0,5,0, 5,0,0,10,0,0,0,10,0, 5,0,0,0,10,0,0,5,0];
assert.deepEqual(surfaceAreas(whole,[1]),{1:50});
assert.deepEqual(surfaceAreas(split,[1,1,1]),{1:50},'subdivision must not increase colour importance');
assert.deepEqual(surfaceAreas(whole.map(v=>v*2),[1]),{1:200},'scaled area is quadratic');
assert.deepEqual(surfaceAreas([...whole,...whole],[1,1]),{1:100},'instances count');
assert.deepEqual(surfaceAreas([...whole,...whole,...Array(9).fill(0)],[0,-1,3]),{1:50},'unknown and degenerate geometry does not invent weight');
assert.deepEqual(colourWeights({1:'#FFFFFF',2:'#FFFFFF',3:'#000000'},{1:10,2:15,3:1}),{'#FFFFFF':25,'#000000':1});
const sources={1:'#0080C0',2:'#FF0000',3:'#FFFFFF',4:'#000000',5:'#C5C263'};
const weights={'#0080C0':40,'#FF0000':30,'#FFFFFF':20,'#000000':10,'#C5C263':.01};
const all=r=>[...(r.found?[r,...r.alternatives]:[]),...r.approximateOptions];
const first=all(recommendWorkflow({sources,loaded:[],weights}));
const scaled=all(recommendWorkflow({sources,loaded:[],weights:Object.fromEntries(Object.entries(weights).map(([k,v])=>[k,v/100]))}));
assert.deepEqual(first.map(r=>r.reels),scaled.map(r=>r.reels),'units/model scale cannot alter ranking');
const protectedAccent=all(recommendWorkflow({sources,loaded:[],weights,keepExact:['#C5C263']}));
assert(protectedAccent.length>0);
assert(protectedAccent.every(r=>r.reels.some(reel=>reel.color==='#C5C263')),'tiny protected accents stay exact');
console.log('Surface weights: subdivision, scale, instances, invalid facets, shared colours and protected accents passed.');
