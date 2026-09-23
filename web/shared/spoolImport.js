// Project only colour fields from Spool Studio's existing account export.
export const MAX_STOCK_BYTES = 16 * 1024 * 1024;
const MATERIALS = new Set(["PLA", "PETG", "ABS", "TPU", "ASA", "PA"]);
const label = (value, max) => typeof value === "string"
  ? value.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").trim().slice(0, max) : "";

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
    const key = JSON.stringify([brand, product, name, material, color]);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ color, type: material, name: [brand, product, name || color, material].filter(Boolean).join(" · ") });
  }
  rows.sort((a,b) => a.name.localeCompare(b.name));
  return { rows, omitted };
}

export function mountSpoolImport({ host, getReels, apply }) {
  let rows = [], epoch = 0;
  const file = host.querySelector('[data-stock-file]');
  const status = host.querySelector('[data-stock-status]');
  const picker = host.querySelector('[data-stock-picker]');
  const slots = host.querySelector('[data-stock-slots]');
  const search = host.querySelector('[data-stock-search]');
  const applyButton = host.querySelector('[data-stock-apply]');
  const chosen = new Map();
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
    const selected = file.files[0], token = ++epoch;
    rows = []; chosen.clear(); picker.hidden = true; slots.replaceChildren();
    if (!selected) return;
    status.textContent = 'Reading filament colours…';
    try {
      if (selected.size > MAX_STOCK_BYTES) throw Error('Choose a Spool Studio JSON export smaller than 16 MB.');
      const result = parseSpoolStock(await selected.text());
      if (token !== epoch) return;
      rows = result.rows;
      search.value = ''; render(); picker.hidden = !rows.length;
      status.textContent = `${rows.length} available filament colours. ${result.omitted ? `${result.omitted} entries left out (used up, unavailable, unsupported material or no single colour). ` : ''}`
        + (rows.length ? 'Choose the reel loaded in each slot, then apply.' : 'Check your stock and colour hex values in Spool Studio, then export again.');
    } catch (error) { if (token === epoch) status.textContent = error.message; }
    finally { if (token === epoch) file.value = ''; }
  };
  search.oninput = render;
  applyButton.onclick = () => {
    const next = getReels().map((reel, slot) => {
      const row = rows[chosen.get(slot)];
      return row ? { color: row.color, type: row.type } : { ...reel };
    });
    apply(next);
    status.textContent = `${chosen.size} slot${chosen.size === 1 ? '' : 's'} updated. Check the recolouring result below. Slicer filament profiles are chosen separately.`;
    chosen.clear(); render();
  };
  host.querySelector('[data-stock-clear]').onclick = () => {
    epoch++; rows = []; chosen.clear(); slots.replaceChildren(); picker.hidden = true; file.value = '';
    status.textContent = 'Imported library cleared. Your loaded slot colours are unchanged.';
  };
}
