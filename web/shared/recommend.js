// Bounded palette search. Swatches estimate appearance, not physical calibration.
import { distance, norm } from './colour.js';
import { colourName } from './assignment.js';
import { mixHex, planMixtures, RATIOS, MIN_IMPROVEMENT, POOR_COVERAGE } from './mix.js';

const BASICS = ['#FFFFFF','#000000','#808080','#FF0000','#0080C0','#0000FF',
  '#008000','#00FF00','#FFFF00','#FF9500','#00FFFF','#FF00FF','#800080','#8B4513','#FFC0CB'];
const objective = errors => errors.reduce((a,b)=>a+b,0)/errors.length + .35*Math.max(...errors);

export function paletteScore(sources, reels, blends = true) {
  const plan = planMixtures(sources, reels);
  const errors = plan.rows.map(row => blends && row.choice === 'mixture' ? row.mixture.error : row.solid.error);
  return errors.length && errors.every(Number.isFinite) ? objective(errors) : Infinity;
}

export function recommendPalette({ sources, loaded, stock = null, locked = [], blends = true }) {
  const colours = [...new Set(Object.values(sources || {}).map(norm).filter(Boolean))];
  if (!colours.length) throw Error('Select a model with readable colours to get recommendations.');
  if (loaded.length !== 4) throw Error('Recommendations currently need four loaded slots.');
  const lockedTypes = new Set(loaded.filter((_,i)=>locked[i]).map(r=>r.type));
  if (lockedTypes.size > 1) throw Error('Locked slots use different materials. Keep one material locked to recommend a matching set.');
  const fixedType = [...lockedTypes][0];
  const rough = stock === null;
  const candidates = rough
    ? [...new Set([...colours,...BASICS])].map(color=>({color,type:fixedType || loaded[0].type,name:colourName(color)}))
    : stock;
  const types = fixedType ? [fixedType] : [...new Set(candidates.map(r=>r.type))].sort();
  let best = null;
  for (const type of types) {
    const seen = new Set();
    let pool = candidates.filter(r=>r.type===type && norm(r.color)).map(r=>({...r,color:norm(r.color)}))
      .filter(r=>{ if(seen.has(r.color)) return false; seen.add(r.color); return true; });
    // Retain candidates close to every source, then the strongest overall. Search
    // is intentionally bounded rather than claiming a globally optimal palette.
    const ranked = pool.map((r,index)=>({r,index,errors:colours.map(c=>distance(c,r.color))}));
    const selected = new Set();
    for (let n=0;n<2;n++) for (let c=0;c<colours.length && selected.size<24;c++) {
      const row = [...ranked].sort((a,b)=>a.errors[c]-b.errors[c] || a.index-b.index)[n];
      if(row) selected.add(row.index);
    }
    for (const row of ranked.sort((a,b)=>objective(a.errors)-objective(b.errors) || a.index-b.index)) {
      if(selected.size>=24) break; selected.add(row.index);
    }
    pool = [...selected].map(index=>pool[index]);
    // Locks belong to physical positions and can be absent from imported stock.
    const fixed = loaded.map((r,i)=>locked[i] ? {...r,name:r.name || colourName(r.color),locked:true} : null);
    for(const r of fixed.filter(Boolean)) if(!pool.some(p=>p.color===norm(r.color))) pool.push({...r,color:norm(r.color)});
    if (pool.length < 4 && locked.filter(Boolean).length < 4) continue;
    const solid = pool.map(r=>colours.map(c=>distance(c,r.color)));
    const pairs = new Map();
    function pair(a,b) {
      // Match the export's slot ordering: the polynomial need not be symmetric.
      const key = `${a},${b}`;
      if(!pairs.has(key)) {
        const shades=RATIOS.map(p=>mixHex(pool[a].color,pool[b].color,p));
        pairs.set(key,colours.map(c=>Math.min(...shades.map(shade=>distance(c,shade)))));
      }
      return pairs.get(key);
    }
    function score(ids) {
      const present=ids.filter(i=>i!==null);
      if(!present.length) return Infinity;
      return objective(colours.map((_,c)=>{
        const direct=Math.min(...present.map(i=>solid[i][c]));
        let mixed=Infinity;
        if(blends && direct>.5) for(let a=0;a<ids.length;a++) for(let b=a+1;b<ids.length;b++) {
          if(ids[a]!==null && ids[b]!==null) mixed=Math.min(mixed,pair(ids[a],ids[b])[c]);
        }
        return mixed<=POOR_COVERAGE && direct-mixed>=MIN_IMPROVEMENT ? mixed : direct;
      }));
    }
    let ids=fixed.map(r=>r ? pool.findIndex(p=>p.color===norm(r.color)) : null);
    for(let slot=0;slot<4;slot++) if(ids[slot]===null) {
      let chosen=null, cost=Infinity;
      for(let i=0;i<pool.length;i++) if(!ids.includes(i)) {
        const trial=ids.slice(); trial[slot]=i; const value=score(trial);
        if(value<cost) {cost=value;chosen=i;}
      }
      ids[slot]=chosen;
    }
    if(ids.some(i=>i===null)) continue;
    for(let pass=0;pass<3;pass++) {
      let changed=false;
      for(let slot=0;slot<4;slot++) if(!locked[slot]) {
        let cost=score(ids), next=ids;
        for(let i=0;i<pool.length;i++) if(!ids.includes(i)) {
          const trial=ids.slice(); trial[slot]=i; const value=score(trial);
          if(value<cost-1e-7) {cost=value;next=trial;}
        }
        if(next!==ids) {ids=next;changed=true;}
      }
      if(!changed) break;
    }
    const reels=ids.map((id,i)=>fixed[i] || {...pool[id]});
    const cost=paletteScore(sources,reels,blends); // Respect the actual recipe cap.
    if(!best || cost<best.score) best={reels,score:cost,type};
  }
  if(!best) throw Error('Not enough distinct colours in one material to recommend four slots. Unlock a slot or add more available filaments.');
  const loadedScore=paletteScore(sources,loaded,blends);
  const current=loaded.map((r,i)=>locked[i] || rough ? {...r,name:r.name || colourName(r.color)}
    : candidates.find(c=>c.type===r.type && norm(c.color)===norm(r.color)));
  if(current.every(Boolean) && new Set(current.map(r=>r.type)).size===1 && loadedScore<=best.score) {
    best={reels:current,score:loadedScore,type:current[0].type};
  }
  return {...best,rough,loadedScore};
}
