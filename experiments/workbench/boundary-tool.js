export function mountBoundaryTool({root,make,source,context,ids,inspection,busy=()=>false,changed=()=>{}}){
  root.innerHTML='<p class="hint">Place points around a wrist, neck or stalk. Drag the model to reach the back; the line follows its surface.</p><button type="button" data-boundary-start>Draw boundary</button><div data-boundary-editor hidden><div class="boundary-points" aria-label="Boundary points" data-boundary-points></div><div class="boundary-actions"><button type="button" data-boundary-add>Add point</button><button type="button" data-boundary-remove>Remove point</button><button type="button" data-boundary-undo>Undo point</button></div><div class="boundary-actions"><button type="button" class="primary" data-boundary-close>Close boundary</button><button type="button" data-boundary-flip>Select other side</button></div><button type="button" data-boundary-resume hidden>Back to boundary</button><p class="hint">Select a numbered point, then click the model to move it. Keep the loop close to a flat join; Preview split checks whether it can be closed.</p></div><p class="hint boundary-status" data-boundary-status role="status" aria-live="polite"></p>';
  const q=s=>root.querySelector(s);let worker=null,dead=false,pending=false,request=0,soup=null,current={points:[],part:null,closed:false,flip:false},history=[],selected=-1,result=null,listSignature='';
  function status(text,error=false){q('[data-boundary-status]').textContent=text;q('[data-boundary-status]').dataset.error=String(error);}
  function sync(){if(dead)return;const locked=pending||busy();q('[data-boundary-editor]').hidden=!soup;q('[data-boundary-start]').hidden=Boolean(soup);q('[data-boundary-start]').textContent=pending?'Cancel boundary task':'Draw boundary';q('[data-boundary-start]').disabled=busy();
    for(const b of root.querySelectorAll('[data-boundary-editor] button'))b.disabled=locked;
    q('[data-boundary-remove]').disabled=locked||selected<0;q('[data-boundary-undo]').disabled=locked||!history.length;q('[data-boundary-close]').disabled=locked||current.closed||current.points.length<3;q('[data-boundary-flip]').disabled=locked||!current.closed;q('[data-boundary-add]').disabled=locked||current.points.length>=64;
    q('[data-boundary-resume]').hidden=!soup||inspection.owner==='boundary';
    const list=q('[data-boundary-points]'),next=`${current.points.length}|${selected}`;if(next!==listSignature){listSignature=next;list.replaceChildren();current.points.forEach((_,i)=>list.append(make('button',{type:'button','data-boundary-point':String(i),'aria-pressed':String(selected===i),'aria-label':`Move boundary point ${i+1}`},String(i+1))));}for(const b of list.children)b.disabled=locked;
  }
  function draw(){if(soup){inspection.show('boundary',soup,current.closed?'Boundary closed · preview before applying':'Place boundary points · drag to orbit',pick);inspection.boundary(current.points,result?.path||[],selected,result?.mask);}}
  function resume(){if(dead||pending||busy())return;changed();draw();sync();}
  function stop(){request++;worker?.terminate();worker=null;pending=false;soup=null;result=null;current={points:[],part:null,closed:false,flip:false};history=[];selected=-1;inspection.hide('boundary');sync();changed();}
  async function start(){
    if(dead||busy())return;if(pending){stop();status('Boundary task cancelled. Your model is unchanged.');return;}
    if(ids().length!==1){status('Select one object to draw a boundary.',true);return;}
    const file=source();if(!file)return;stop();const stamp=++request;pending=true;status('Opening the original surface…');sync();changed();
    try{const bytes=await file.arrayBuffer();if(dead||stamp!==request)return;worker=new Worker(new URL('./boundary-worker.js',import.meta.url),{type:'module'});
      worker.onerror=()=>{if(dead)return;stop();status('The boundary worker stopped. Draw the boundary again; your model is unchanged.',true);};
      worker.onmessage=({data})=>{if(dead||data.request!==request)return;pending=false;if(data.error){status(data.error,true);sync();changed();return;}soup=data.soup;status('Click the model to place the first point.');try{draw();}catch(e){stop();status(e.message,true);}sync();changed();};
      worker.postMessage({request:stamp,action:'start',bytes,objectIds:ids(),plateId:context().plateId},[bytes]);
    }catch(e){if(stamp===request){pending=false;status(e.message,true);sync();changed();}}
  }
  function update(next,{undo=false}={}){
    if(dead||pending||busy()||!soup)return;
    if(!next.points.length){if(!undo)history.push(current);else history.pop();current=next;result=null;selected=-1;draw();sync();changed();status('Click the model to place a point.');return;}
    const stamp=++request;pending=true;status('Following the surface between points…');sync();changed();
    worker.onmessage=({data})=>{if(dead||data.request!==stamp||stamp!==request)return;pending=false;
      if(data.error){status(data.error,true);sync();changed();return;}
      if(undo)history.pop();else{history.push(current);if(history.length>40)history.shift();}
      result=data.result;current={...next,points:result.anchors};if(selected>=current.points.length)selected=-1;
      status(current.closed?`Closed loop · ${result.perimeter.toFixed(1)} mm. The green region will separate. Preview split checks the join.`:`${current.points.length} point${current.points.length===1?'':'s'}. ${current.points.length<3?'Add more around the part.':'Continue around the back, then close the boundary.'}`);
      draw();sync();changed();
    };
    worker.postMessage({request:stamp,action:'trace',...next});
  }
  function pick({point,part}){
    if(dead||pending||busy())return;if(current.part!==null&&current.part!==part){status('Keep the boundary on the same mesh part. Cancel to choose another.',true);return;}
    if(selected<0&&current.closed){status('Select a numbered point to move it, or choose Add point to extend the loop.');return;}
    if(selected<0&&current.points.length>=64)return;
    const points=current.points.map(p=>p.slice());if(selected>=0)points[selected]=point;else points.push(point);update({...current,part,points});
  }
  function undo(){if(history.length&&!pending&&!busy())update(history.at(-1),{undo:true});}
  function click(e){const b=e.target.closest('button');if(!b||dead)return;
    if(b.matches('[data-boundary-start]')){start();return;}if(pending||busy())return;
    if(b.dataset.boundaryPoint!==undefined){selected=Number(b.dataset.boundaryPoint);draw();sync();status(`Click the surface to move point ${selected+1}.`);}
    if(b.matches('[data-boundary-add]')){selected=-1;if(current.closed)update({...current,closed:false});else{draw();sync();status('Click the surface to add another point.');}}
    if(b.matches('[data-boundary-remove]')&&selected>=0){const points=current.points.filter((_,i)=>i!==selected);selected=-1;update({...current,points,closed:current.closed&&points.length>=3});}
    if(b.matches('[data-boundary-undo]'))undo();
    if(b.matches('[data-boundary-close]'))update({...current,closed:true});
    if(b.matches('[data-boundary-flip]'))update({...current,flip:!current.flip});
    if(b.matches('[data-boundary-resume]'))resume();
  }
  root.addEventListener('click',click);
  return {sync,resume,undo,get canUndo(){return !pending&&history.length>0;},get pending(){return pending;},get ready(){return Boolean(soup)&&current.closed&&!pending;},options(){return {operation:'boundary-separate',boundary:{points:current.points,part:current.part,flip:current.flip}};},destroy(){dead=true;request++;worker?.terminate();inspection.hide('boundary');root.removeEventListener('click',click);}};
}
