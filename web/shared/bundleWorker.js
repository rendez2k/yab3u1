import {unpackBundle} from './bundle.js';
self.onmessage=async({data})=>{
  try {
    const result=await unpackBundle(new Uint8Array(data.bytes));
    self.postMessage({id:data.id,type:'unpacked',...result},result.files.map(f=>f.bytes.buffer));
  } catch(error) { self.postMessage({id:data.id,type:'error',message:error.message}); }
};
