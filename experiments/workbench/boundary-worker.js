import {readZip} from '../../web/zip.js';
import {readProject,isHiddenPart} from '../../web/shared/project.js';
import {sourceParts} from './model-edit.js';
import {surfaceGraph,traceBoundary} from './surface-boundary.js';
import {inspectionSoup} from './split-inspection.js';
let parts=null,graphs=new Map(),faceSources=null,ranges=null;
self.onmessage=async({data})=>{
  const {request}=data;
  try{
    if(data.action==='start'){
      const entries=await readZip(new Uint8Array(data.bytes)),project=readProject(entries,{allowNegative:true,allowModifiers:true});
      if(data.objectIds.length!==1)throw Error('Select one object to draw a boundary.');
      parts=sourceParts(project,data.plateId,data.objectIds[0]).parts;graphs.clear();
      if(parts.some(p=>isHiddenPart(p.subtype)))throw Error('This object contains a modifier or negative volume. Use your slicer to preserve its role.');
      const soup=inspectionSoup(parts.map(p=>[p]),project.colors,parts.map(p=>p.name),true);
      faceSources=soup.faceSources;ranges=soup.ranges;delete soup.faceSources;
      self.postMessage({request,soup},[soup.positions.buffer,soup.colors.buffer]);return;
    }
    if(!parts?.[data.part])throw Error('Choose a surface on the selected object.');
    if(!graphs.has(data.part))graphs.set(data.part,surfaceGraph(parts[data.part].faces));
    const result=traceBoundary(graphs.get(data.part),data.points,{closed:data.closed,flip:data.flip});
    // Only the path and points cross back to the UI. Apply recomputes the exact
    // selected original faces; it never trusts editable face IDs from the UI.
    const mask=new Uint8Array(faceSources.length),range=ranges.find(r=>r.part===data.part),selected=new Set(result.indices);
    for(let i=range.start/3;i<(range.start+range.count)/3;i++)if(selected.has(faceSources[i]))mask[i]=1;
    self.postMessage({request,result:{...result,indices:undefined,mask,selectedFaces:result.indices.length}},[mask.buffer]);
  }catch(e){self.postMessage({request,error:e.message});}
};
