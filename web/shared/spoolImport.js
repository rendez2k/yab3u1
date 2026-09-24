// Project only colour fields from Spool Studio's existing account export.
export const MAX_STOCK_BYTES = 16 * 1024 * 1024;
const MATERIALS = new Set(["PLA", "PETG", "ABS", "TPU", "ASA", "PA"]);
const label = (value, max) => typeof value === "string"
  ? value.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").trim().slice(0, max) : "";

export function sharedSpoolStock(colours) {
  if (!Array.isArray(colours) || colours.length > 1000) throw Error('Spool Studio sent an invalid stock list. Please try again.');
  const bounds = { brand:80, product:120, colour:80, material:32 };
  const keys = [...Object.keys(bounds), 'finish', 'hex', 'availableRolls'];
  const finishes = ['standard','matte','silk','marble','sparkle','wood','glow','satin','metal','unknown'];
  for (const row of colours) {
    if (!row || typeof row !== 'object' || Object.keys(row).length !== keys.length || Object.keys(row).some(k => !keys.includes(k))
      || Object.entries(bounds).some(([k,max]) => typeof row[k] !== 'string' || row[k].length > max || /[\x00-\x1f\x7f-\x9f]/.test(row[k]))
      || !finishes.includes(row.finish) || typeof row.hex !== 'string' || !/^#[0-9A-F]{6}$/.test(row.hex)
      || !Number.isInteger(row.availableRolls) || row.availableRolls < 1 || row.availableRolls > 500000)
      throw Error('Spool Studio sent invalid filament details. Please try again.');
  }
  if (new TextEncoder().encode(JSON.stringify(colours)).length > 512*1024) throw Error('The shared stock list is too large.');
  return parseSpoolStock(JSON.stringify({format:'spool-studio-account-export-v1',library:{items:colours.map(row => ({
    brand:row.brand,product:row.product,colour:row.colour,material:row.material,hex:row.hex,spools:row.availableRolls,finish:row.finish,
  }))}}));
}

/** One-time, explicitly approved snapshot using Spool Studio's Strata v1 contract. */
export function requestSpoolStock({ host = window, receive, status, done }) {
  const origin = 'https://spool-studio.uk';
  if (!['https://yab3d.uk','https://yab3u1.netlify.app','https://u1-reel-changes--yab3u1.netlify.app'].includes(host.location.origin)) {
    status('Open YAB3D’s website or review build to connect to Spool Studio. File import also works locally.'); done(); return () => {};
  }
  const token = Array.from(host.crypto.getRandomValues(new Uint8Array(16)), n=>n.toString(16).padStart(2,'0')).join('');
  const url = new URL('/?view=cards', origin);
  url.hash = new URLSearchParams({'strata-stock':token,sender:host.location.origin}).toString();
  const popup = host.open(url.href, '_blank');
  if (!popup) { status('Allow pop-ups, then choose Connect to Spool Studio again.'); done(); return () => {}; }
  let active = true, requested = false, timeout, poll;
  const send = (type, extra = {}) => popup.postMessage({type:'strata-spool:stock-'+type,version:1,token,...extra},origin);
  function finish(message, cancel = false) {
    if (!active) return;
    active = false;
    host.removeEventListener('message', listener); host.removeEventListener('pagehide', pagehide);
    host.clearTimeout(timeout); host.clearInterval(poll);
    if (cancel) { try { send('error', {message:'YAB3D cancelled this request.'}); } catch {} }
    if (message) status(message); done();
  }
  function listener(event) {
    const data = event.data;
    if (!active || event.source !== popup || event.origin !== origin || !data || data.version !== 1 || data.token !== token) return;
    if (data.type === 'strata-spool:stock-ready' && !requested) {
      requested = true;
      try { send('request'); } catch { finish('Could not contact Spool Studio. Please reconnect.'); }
    } else if (data.type === 'strata-spool:stock-data' && requested) {
      try { const result = sharedSpoolStock(data.colours); send('received'); receive(result); finish(); }
      catch (error) { finish(error.message, true); }
    } else if (data.type === 'strata-spool:stock-error') {
      finish('Spool Studio: ' + (typeof data.message === 'string' ? data.message.slice(0,240) : 'Sharing stopped.') + ' Reconnect when ready.');
    }
  }
  const pagehide = () => finish(null, true);
  host.addEventListener('message', listener); host.addEventListener('pagehide', pagehide);
  timeout = host.setTimeout(() => finish('Sharing timed out. Connect again when you’re ready.', true), 120000);
  poll = host.setInterval(() => { if (popup.closed) finish('The Spool Studio tab closed. Connect again to choose your filaments.'); }, 1000);
  status('In Spool Studio, sign in if needed and choose Share available colours with YAB3D. Then return here to choose your slots.');
  return () => finish('Connection cancelled. Your loaded reels are unchanged.', true);
}

export function parseSpoolStock(text) {
  if (new TextEncoder().encode(text).length > MAX_STOCK_BYTES) throw Error("Choose a Spool Studio JSON export smaller than 16 MB.");
  let data;
  try { data = JSON.parse(text); } catch { throw Error("This is not valid JSON. In Spool Studio, use Download saved data (JSON)."); }
  if (data?.format !== "spool-studio-account-export-v1" || !Array.isArray(data.library?.items))
    throw Error("Choose the file from Spool Studio’s Download saved data (JSON) button.");
  if (data.library.items.length > 10000) throw Error("This library has more than 10,000 entries. It is too large for this importer.");
  const rows = [], seen = new Set();
  let omitted = 0;
  for (const item of data.library.items) {
    if (!item || typeof item !== "object") { omitted++; continue; }
    if (item.used === true || !Number.isInteger(item.spools) || item.spools <= 0) { omitted++; continue; }
    const material = label(item.material, 32).toUpperCase();
    const name = label(item.colour, 80), product = label(item.product, 120), brand = label(item.brand, 80);
    if (!MATERIALS.has(material) || typeof item.hex !== "string" || !/^#[a-f0-9]{6}(?:ff)?$/i.test(item.hex)
        || /bundle|dual|gradient|rainbow|multi.colou?r|transition/i.test(product + " " + name) || /[\/＋+]/.test(name)) {
      omitted++; continue;
    }
    const color = item.hex.slice(0, 7).toUpperCase();
    const finish = label(item.finish, 24);
    const key = JSON.stringify([brand, product, name, material, color, finish]);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ color, type: material, name: [brand, product, name || color, finish === 'unknown' ? '' : finish, material].filter(Boolean).join(" · ") });
  }
  rows.sort((a,b) => a.name.localeCompare(b.name));
  return { rows, omitted };
}

export function mountSpoolImport({ host, getReels, apply, onStock = () => {} }) {
  let rows = [], epoch = 0, cancelRequest = null;
  const file = host.querySelector('[data-stock-file]');
  const status = host.querySelector('[data-stock-status]');
  const picker = host.querySelector('[data-stock-picker]');
  const slots = host.querySelector('[data-stock-slots]');
  const search = host.querySelector('[data-stock-search]');
  const applyButton = host.querySelector('[data-stock-apply]');
  const chosen = new Map();
  const connect = host.querySelector('[data-stock-connect]'), cancel = host.querySelector('[data-stock-cancel]');
  function load(result) {
    rows = result.rows; chosen.clear(); search.value = ''; render(); picker.hidden = !rows.length;
    onStock(rows);
    status.textContent = `${rows.length} available filament colours. ${result.omitted ? `${result.omitted} unsupported or unavailable entries left out. ` : ''}`
      + (rows.length ? 'Choose the reel loaded in each slot, then apply. Refresh from Spool Studio after stock changes.' : 'No supported stock colours to choose. Check your library in Spool Studio.');
  }
  connect.onclick = () => {
    epoch++; rows = []; chosen.clear(); picker.hidden = true; slots.replaceChildren();
    onStock(null);
    if (cancelRequest) cancelRequest();
    connect.disabled = true; cancel.hidden = false;
    const stop = requestSpoolStock({receive:load,status:text=>{status.textContent=text;},done:()=>{
      cancelRequest=null;connect.disabled=false;cancel.hidden=true;
    }});
    if (connect.disabled) cancelRequest = stop;
  };
  cancel.onclick = () => cancelRequest?.();
  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    slots.replaceChildren();
    getReels().forEach((reel, slot) => {
      const field = document.createElement('div'); field.className = 'field';
      const name = document.createElement('label'); name.htmlFor = `stock-slot-${slot}`; name.textContent = `Slot ${slot + 1}`;
      const select = document.createElement('select'); select.id = name.htmlFor;
      select.add(new Option(`Keep current — ${reel.color} · ${reel.type}`, ''));
      rows.forEach((row, index) => {
        if (chosen.get(slot) === index || `${row.name} ${row.color}`.toLocaleLowerCase().includes(query))
          select.add(new Option(`${row.name} · ${row.color}`, String(index)));
      });
      select.value = chosen.has(slot) ? String(chosen.get(slot)) : '';
      select.onchange = () => {
        if (select.value === '') chosen.delete(slot); else chosen.set(slot, Number(select.value));
        applyButton.disabled = !chosen.size;
      };
      field.append(name, select); slots.append(field);
    });
    applyButton.disabled = !chosen.size;
  }
  file.onchange = async () => {
    if (cancelRequest) cancelRequest();
    const selected = file.files[0], token = ++epoch;
    rows = []; chosen.clear(); picker.hidden = true; slots.replaceChildren();
    onStock(null);
    if (!selected) return;
    status.textContent = 'Reading filament colours…';
    try {
      if (selected.size > MAX_STOCK_BYTES) throw Error('Choose a Spool Studio JSON export smaller than 16 MB.');
      const result = parseSpoolStock(await selected.text());
      if (token !== epoch) return;
      load(result);
    } catch (error) { if (token === epoch) status.textContent = error.message; }
    finally { if (token === epoch) file.value = ''; }
  };
  search.oninput = render;
  applyButton.onclick = () => {
    const next = getReels().map((reel, slot) => {
      const row = rows[chosen.get(slot)];
      return row ? { color: row.color, type: row.type, name:row.name } : { ...reel };
    });
    apply(next);
    status.textContent = `${chosen.size} slot${chosen.size === 1 ? '' : 's'} updated. Check the recolouring result below. Slicer filament profiles are chosen separately.`;
    chosen.clear(); render();
  };
  host.querySelector('[data-stock-clear]').onclick = () => {
    if (cancelRequest) cancelRequest();
    epoch++; rows = []; chosen.clear(); slots.replaceChildren(); picker.hidden = true; file.value = '';
    onStock(null);
    status.textContent = 'Imported library cleared. Your loaded slot colours are unchanged.';
  };
  return { refresh: render };
}
