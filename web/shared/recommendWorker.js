import { recommendPalette } from './recommend.js';
self.onmessage = ({data}) => {
  try { self.postMessage({result:recommendPalette(data)}); }
  catch(error) { self.postMessage({error:error.message}); }
};
