import {distance,norm} from './colour.js';

/** Priorities affect comparison only; they never repaint, alter geometry or force a reel. */
export function scoreColourOutcome(rows,weights={},importantColours=[]) {
  const important=new Set(importantColours.map(norm)), errors=rows.map(row=>({color:norm(row.original),error:distance(row.original,row.result)}));
  if(!errors.length)return 0;
  let total=0,weighted=0;
  for(const {color,error} of errors){const n=Number(weights[color]),weight=Number.isFinite(n)&&n>0?n:1;total+=weight;weighted+=error*weight;}
  const accents=errors.filter(row=>important.has(row.color));
  return weighted/total+.15*Math.max(...errors.map(row=>row.error))
    +(accents.length?2*accents.reduce((sum,row)=>sum+row.error,0)/accents.length:0);
}
