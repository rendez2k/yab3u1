import { recommendWorkflow } from './recommend.js';
import { setBlendStrength, setHueFidelity, setBakedColours } from './mix.js';
self.onmessage = ({data}) => {
  try {
    // The page's blend detail choice applies to the search this worker runs.
    if (data.blendStrength) setBlendStrength(data.blendStrength);
    setHueFidelity(Boolean(data.keepHue));
    setBakedColours(Boolean(data.bakedColours));
    self.postMessage({result:recommendWorkflow({...data,onProgress:progress=>self.postMessage({progress})})});
  }
  catch(error) { self.postMessage({error:error.message}); }
};
