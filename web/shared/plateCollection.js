// A source plate keeps its own layout and colour experiment while navigating.
// Deletion is reversible until a new source is opened; it never edits the file.
export class PlateCollection {
  constructor() { this.reset(); }
  reset() { this.edits = new Map(); this.removed = new Set(); this.undo = []; }
  save(id, edit) { if(id != null)this.edits.set(String(id), structuredClone(edit)); }
  get(id) { const edit=this.edits.get(String(id));return edit ? structuredClone(edit) : null; }
  visible(plates) { return plates.filter(p=>!this.removed.has(String(p.id))); }
  remove(id, plates) {
    const visible=this.visible(plates),index=visible.findIndex(p=>String(p.id)===String(id));
    if(index<0)return null;
    if(visible.length<2)throw Error('Keep at least one plate in the project.');
    this.removed.add(String(id));this.undo.push(String(id));
    return visible[index+1]?.id ?? visible[index-1].id;
  }
  restore() { const id=this.undo.pop();if(id!=null)this.removed.delete(id);return id; }
  snapshot() { return {edits:[...this.edits],removed:[...this.removed],undo:[...this.undo]}; }
  restoreSnapshot(saved, plates) {
    const ids=new Set(plates.map(p=>String(p.id)));this.reset();
    for(const [id,edit]of saved?.edits || [])if(ids.has(id))this.save(id,edit);
    this.removed=new Set((saved?.removed || []).filter(id=>ids.has(id)));
    this.undo=(saved?.undo || []).filter(id=>this.removed.has(id));
  }
}
