const snapshot=s=>({copies:s.copies,quantities:{...s.quantities},arrangement:s.arrangement,...Object.fromEntries(['spacing','width','depth','tower'].filter(k=>s.layout?.[k]!==undefined).map(k=>[k,s.layout[k]]))});
export function plateHistory(getState){
  let key,previous,stack=[],redo=[];const plates=new Map();
  const stamp=x=>JSON.stringify(x);
  function observe(){const s=getState(),next=snapshot(s);if(s.key!==key){if(key)plates.set(key,{stack,previous,redo});key=s.key;const saved=plates.get(key);stack=saved?.stack || [];redo=saved?.redo || [];previous=saved?.previous || next;if(plates.size>50)plates.delete(plates.keys().next().value);}if(stamp(next)!==stamp(previous)){if(previous)stack.push(previous);if(stack.length>30)stack.shift();previous=next;redo=[];}}
  return {observe,reset(){const s=getState();key=s.key;previous=snapshot(s);stack=[];redo=[];},get canRedo(){observe();return redo.length>0;},get canUndo(){observe();return stack.length>0;},apply(patch){observe();getState().apply(patch);observe();},undo(){observe();if(!stack.length||getState().busy)return false;const last=stack.pop();redo.push(snapshot(getState()));getState().apply(last);previous=snapshot(getState());return true;},
    // Redo replays an undone plate edit; any new edit clears it.
    redo(){observe();if(!redo.length||getState().busy)return false;const next=redo.pop();stack.push(snapshot(getState()));getState().apply(next);previous=snapshot(getState());return true;}};
}
