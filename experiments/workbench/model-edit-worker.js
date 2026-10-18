import {readZip,writeZip} from '../../web/zip.js';
import {editProject} from './model-edit.js';
self.onmessage=async({data})=>{
  try{self.postMessage({progress:'Reading the selected geometry…'});const entries=await readZip(new Uint8Array(data.bytes));
    self.postMessage({progress:data.options.operation==='colour'?'Applying colour to the selected copies…':'Separating and closing the selected geometry…'});
    const result=editProject(entries,data.options);self.postMessage({progress:'Checking the edited project…'});
    const bytes=await writeZip([...result.entries].map(([name,data])=>({name,data})));
    self.postMessage({bytes,changes:result.changes,colours:result.colours},[bytes.buffer]);
  }catch(error){self.postMessage({error:error.message});}
};
