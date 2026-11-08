// Read-only joint checks use the same geometry path as Apply. No preview result
// replaces the source, and every edit invalidates the previous fit result.
export function mountJointTool({root,source,options,busy=()=>false,changed=()=>{}}){
  root.innerHTML=`<label class="studio-check"><input type="checkbox" data-add-pin> Add connectors</label>
    <div data-pin-settings hidden>
      <label class="studio-field">Connector<select data-pin-kind aria-label="Connector type"><option value="pin">Attached pin &amp; socket</option><option value="dowel">Separate dowel &amp; two sockets</option><option value="sockets">Two sockets only</option></select></label>
      <div class="studio-dimensions">
        <label>Diameter (mm)<input type="number" min="1" max="20" step="0.1" value="3" data-pin-diameter></label>
        <label><span data-length-label>Pin length (mm)</span><input type="number" min="1" max="20" step="0.1" value="3" data-pin-length></label>
        <label>Fit clearance (mm)<input type="number" min="0.05" max="1" step="0.05" value="0.3" data-pin-clearance></label>
      </div>
      <label class="studio-field" data-pin-side-field>Pin on<select data-pin-side><option value="selected">Selected part</option><option value="base">Remaining model</option></select></label>
      <label class="studio-check" data-pin-orient-field><input type="checkbox" data-orient-pins checked> Orient attached pins upwards</label>
      <p class="hint" data-joint-description></p>
      <details class="joint-position"><summary>Position on join</summary><p class="hint">Offset from the automatically fitted centre. Across and up follow the face diagram. Offsets apply to each join.</p>
        <div class="studio-dimensions"><label>Across (mm)<input type="number" min="-1000" max="1000" step="0.1" value="0" data-pin-across></label><label>Up (mm)<input type="number" min="-1000" max="1000" step="0.1" value="0" data-pin-up></label></div><button type="button" data-joint-reset>Reset position</button>
      </details>
      <button type="button" class="joint-check" data-joint-check>Check join</button>
      <p class="hint joint-status" data-joint-status role="status" aria-live="polite">Check the join before applying. Your model stays unchanged.</p>
      <div data-joint-result hidden><label class="studio-field" data-joint-picker-label hidden>Inspect join<select data-joint-picker aria-label="Join to inspect"></select></label><div class="joint-face" data-joint-face></div><p class="hint" data-joint-face-help></p></div>
    </div>`;
  const q=s=>root.querySelector(s),num=s=>Number(q(s).value);
  let pending=false,dead=false,active=true,worker=null,request=0,joins=[],signature='',checkedFile=null;
  function settings(){return q('[data-add-pin]').checked?{kind:q('[data-pin-kind]').value,diameter:num('[data-pin-diameter]'),length:num('[data-pin-length]'),clearance:num('[data-pin-clearance]'),side:q('[data-pin-side]').value,offset:[num('[data-pin-across]'),num('[data-pin-up]')]}:null;}
  function status(text,error=false){q('[data-joint-status]').textContent=text;q('[data-joint-status]').dataset.error=String(error);}
  function invalidate(){request++;worker?.terminate();worker=null;pending=false;joins=[];checkedFile=null;q('[data-joint-result]').hidden=true;status('Check the join before applying. Your model stays unchanged.');}
  function diagram(){
    const j=joins[Number(q('[data-joint-picker]').value)||0];if(!j)return;
    const points=j.face.rings.flat(),xs=points.map(p=>p[0]),ys=points.map(p=>-p[1]),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y,pad=Math.max(w,h)*.08;
    const fmt=n=>Number(n.toFixed(5)),path=j.face.rings.map(r=>'M'+r.map(p=>`${fmt(p[0])},${fmt(-p[1])}`).join('L')+'Z').join('');
    const size=Math.max(w,h)*.025,c=j.face.centre;
    q('[data-joint-face]').innerHTML=`<svg viewBox="${fmt(x-pad)} ${fmt(y-pad)} ${fmt(w+2*pad)} ${fmt(h+2*pad)}" role="img" aria-label="Checked joining face with connector position"><path class="joint-boundary" d="${path}" fill-rule="evenodd"/><circle class="joint-socket" cx="${fmt(c[0])}" cy="${fmt(-c[1])}" r="${j.socketDiameter/2}"/><circle class="joint-pin" cx="${fmt(c[0])}" cy="${fmt(-c[1])}" r="${j.diameter/2}"/><path class="joint-cross" d="M${fmt(c[0]-size)},${fmt(-c[1])}h${fmt(size*2)}M${fmt(c[0])},${fmt(-c[1]-size)}v${fmt(size*2)}"/></svg>`;
    q('[data-joint-face]').dataset.interactive=String(joins.length===1);
    q('[data-joint-face-help]').textContent=`${w.toFixed(1)} × ${h.toFixed(1)} mm join · socket Ø${j.socketDiameter.toFixed(2)} × ${j.socketDepth.toFixed(2)} mm deep. ${joins.length===1?'Click the face to move and recheck, or enter offsets above.':'Use offsets above to move the connectors together.'} Printed fit still needs a small test.`;
  }
  function sync({enabled=active,automatic=false,plane=false}={}){
    active=enabled;
    const cfg=settings(),kind=cfg?.kind||'pin';
    q('[data-pin-settings]').hidden=!cfg;
    q('[data-pin-side-field]').hidden=kind!=='pin'||automatic;
    q('[data-pin-orient-field]').hidden=kind!=='pin';
    q('[data-pin-side]').options[0].textContent=plane?'Upper / positive half':'Selected part';q('[data-pin-side]').options[1].textContent=plane?'Lower / negative half':'Remaining model';
    q('[data-length-label]').textContent=kind==='pin'?'Pin length (mm)':'Depth per part (mm)';
    q('[data-joint-description]').textContent=kind==='dowel'?'Creates a separate dowel, twice the insertion depth, standing upright on the plate. Each socket is 0.2 mm deeper; clearance increases its diameter.':kind==='sockets'?'Creates matching blind sockets. Supply your own pin, with a length twice the insertion depth. Clearance increases the socket diameter.':'The pin-bearing part can be turned upwards. Clearance increases the socket diameter; its depth is 0.2 mm longer than the pin.';
    let next='';try{next=JSON.stringify(options());}catch{}
    if((signature&&signature!==next)||(checkedFile&&checkedFile!==source()))invalidate();signature=next;
    q('[data-joint-check]').disabled=busy()||!active||!cfg;
    q('[data-joint-check]').textContent=pending?'Cancel check':'Check join';
    q('[data-joint-face]').setAttribute('aria-busy',String(pending));
  }
  async function check(){
    if(dead||busy()||!active||!settings())return;
    if(pending){invalidate();sync();changed();return;}
    let opts;try{opts=options();}catch(e){status(e.message,true);return;}
    if(!opts.connector){status('Choose a connector first.',true);return;}
    const file=source();if(!file)return;
    invalidate();const stamp=request;pending=true;signature=JSON.stringify(opts);checkedFile=file;status('Checking the join and material behind both parts…');sync();changed();
    try{
      const bytes=await file.arrayBuffer();if(stamp!==request||dead)return;
      worker=new Worker(new URL('./model-edit-worker.js',import.meta.url),{type:'module'});
      worker.onmessage=({data})=>{
        if(stamp!==request||dead)return;
        if(data.progress){status(data.progress);return;}
        worker?.terminate();worker=null;pending=false;
        if(data.error){status(data.error,true);sync();changed();return;}
        joins=data.joins||[];
        if(!joins.length){status(data.reports?.flatMap(r=>r.retained||[])[0]?.reason||'No joining face found. Choose another cut or region.',true);sync();changed();return;}
        const picker=q('[data-joint-picker]');picker.replaceChildren();joins.forEach((j,i)=>{const o=root.ownerDocument.createElement('option');o.value=String(i);o.textContent=`Join ${i+1} · ${j.name}`;picker.append(o);});
        q('[data-joint-picker-label]').hidden=joins.length===1;q('[data-joint-result]').hidden=false;
        status(`${joins.length===1?'Join checked':`${joins.length} joins checked`} · ${opts.connector.kind==='dowel'?'two sockets and a separate dowel per join':opts.connector.kind==='sockets'?'two sockets per join':'attached pin and socket'}. Model unchanged.`);diagram();sync();changed();
      };
      worker.onerror=()=>{if(stamp!==request||dead)return;worker?.terminate();worker=null;pending=false;status('The join check stopped. Try again; your model is unchanged.',true);sync();changed();};
      worker.postMessage({bytes,options:{...opts,previewOnly:true}},[bytes]);
    }catch(e){if(stamp===request&&!dead){pending=false;status(e.message,true);sync();changed();}}
  }
  function click(e){
    const b=e.target.closest('button');
    if(b?.matches('[data-joint-check]')){check();return;}
    if(b?.matches('[data-joint-reset]')){q('[data-pin-across]').value='0';q('[data-pin-up]').value='0';invalidate();sync();changed();return;}
    const svg=e.target.closest('svg');if(!svg||joins.length!==1||pending||busy()||!active)return;
    const rect=svg.getBoundingClientRect(),[x,y,w,h]=svg.getAttribute('viewBox').split(' ').map(Number),scale=Math.min(rect.width/w,rect.height/h);if(!scale)return;
    const across=(e.clientX-rect.left-(rect.width-w*scale)/2)/scale+x,up=-((e.clientY-rect.top-(rect.height-h*scale)/2)/scale+y),origin=joins[0].face.automatic;
    q('[data-pin-across]').value=(across-origin[0]).toFixed(1);q('[data-pin-up]').value=(up-origin[1]).toFixed(1);invalidate();sync();changed();check();
  }
  function change(e){if(e.target.matches('[data-joint-picker]')){diagram();return;}invalidate();sync();changed();}
  root.addEventListener('click',click);root.addEventListener('input',change);root.addEventListener('change',change);
  return {settings,sync,invalidate,get pending(){return pending;},destroy(){dead=true;invalidate();root.removeEventListener('click',click);root.removeEventListener('input',change);root.removeEventListener('change',change);}};
}
