const snapshot=s=>({copies:s.copies,quantities:{...s.quantities},arrangement:s.arrangement,...Object.fromEntries(['spacing','width','depth','tower'].filter(k=>s.layout?.[k]!==undefined).map(k=>[k,s.layout[k]]))});
export function plateHistory(getState){
  let key,previous,stack=[];const plates=new Map();
  const stamp=x=>JSON.stringify(x);
  function observe(){const s=getState(),next=snapshot(s);if(s.key!==key){if(key)plates.set(key,{stack,previous});key=s.key;const saved=plates.get(key);stack=saved?.stack || [];previous=saved?.previous || next;if(plates.size>50)plates.delete(plates.keys().next().value);}if(stamp(next)!==stamp(previous)){if(previous)stack.push(previous);if(stack.length>30)stack.shift();previous=next;}}
  return {observe,reset(){const s=getState();key=s.key;previous=snapshot(s);stack=[];},get canUndo(){observe();return stack.length>0;},apply(patch){observe();getState().apply(patch);observe();},undo(){observe();if(!stack.length||getState().busy)return false;const last=stack.pop();getState().apply(last);previous=snapshot(getState());return true;}};
}
