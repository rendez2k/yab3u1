import { colourName } from './assignment.js';
import { norm } from './colour.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const supportLabel = value => ({'tree(manual)':'Tree (manual)', 'tree(auto)':'Tree (auto)',
  'normal(manual)':'Normal (manual)', 'normal(auto)':'Normal (auto)',
  tree_organic:'Tree Organic', tree_slim:'Tree Slim', tree_strong:'Tree Strong',
  default:'Default'}[value] || value);

// The report comes from the completed export, not the currently selected file.
export function bambuImportGuide(entry) {
  if (entry.target === 'bambu' && entry.settings?.format === 'native-project') return `<section class="bambu-import-guide"><h3>Open as a project in Bambu Studio</h3><p>${esc(entry.settings.printer)} · ${entry.colours.length} project filaments.</p><p>Use File → Open Project, and load the complete project. Painting and compatible designer settings are included. Review individual models under Objects → Support or Quality, then slice before printing.</p></section>`;
  if (entry.target !== 'bambu' || entry.settings?.format !== 'standard-colour') return '';
  const colours = entry.colours.map(c => norm(c) || '#FFFFFF');
  const objects = entry.settings.objects || [];
  const hasSettings = objects.some(o => Object.keys(o.values).length);
  const settings = objects.map(({name, values:v}) => {
    const support = v.enable_support === '1' ? 'On' : v.enable_support === '0' ? 'Off' : 'Use Bambu profile';
    const details = [supportLabel(v.support_type), supportLabel(v.support_style), v.support_threshold_angle ? `${v.support_threshold_angle}°` : ''].filter(Boolean).join(' · ');
    return `<tr><th scope="row">${esc(name)}</th><td>${v.layer_height ? `${esc(v.layer_height)} mm` : 'Use Bambu profile'}</td><td>${support}${details ? `<br><small>${esc(details)}</small>` : ''}</td></tr>`;
  }).join('');
  return `<section class="bambu-import-guide" aria-label="Open this file in Bambu Studio">
    <h3>Open in Bambu Studio · ${colours.length} file filaments</h3>
    <p>Reuse your existing filaments to avoid duplicate entries.</p>
    <ol><li>In Bambu’s colour dialogue, click <strong>Reset</strong>, then <strong>Color match</strong>. Reset removes the newly proposed entries before matching.</li>
    <li>Check each dropdown points to an existing filament with the right colour. Avoid <strong>Append</strong> if those colours are already listed, then confirm.</li></ol>
    <ul class="bambu-import-palette">${colours.map((c,i) => `<li><span class="bambu-import-swatch" style="background:${c}" aria-hidden="true"></span><span>File ${i+1} · ${esc(colourName(c))}<small>${c}</small></span></li>`).join('')}</ul>
    <p>${hasSettings ? '<strong>Settings carried as object overrides.</strong> In Bambu, choose <strong>Objects → select a model → Support or Quality</strong>. Global still shows your printer’s process defaults.' : '<strong>No object print settings were carried.</strong> Set supports and layer height in Bambu before slicing.'}</p>
    ${hasSettings ? `<details><summary>Exported layer height and supports · ${objects.length} objects</summary><div class="bambu-settings-table"><table><thead><tr><th>Object</th><th>Layer height</th><th>Supports</th></tr></thead><tbody>${settings}</tbody></table></div></details>` : ''}
    <details><summary>Why Bambu says “not from Bambu Lab”</summary><p>This is a colour-model import. Your Bambu printer and process presets stay selected. The warning does not mean the object overrides listed above were lost. Review the sliced result.</p></details>
  </section>`;
}
