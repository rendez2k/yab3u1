/** Compose a new workspace from the real feature controls, never cloned IDs.
 * Unused structural hooks remain in a hidden compatibility container. */
export function composeView(doc,kind) {
  const $=id=>doc.getElementById(id), make=(tag,attrs={},html='')=>{const n=doc.createElement(tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);n.innerHTML=html;return n;};
  const parking=make('div',{id:'compatibility',hidden:''});
  parking.append(...doc.body.childNodes);doc.body.append(parking);
  const workspace=make('div',{id:'engine-workspace'}),stage=make('section',{id:'stage','aria-label':'Model preview'}),inspector=make('aside',{id:'inspector','aria-label':'Task settings'});
  workspace.append(stage,inspector);doc.body.append(workspace);
  const panels={};
  const descriptions={project:['Your project','Choose the model, plate and destination.'],colours:['Choose your colours',kind==='converter'?'Keep the painting, rearrange slots or merge colours.':'Compare palettes, protect important colours and try blends.'],layout:['Arrange your plate','Click an object in the preview to duplicate or remove it.'],output:['Prepare your export','Review what will travel into your slicer.'],help:['Tools & information','Connections, documentation and credits.']};
  for(const [key,[title,description]]of Object.entries(descriptions)){const panel=make('section',{'data-task':key,hidden:'','aria-label':title},`<header class="task-heading"><h1>${title}</h1><p>${description}</p></header>`);panels[key]=panel;inspector.append(panel);}
  const move=(selector,to)=>{const n=doc.querySelector(selector);if(!n)throw Error(`Workbench feature missing: ${selector}`);to.append(n);return n;};
  const empty=make('div',{id:'stage-empty'},'<div><h1>Your next print starts here.</h1><p>Bring your model, its colours and its parts into one workspace.</p><button class="primary" data-open-model>Open a model</button><button data-open-sample>Try a sample project</button><p class="empty-formats">3MF · GLB · OBJ with textures in a ZIP<br>Processed in this browser. Nothing uploaded.</p></div>');stage.append(empty);
  const feedback=make('div',{id:'stage-feedback','aria-live':'polite'});stage.append(feedback);
  if(kind==='converter') {
    move('#sourcepreview',stage);
    move('#convertdrop',panels.project);move('#importtools',panels.project);
    panels.project.append($('convertplate').closest('.row'));
    move('#bambuprinter',panels.project);move('#printercapacity',panels.project);
    move('#petgsupport',panels.colours);move('fieldset.repaint',panels.colours);
    move('#platelayout',panels.layout);move('#settingsbox',panels.output);
    move('#convertplan',panels.output);move('#convertgo',panels.output);move('#convertout',panels.output);move('#printersetup',panels.output);
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
    move('#reelscard',panels.colours);move('#colouroutcome',panels.colours);
    // Suggestions are the main colour task; library/calibration are secondary.
    $('supportinterface').after($('recommendation'));
    const oldHeading=$('recommendheading'),heading=make('h2',{id:'recommendheading'});
    heading.textContent=oldHeading.textContent;oldHeading.replaceWith(heading);
    move('#copyoptions',panels.layout);$('copyoptions').open=true;
    move('#exportcard',panels.output);
    move('#advanced',panels.colours);move('#plannercard',panels.output);
    move('#cutoutnote',panels.project);move('.previewdetails',panels.project);
    $('previewheading').textContent='Model & plate';
  }
  move('#chrome-extension',panels.help);
  panels.help.prepend(make('p',{class:'hint'},'The extension download opens the established YAB3D review site. To try its file here, download the original 3MF and use Open model.'));
  const footer=doc.querySelector('#compatibility footer');if(footer)panels.help.append(footer);
  panels.help.append(make('p',{},'This workbench keeps the existing model-processing engines. Generated previews are simplified; slice and inspect the exported project before printing.'));
  for(const key of ['colours','layout','output']) {
    const content=make('div',{'data-requires-model':''});
    const children=[...panels[key].children].filter(n=>!n.classList.contains('task-heading'));
    content.append(...children);panels[key].append(make('p',{'data-before-model':'',class:'hint'},'Open a model to use these controls.'),content);
  }
  if(kind==='converter')for(const node of [$('convertplate').closest('.row'),$('printercapacity'),$('bambuprinter')])node.setAttribute('data-requires-model','');
  for(const p of Object.values(panels))p.querySelectorAll('.card').forEach(n=>n.classList.remove('card'));
  panels.project.hidden=false;
  // Contextual help remains available without consuming the main viewport.
  stage.append(make('div',{class:'stage-caption'},'Drag to orbit · Scroll to zoom · Click an object to select'));
  return {workspace,stage,inspector,panels,move,make,feedback,empty,parking};
}
