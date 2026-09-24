import {readTextureModel} from './textureFormats.js';
import {histogram,reducePalette,previewMesh,printable3mf} from './textureModel.js';
let model=null,rows=null,reduced=null;
self.onmessage=async({data})=>{
  const {id,type}=data;
  const progress=stage=>self.postMessage({id,type:'progress',stage});
  try{
    if(type==='load'){
      model=rows=reduced=null;progress('Reading geometry and base colours');
      model=await readTextureModel(new Uint8Array(data.bytes),data.name);
      progress('Measuring the coloured surface');rows=histogram(model);reduced=reducePalette(rows,data.count||5);
      progress('Building the comparison preview');const preview=previewMesh(model);
      self.postMessage({id,type:'loaded',meta:{name:model.name,format:model.format,faces:model.faces,parts:model.meshes.length,bounds:model.bounds,up:model.up,warnings:model.warnings,colourBins:rows.length},...reduced,preview},[preview.positions.buffer,preview.colours.buffer]);
    }else if(type==='reduce'){
      if(!model)throw Error('Choose a model first.');progress('Finding a printable palette');reduced=reducePalette(rows,data.count);self.postMessage({id,type:'reduced',...reduced});
    }else if(type==='export'){
      if(!model||!reduced)throw Error('Choose a model and palette first.');progress('Writing the full mesh with filament colours');
      const bytes=await printable3mf(model,reduced,data.options);self.postMessage({id,type:'exported',bytes},[bytes.buffer]);
    }else throw Error('Unknown texture import operation.');
  }catch(e){self.postMessage({id,type:'error',message:e.message});}
};
