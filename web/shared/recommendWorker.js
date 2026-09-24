import { recommendWorkflow } from './recommend.js';
self.onmessage = ({data}) => {
  try { self.postMessage({result:recommendWorkflow(data)}); }
  catch(error) { self.postMessage({error:error.message}); }
};
