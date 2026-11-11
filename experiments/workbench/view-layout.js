/** Compose a new workspace from the real feature controls, never cloned IDs.
 * Unused structural hooks remain in a hidden compatibility container. */
export function composeView(doc,kind) {
  const $=id=>doc.getElementById(id), make=(tag,attrs={},html='')=>{const n=doc.createElement(tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);n.innerHTML=html;return n;};
  const parking=make('div',{id:'compatibility',hidden:''});
  parking.append(...doc.body.childNodes);doc.body.append(parking);
  const workspace=make('div',{id:'engine-workspace'}),stage=make('section',{id:'stage','aria-label':'Model preview'}),inspector=make('aside',{id:'inspector','aria-label':'Task settings'});
  workspace.append(stage,inspector);doc.body.append(workspace);
  const panels={};
  const descriptions={project:['Your model','Open a model and choose your printer.'],colours:['Choose your colours',kind==='converter'?'Keep the painting, rearrange slots or merge colours.':'Compare palettes, protect important colours and try blends.'],layout:['Arrange your plate','Click an object in the preview to duplicate or remove it.'],output:['Check and download','Review what will travel into your slicer.'],help:['Tools & information','Connections, documentation and credits.']};
  for(const [key,[title,description]]of Object.entries(descriptions)){const panel=make('section',{'data-task':key,hidden:'','aria-label':title},`<div class="task-heading"><h1>${title}</h1><p>${description}</p></div>`);panels[key]=panel;inspector.append(panel);}
  // The three step panels say where they sit in the four steps.
  ['project','colours','output'].forEach((key,index)=>panels[key].querySelector('.task-heading').prepend(make('span',{class:'step-eyebrow'},`Step ${index+1} of 4`)));
  const move=(selector,to)=>{const n=doc.querySelector(selector);if(!n)throw Error(`Workbench feature missing: ${selector}`);to.append(n);return n;};
  const empty=make('div',{id:'stage-empty'},'<div><h1>Your next print starts here.</h1><p>Bring your model, its colours and its parts into one workspace.</p><button class="primary" data-open-model>Open a model</button><button data-open-sample>Try a sample project</button><button class="joint-sample-link" data-open-sample="joint">Try separating a green stalk</button><p class="empty-formats">3MF · GLB · OBJ with textures in a ZIP<br>Processed in this browser. Nothing uploaded.</p></div>');stage.append(empty);
  const feedback=make('div',{id:'stage-feedback','aria-live':'polite'});stage.append(feedback);
  if(kind==='converter') {
    move('#sourcepreview',stage);
    move('#convertdrop',panels.project);move('#importtools',panels.project);
    panels.project.append($('convertplate').closest('.row'));
    move('#bambuprinter',panels.project);move('#printercapacity',panels.project);
    move('#petgsupport',panels.colours);move('fieldset.repaint',panels.colours);
    move('#platelayout',panels.layout);
    const conversionSettings=make('details',{class:'conversion-settings'},'<summary>Print settings · advanced</summary>');
    // The check comes first: what will be written. Settings follow for those who want them.
    move('#convertplan',panels.output);panels.output.append(conversionSettings);move('#settingsbox',conversionSettings);move('#convertgo',panels.output);move('#convertout',panels.output);move('#printersetup',panels.output);
    move('#loaderror',feedback);move('#convertstatus',feedback);
    const batch=move('#batchpanel',workspace);batch.prepend(make('button',{'data-close-batch':''},'Back to model'));
    $('convertpick').classList.add('hidden');
    $('sourcepreview').querySelector('.preview-heading h2').textContent='Model & plate';
    const notes=make('details',{class:'stage-notes'},'<summary>About this preview</summary>');
    move('#previewmodehint',notes);move('#previewnote',notes);panels.project.append(notes);
  } else {
    move('#mixcard',stage);
    move('#printeroptions',panels.project);move('#drop',panels.project);move('#loadedmodel',panels.project);move('#project',panels.project);
    $('printeroptions').open=true;
    move('#loaderror',feedback);move('#loadretry',feedback);move('#loadstatus',feedback);move('#loadcancel',feedback);
    move('#filamentbundles',panels.colours);move('#blendeditor',panels.colours);
    move('#reelscard',panels.colours);move('#colouroutcome',panels.colours);
    // Suggestions are the main colour task; library/calibration are secondary.
    $('supportinterface').after($('colourpriorities'),$('recommendation'));
    const oldHeading=$('recommendheading'),heading=make('h2',{id:'recommendheading'});
    heading.textContent=oldHeading.textContent;oldHeading.replaceWith(heading);
    move('#copyoptions',panels.layout);$('copyoptions').open=true;
    move('#exportcard',panels.output);
    // The check comes first: what will be written and the confirmation. Print options follow.
    const options=make('details',{class:'print-options'},'<summary>Print options · advanced</summary>'),card=$('exportcard'),review=$('review').closest('label');
    options.append(...['interweaveoptions','dualwalloptions','subdivideoptions','layeroptions'].map($),$('spectrumfilaments').closest('details'));
    $('exportsettingsheading').textContent='What will be downloaded';
    $('exportsettingsheading').after($('exportnote'),$('applyforexport'),review,options);
    move('#advanced',panels.colours);move('#plannercard',panels.output);
    move('#cutoutnote',panels.project);move('.previewdetails',panels.project);
    $('previewheading').textContent='Model & plate';
  }
  move('#previewwarning',feedback);
  move('#chrome-extension',panels.help);
  panels.help.prepend(make('p',{class:'hint'},'The Chrome extension opens original MakerWorld projects in YAB3D. Choose Analyse & convert or Full Spectrum beside Open in YAB3D on the model page.'));
  const footer=doc.querySelector('#compatibility footer');if(footer)panels.help.append(footer);
  panels.help.append(make('p',{},'This workbench keeps the existing model-processing engines. Generated previews are simplified; slice and inspect the exported project before printing.'));
  for(const key of ['colours','layout','output']) {
    const content=make('div',{'data-requires-model':''});
    const children=[...panels[key].children].filter(n=>!n.classList.contains('task-heading'));
    content.append(...children);panels[key].append(make('p',{'data-before-model':'',class:'hint'},'Open a model to use these controls.'),content);
  }
  if(kind==='converter')for(const node of [$('convertplate').closest('.row'),$('printercapacity'),$('bambuprinter')])node.setAttribute('data-requires-model','');
  const previewToolbar=doc.querySelector(kind==='converter'?'#convertpreviewtoolbar':'.previewtoolbar');
  $('platecontrols').querySelector('.plate-tool-row').prepend(previewToolbar);
  $('platecontrols').querySelector('[data-arrange]').hidden=true;
  for(const p of Object.values(panels))p.querySelectorAll('.card').forEach(n=>n.classList.remove('card'));
  panels.colours.querySelector('.task-heading').after(make('div',{class:'workflow-explanation'},'<strong>Colour replacement changes the paint, not the parts.</strong><p>For example, replacing green with orange makes every green region print in orange. Orange regions stay orange. No objects are joined or removed.</p><p>With PETG support, replace a PLA colour to free one printer input. Use Undo to compare another choice. Full Spectrum can also approximate shades using blends.</p>'));
  panels.layout.querySelector('.task-heading').after(make('details',{class:'workflow-explanation'},'<summary>Copies, sets and colour groups explained</summary><p><strong>Add copies:</strong> select one object and enter how many new copies you want. <strong>Fill with this object:</strong> adds that object while keeping the other quantities, repacking the plate to find room.</p><p><strong>Fill with whole sets:</strong> repeats the current list of parts together, including their quantities. A set is that list, not a finished assembled model.</p><p><strong>Select parts by original filament:</strong> finds whole parts to keep or remove. A multicoloured pumpkin stays a whole object.</p><p><strong>Sequential printing:</strong> exports same-colour parts as one slicer group per filament, with their separate meshes preserved. Multicoloured parts go on a separate plate. Colours do not change.</p>'));
  panels.layout.querySelector('.task-heading').after(doc.getElementById('printoptimiser'));
  panels.layout.querySelector('.task-heading').after(make('div',{class:'auto-arrange-controls','data-requires-model':''},'<button type="button" class="primary" data-auto-arrange>Auto arrange</button><p class="hint">Repack every current object. Quantities and print orientation stay the same.</p><p class="hint" data-arrange-status role="status" aria-live="polite"></p>'));
  panels.project.hidden=false;
  const explanation=panels.colours.querySelector('.workflow-explanation');
  const help=make('details',{class:'workflow-explanation'},'<summary>How colour replacement works</summary>');help.append(...explanation.childNodes);explanation.replaceWith(help);
  panels.colours.querySelector('.task-heading').after(make('div',{class:'colour-workflow'},`<div class="colour-need" data-colour-need role="status"></div><div class="colour-choices" role="group" aria-label="How to print the colours">
<button type="button" data-colour-workflow="spectrum" data-colour-purpose="blends" aria-pressed="${kind==='spectrum'}"><strong>Blend the extra colours</strong><span>Mixes your reels layer by layer to reach more shades. Closest to the original.</span><em data-recommended hidden>Recommended</em></button>
<button type="button" data-colour-workflow="converter" aria-pressed="${kind==='converter'}"><strong>Merge similar colours</strong><span>Prints each extra colour in the nearest reel you load. Simplest and most reliable.</span></button>
<button type="button" data-colour-workflow="spectrum" data-colour-purpose="reel-changes" aria-pressed="false"><strong>Swap reels mid-print</strong><span>Keeps every colour by changing reels at set layers. You need to be at the printer.</span></button>
</div><p class="colour-workflow-note">Each method keeps its own colour choices, so you can switch and compare. Your model is not changed until you download.</p></div>`));
  if(kind==='converter'){
    // Leaving the extra colours for the slicer is a colour decision, so it sits with the others.
    const keep=make('details',{class:'keep-all-colours',hidden:''},'<summary>Keep every colour and sort it out in the slicer</summary>'),label=$('capacitykeep').closest('label'),hint=label.nextElementSibling;
    keep.append(label,hint);
    panels.colours.querySelector('.colour-workflow').append(keep);
  }
  if(kind==='spectrum'){
    panels.colours.append(help);
    help.append(panels.colours.querySelector('.colour-workflow-note'));
    $('filamentbundles').open=true;
  }
  // Step 2 leads with the one task of the chosen method; everything else folds away.
  const body=panels.colours.querySelector('[data-requires-model]'),workflow=panels.colours.querySelector('.colour-workflow');
  workflow.append(make('div',{class:'colour-method',hidden:''},'<span>Method</span><strong data-method-name></strong><button type="button" data-change-method>Change</button>'));
  if(kind==='converter'){
    const assignment=doc.querySelector('fieldset.repaint'),remove=make('details',{class:'colour-fold','data-remove-colour':''},'<summary>Remove a colour from the model</summary>'),more=make('details',{class:'colour-fold'},'<summary>More options · advanced</summary>');
    $('filamentassignment').textContent='What each colour prints as';
    more.append($('petgsupport'));
    body.prepend(assignment);body.append(remove,more);
    assignment.before(make('div',{class:'auto-merge',hidden:''},'<button type="button" class="primary" data-auto-merge>Merge the closest colours for me</button><p class="hint" data-auto-merge-status role="status" aria-live="polite"></p>'));
    const how=[...panels.colours.querySelectorAll('details.workflow-explanation')].pop();if(how)body.append(how);
  }else{
    const tune=make('details',{class:'colour-fold colour-finetune'},'<summary>Fine-tune · advanced</summary>');
    const others=make('button',{type:'button','data-other-palettes':'','aria-expanded':'false'},'Compare other reel sets');
    $('palettechoices').after(others);
    body.prepend($('filamentbundles'),$('recommendation'),$('colouroutcome'));
    $('filamentbundles').before(make('h2',{class:'colour-section'},'Reels to load'));
    $('recommendheading').textContent='Suggested set';
    tune.append($('blendstrengthfield'),$('slotoptions'),$('blendeditor'),$('colourpriorities'),$('supportinterface'),$('modelchoices'),$('spoolimport'),$('blendcalibration'),$('advanced'));
    body.append(tune);
    const help=[...panels.colours.querySelectorAll('details.workflow-explanation')].pop();if(help)body.append(help);
  }
  // Contextual help remains available without consuming the main viewport.
  stage.append(make('div',{class:'stage-caption'},'Drag to orbit · Drag a selected object to move it · Right-drag to pan · Shift/Ctrl/Cmd-click to select several · Delete to remove · Ctrl/Cmd+Z to undo'));
  return {workspace,stage,inspector,panels,move,make,feedback,empty,parking};
}
