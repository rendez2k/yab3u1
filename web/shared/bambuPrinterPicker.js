import {BambuProfiles} from './bambuProfiles.js';

export function mountBambuPrinterPicker(root, session, changed) {
  const profiles = new BambuProfiles();
  const model = root.querySelector('[data-model]'), nozzle = root.querySelector('[data-nozzle]');
  const status = root.querySelector('[role=status]'), retry = root.querySelector('button');
  let catalogue = null, sequence = 0, lastKey = '';
  const option = (label,value) => new Option(label,value);
  const types = () => session.activeColourIds().map(id => session.state?.types[id-1] || 'PLA');
  function nozzles() {
    const previous = nozzle.value;
    nozzle.replaceChildren(...(catalogue || []).filter(p=>p.model===model.value).map(p=>option(p.nozzle+' mm',p.name)));
    const preferred = [...nozzle.options].find(o=>o.value===previous) || [...nozzle.options].find(o=>o.text==='0.4 mm');
    if(preferred) nozzle.value = preferred.value;
    nozzle.disabled = !nozzle.options.length;
  }
  async function update(force = false) {
    root.hidden = session.target !== 'bambu';
    if (root.hidden) { sequence++; lastKey = ''; return; }
    const key = JSON.stringify([session.epoch,model.value,nozzle.value,types().sort(),Boolean(session.filamentProfiles.some(Boolean))]);
    if (!force && lastKey === key) return;
    lastKey = key;
    const ticket = ++sequence;
    retry.hidden = true;
    if (model.value === 'portable') {
      if (session.state?.negativeVolumes || session.filamentProfiles.some(Boolean)) {
        status.textContent = 'Cutout volumes and custom filament profiles need a complete project. Choose a Bambu printer and nozzle to preserve them.';
        session.setBambuSetup(null,false,status.textContent); changed(); return;
      }
      status.textContent = 'Colour model only: choose the printer in Bambu. Its colour dialogue may append filaments; review the import guide after exporting.';
      session.setBambuSetup(null,false); changed(); return;
    }
    session.setBambuSetup(null,true);
    status.textContent = catalogue ? 'Choose your Bambu printer and fitted nozzle.' : 'Loading official Bambu printer choices… Your model stays on this device.';
    changed();
    try {
      if (!catalogue) {
        const entries = await profiles.catalogue();
        if(ticket !== sequence) return;
        catalogue = entries;
        model.replaceChildren(option('Choose your Bambu printer…',''),
          ...[...new Set(entries.map(p=>p.model))].map(name=>option(name,name)),
          option('Colour model only · set up in Bambu','portable'));
        nozzles();
      }
      if (!model.value) { status.textContent = 'Select a printer to export its native project with the exact filament list.'; return; }
      status.textContent = 'Loading official printer, process and material profiles…';
      const setup = await profiles.setup(nozzle.value, types());
      if(ticket !== sequence || session.target !== 'bambu') return;
      session.setBambuSetup(setup,true);
      status.textContent = `${setup.machine.name} · ${setup.bed.width} × ${setup.bed.depth} mm bed. Native project; open as a project in Bambu Studio. Set physical input capacity separately for your AMS setup.`;
      changed();
    } catch(error) {
      if(ticket !== sequence) return;
      status.textContent = error.message || 'Could not load official Bambu profiles. Retry or choose colour model only.';
      session.setBambuSetup(null,true,status.textContent);
      retry.hidden = false;
      changed();
    }
  }
  model.addEventListener('change',()=>{nozzles(); update(true);});
  nozzle.addEventListener('change',()=>update(true));
  retry.addEventListener('click',()=>update(true));
  return {refresh:update};
}
