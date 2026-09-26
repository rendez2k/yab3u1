// Search complete four-reel sets, including the shades their pairs can produce.
// Search is exhaustive within a bounded, colour-diverse candidate pool.
import { distance, norm, toLab } from './colour.js';
import { colourName } from './assignment.js';
import { describeColourMapping, mappingFromPlan, planBlends, RATIOS, MIN_IMPROVEMENT, POOR_COVERAGE } from './mix.js';
import { mixFdmHex, approximateDistance } from './fdmMix.js';

const BASICS=['#FFFFFF','#000000','#808080','#FF0000','#0080C0','#0000FF',
  '#008000','#00FF00','#FFFF00','#FF9500','#00FFFF','#FF00FF','#800080','#8B4513','#FFC0CB'];
const objective=errors=>errors.reduce((a,b)=>a+b,0)/errors.length+.35*Math.max(...errors);
const tenth=value=>Math.round(value*10)/10;
const material=reel=>String(reel.type || 'PLA').trim().toUpperCase();
function outcomeFor(sources,reels,blends,approximate=false,calibration=null) {
  const plan=planBlends(sources,reels,approximate,null,calibration);
  const outcome=describeColourMapping(sources,{
    mapping:mappingFromPlan(plan,blends),physical:reels,kept:blends ? plan.recipes : [],
  },blends);
  const errors=plan.rows.map(row=>blends && row.choice==='mixture' ? row.mixture.error : row.solid.error);
  return {outcome,approximate,unresolved:outcome.counts.unresolved,score:outcome.counts.unresolved*1000+objective(errors)};
}
export function paletteScore(sources,reels,blends=true) {
  return outcomeFor(sources,reels,blends).score;
}

export function recommendPalette({sources,loaded,stock=null,locked=[],blends=true}) {
  const colours=[...new Set(Object.values(sources || {}).map(norm).filter(Boolean))];
  if(!colours.length) throw Error('Select a model with readable colours to get recommendations.');
  if(loaded.length!==4) throw Error('Recommendations currently need four loaded slots.');
  const fixedTypes=new Set(loaded.filter((_,i)=>locked[i]).map(material));
  if(fixedTypes.size>1) throw Error('Locked slots use different materials. Keep one material locked to recommend a matching set.');
  const fixedType=[...fixedTypes][0], rough=stock===null;
  const candidates=(rough
    ? [...new Set([...colours,...BASICS,...loaded.map(r=>norm(r.color))])].map(color=>({color,type:fixedType || material(loaded[0]),name:colourName(color)}))
    : stock).filter(r=>norm(r.color)).map(r=>({...r,color:norm(r.color),type:material(r)}));
  const types=fixedType ? [fixedType] : [...new Set(candidates.map(r=>r.type))].sort();
  const options=[], approximations=[];
  const search={evaluated:0,candidates:0,bounded:false};
  for(const type of types) {
    let pool=[...new Map(candidates.filter(r=>r.type===type).map(r=>[r.color,r])).values()];
    // Keep exact/near source colours, then spread the rest across colour space.
    // This retains potential mixing ingredients even when poor individual matches.
    if(pool.length>32) {
      search.bounded=true;
      const selected=new Set();
      for(const color of colours) {
        if(selected.size>=16) break;
        const best=pool.map((r,i)=>({i,d:distance(color,r.color)})).sort((a,b)=>a.d-b.d)[0];
        selected.add(best.i);
      }
      while(selected.size<32) {
        let best=-1,spread=-1;
        for(let i=0;i<pool.length;i++) if(!selected.has(i)) {
          const d=Math.min(...[...selected].map(j=>distance(pool[i].color,pool[j].color)));
          if(d>spread) {spread=d;best=i;}
        }
        selected.add(best);
      }
      pool=[...selected].map(i=>pool[i]);
    }
    const fixed=loaded.map((r,i)=>locked[i] ? {...r,color:norm(r.color),type,name:r.name || colourName(r.color)} : null);
    for(const r of fixed.filter(Boolean)) if(!pool.some(p=>p.color===r.color)) pool.push(r);
    search.candidates+=pool.length;
    const ids=fixed.map(r=>r ? pool.findIndex(p=>p.color===r.color) : null);
    const free=ids.flatMap((id,i)=>id===null ? [i] : []);
    const available=pool.map((_,i)=>i).filter(i=>!ids.includes(i));
    if(available.length<free.length) continue;
    const sourceLabs=colours.map(toLab);
    const solid=pool.map(r=>sourceLabs.map(c=>distance(c,r.color)));
    const pairs=new Map();
    function pair(a,b) {
      const lo=Math.min(a,b),hi=Math.max(a,b),key=lo+','+hi;
      if(!pairs.has(key)) {
        const shades=RATIOS.map(percent=>({percent,lab:toLab(mixFdmHex(pool[lo].color,pool[hi].color,percent))}));
        pairs.set(key,sourceLabs.map(c=>{
          const best=shades.map(r=>({error:distance(c,r.lab),key:key+','+r.percent})).sort((x,y)=>x.error-y.error)[0];
          best.approx=shades.map(r=>({error:approximateDistance(c,r.lab),key:key+','+r.percent})).sort((x,y)=>x.error-y.error)[0];
          return best;
        }));
      }
      return pairs.get(key);
    }
    const finalists=[], approximateFinalists=[];
    function evaluate() {
      search.evaluated++;
      const errors=[], approximateErrors=[], recipes=new Set();
      let approximate=false;
      for(let c=0;c<colours.length;c++) {
        const direct=Math.min(...ids.map(i=>solid[i][c]));
        if(!blends || direct<=.5) {errors.push(tenth(direct));approximateErrors.push(tenth(direct));continue;}
        let best=null,approxBest=null;
        for(let a=0;a<4;a++) for(let b=a+1;b<4;b++) {
          if(ids[a]===ids[b]) continue;
          const candidate=pair(ids[a],ids[b])[c];
          if(!best || candidate.error<best.error) best=candidate;
          if(!approxBest || candidate.approx.error<approxBest.error) approxBest=candidate.approx;
        }
        if(!best) return;
        if(tenth(best.error)>POOR_COVERAGE || tenth(tenth(direct)-tenth(best.error))<MIN_IMPROVEMENT) approximate=true;
        recipes.add(best.key);
        if(recipes.size>6) return; // Same recipe ceiling as the export planner.
        errors.push(tenth(best.error));
        approximateErrors.push(tenth(approxBest.error));
      }
      const score=objective(approximate ? approximateErrors : errors);
      const list=approximate ? approximateFinalists : finalists;
      if(list.length<48 || score<list.at(-1).score) {
        list.push({ids:ids.slice(),score}); list.sort((a,b)=>a.score-b.score);
        if(list.length>48) list.pop();
      }
    }
    function visit(start,depth) {
      if(depth===free.length) {evaluate();return;}
      for(let n=start;n<=available.length-(free.length-depth);n++) {
        ids[free[depth]]=available[n]; visit(n+1,depth+1);
      }
    }
    visit(0,0);
    for(const finalist of finalists) {
      const reels=finalist.ids.map((id,i)=>fixed[i] || {...pool[id]});
      const result=outcomeFor(sources,reels,blends);
      if(!result.unresolved) options.push({reels,type,...result});
    }
    for(const finalist of approximateFinalists) {
      const reels=finalist.ids.map((id,i)=>fixed[i] || {...pool[id]});
      const result=outcomeFor(sources,reels,true,true);
      if(!result.unresolved) approximations.push({reels,type,...result});
    }
  }
  const loadedScore=paletteScore(sources,loaded,blends);
  const current=loaded.map((r,i)=>rough || locked[i] ? {...r,type:material(r),name:r.name || colourName(r.color)}
    : candidates.find(c=>c.type===material(r) && c.color===norm(r.color)));
  if(current.every(Boolean) && new Set(current.map(r=>r.type)).size===1) {
    const result=outcomeFor(sources,current,blends);
    if(!result.unresolved) options.unshift({reels:current,type:current[0].type,...result});
  }
  // Loaded reels are explicitly available even if absent from the stock library.
  if(blends && new Set(loaded.map(material)).size===1 && outcomeFor(sources,loaded,true).unresolved) {
    const result=outcomeFor(sources,loaded,true,true);
    if(!result.unresolved) approximations.unshift({reels:loaded.map(r=>({...r,name:r.name || colourName(r.color)})),type:material(loaded[0]),usesLoaded:true,...result});
  }
  const unique=new Map();
  for(const option of options.sort((a,b)=>a.score-b.score)) {
    const key=option.type+':'+option.reels.map(r=>norm(r.color)).sort().join(',');
    if(!unique.has(key)) unique.set(key,option);
  }
  const ranked=[...unique.values()].slice(0,6);
  const approximateUnique=new Map();
  for(const option of approximations.sort((a,b)=>a.score-b.score)) {
    const key=option.type+':'+option.reels.map(r=>norm(r.color)).sort().join(',');
    if(!unique.has(key) && (!approximateUnique.has(key) || option.usesLoaded)) approximateUnique.set(key,option);
  }
  const approximateOptions=[...approximateUnique.values()].slice(0,3);
  const loadedOption=[...approximateUnique.values()].find(p=>p.usesLoaded);
  if(loadedOption && !approximateOptions.includes(loadedOption)) approximateOptions.push(loadedOption);
  if(!ranked.length) return {found:false,rough,loadedScore,alternatives:[],approximateOptions,search,
    reason:search.evaluated ? 'No suitable four-reel palette found. No set in this search covers every source colour with a matching reel or an acceptable blend.'
      : 'Not enough distinct colours in one material to search four slots. Unlock a slot or add available filaments.'};
  return {...ranked[0],found:true,rough,loadedScore,alternatives:ranked.slice(1),approximateOptions,search};
}

/** Two explicit workflows. Model-first does not use the saved printer palette. */
export function recommendWorkflow({mode='model', sources, loaded, stock=null, type='PLA', keepExact=[], weights={}, blends=true, calibration=null}) {
  const colours=[...new Set(Object.values(sources || {}).map(norm).filter(Boolean))];
  if(!colours.length) throw Error('Select a model with readable colours.');
  const options=[], approximateOptions=[];
  const search={evaluated:0,candidates:0,bounded:false};
  function consider(reels) {
    search.evaluated++;
    if(keepExact.some(color=>!reels.some(r=>norm(r.color)===norm(color)))) return;
    let result=outcomeFor(sources,reels,blends,false,calibration);
    if(result.unresolved && blends) result=outcomeFor(sources,reels,true,true,calibration);
    if(result.unresolved) return;
    const rows=result.outcome.rows;
    let total=0,error=0;
    for(const row of rows) {
      const supplied=Number(weights[norm(row.original)]);
      const weight=Number.isFinite(supplied) && supplied>0 ? supplied : 1;
      total+=weight; error+=weight*distance(row.original,row.result);
    }
    // Surface-area mean plus a worst-colour penalty protects small accents.
    result.score=error/total + .15*Math.max(...rows.map(r=>distance(r.original,r.result)));
    const option={reels:reels.map(r=>({...r})),type:reels[0].type,...result,usesLoaded:mode==='loaded'};
    (result.approximate ? approximateOptions : options).push(option);
  }
  if(mode==='loaded') {
    if(loaded.length!==4) throw Error('Set all four loaded filaments.');
    // Never search replacements in this mode, including when a library is connected.
    consider(loaded);
  } else {
    if(keepExact.length>4) throw Error('Keep at most four original colours exact; the remaining colours need blends.');
    let pool=colours.map(color=>({color,type,name:colourName(color)}));
    if(stock!==null) {
      const owned=[...new Map(stock.filter(r=>material(r)===type && norm(r.color)).map(r=>[norm(r.color),{...r,color:norm(r.color),type}])).values()];
      // Retain two closest owned options per source colour, then cap work in the worker.
      pool=[...new Map(colours.flatMap(color=>owned.slice().sort((a,b)=>distance(color,a.color)-distance(color,b.color)).slice(0,2)).map(r=>[r.color,r])).values()];
      if(pool.length>16) { pool=pool.slice(0,16); search.bounded=true; }
    }
    search.candidates=pool.length;
    if(pool.length && pool.length<4) {
      const reels=pool.slice(); while(reels.length<4) reels.push({...pool[0]});
      consider(reels);
    } else {
      const selected=[];
      function visit(start) {
        if(selected.length===4) {consider(selected);return;}
        for(let i=start;i<=pool.length-(4-selected.length);i++) {
          selected.push(pool[i]); visit(i+1); selected.pop();
        }
      }
      visit(0);
    }
  }
  const rank=(a,b)=>b.outcome.counts.preserved-a.outcome.counts.preserved || a.score-b.score;
  options.sort(rank); approximateOptions.sort(rank);
  const rough=mode==='model' && stock===null;
  const common={rough,search,loadedScore:0,alternatives:options.slice(1,6),approximateOptions:approximateOptions.slice(0,6),
    reason:mode==='loaded' ? 'These loaded reels cannot make a distinct blend for every source colour. Adjust the reels or review Solid colours in Advanced.'
      : 'No complete blend palette found with these choices. Try different Keep exact choices or turn off the owned-filaments filter.'};
  return options.length ? {...options[0],...common,found:true} : {...common,found:false};
}
