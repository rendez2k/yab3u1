/** Keeps a copy of the last opened model in this browser so a reload can pick
 * it up again. Nothing leaves the device; the copy is replaced by the next
 * model and removed by Forget or by turning the feature off. */
const DB='yab3d-workbench',STORE='session',KEY='last',CONTEXT='context',PREF='yab3d-session-restore';
export const sameFile=(a,b)=>Boolean(a&&b&&a.name===b.name&&a.size===b.size&&a.lastModified===b.lastModified);
export function describeAge(savedAt,now=Date.now()){
  const minutes=Math.max(0,Math.round((now-savedAt)/60000));
  if(minutes<1)return 'just now';
  if(minutes<60)return `${minutes} minute${minutes===1?'':'s'} ago`;
  const hours=Math.round(minutes/60);if(hours<24)return `${hours} hour${hours===1?'':'s'} ago`;
  const days=Math.round(hours/24);return `${days} day${days===1?'':'s'} ago`;
}
/** Only plain settings survive; anything else in a context is dropped. */
export function plainContext(context){try{return JSON.parse(JSON.stringify(context||{}));}catch{return {};}}
export function createSessionStore({indexedDB=globalThis.indexedDB,storage=globalThis.localStorage}={}){
  const open=()=>new Promise((resolve,reject)=>{
    if(!indexedDB){reject(Error('No local storage for sessions.'));return;}
    const request=indexedDB.open(DB,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  const run=async(mode,work)=>{const db=await open();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode),request=work(tx.objectStore(STORE));tx.oncomplete=()=>resolve(request.result);tx.onerror=tx.onabort=()=>reject(tx.error||Error('Session storage failed.'));});}finally{db.close();}};
  const enabled=()=>{try{return storage?.getItem(PREF)!=='off';}catch{return true;}};
  return {
    enabled,
    async setEnabled(value){try{storage?.setItem(PREF,value?'on':'off');}catch{}if(!value)await this.clear();},
    async save(record){if(!enabled())return false;try{await run('readwrite',store=>{store.delete(CONTEXT);return store.put(record,KEY);});return true;}catch{return false;}},
    // Settings change far more often than the model, so they are written on their own.
    async saveContext(context,extra={}){if(!enabled())return false;try{await run('readwrite',store=>store.put({...extra,context,savedAt:Date.now()},CONTEXT));return true;}catch{return false;}},
    async read(){if(!enabled())return null;try{const record=await run('readonly',store=>store.get(KEY));if(!record?.blob)return null;const later=await run('readonly',store=>store.get(CONTEXT));return later?{...record,...later,blob:record.blob,savedAt:Math.max(record.savedAt||0,later.savedAt||0)}:record;}catch{return null;}},
    async clear(){try{await run('readwrite',store=>{store.delete(CONTEXT);return store.delete(KEY);});}catch{}},
  };
}
