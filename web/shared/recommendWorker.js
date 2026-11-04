import { recommendWorkflow } from './recommend.js';
self.onmessage = ({data}) => {
  try { self.postMessage({result:recommendWorkflow({...data,onProgress:progress=>self.postMessage({progress})})}); }
  catch(error) { self.postMessage({error:error.message}); }
};
