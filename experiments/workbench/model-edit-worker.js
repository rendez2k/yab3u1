import {readZip,writeZip} from '../../web/zip.js';
import {editProject,inspectRegions,inspectShapes} from './model-edit.js';
self.onmessage=async({data})=>{
  try{self.postMessage({progress:'Reading the selected geometry…'});const entries=await readZip(new Uint8Array(data.bytes));
    if(data.options.operation==='inspect-regions'){self.postMessage({regions:inspectRegions(entries,data.options,progress=>self.postMessage({progress}))});return;}
    if(data.options.operation==='inspect-shapes'){self.postMessage(inspectShapes(entries,data.options,progress=>self.postMessage({progress})));return;}
    self.postMessage({progress:data.options.operation==='colour'?'Applying colour to the selected copies…':'Separating and closing the selected geometry…'});
    const result=editProject(entries,data.options,progress=>self.postMessage({progress}));self.postMessage({progress:'Checking the edited project…'});
    if(data.options.previewOnly){self.postMessage({joins:result.joins,reports:result.reports,assembly:result.assembly},result.assembly?[result.assembly.positions.buffer,result.assembly.colors.buffer]:[]);return;}
    if(!result.changes.length){self.postMessage({changes:[],reports:result.reports});return;}
    const bytes=await writeZip([...result.entries].map(([name,data])=>({name,data})));
    self.postMessage({bytes,changes:result.changes,colours:result.colours,reports:result.reports},[bytes.buffer]);
  }catch(error){self.postMessage({error:error.message});}
};
