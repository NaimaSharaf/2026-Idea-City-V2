'use strict';
// Immutable per-edit files avoid competing writers replacing each other's changes.
// Registers retain concurrent versions until a user explicitly chooses one.
globalThis.SyncLibrary=class SyncLibrary {
 constructor(dir,actor){this.dir=dir;this.actor=actor;this.events=new Map();this.base=null;this.loaded=null;this.heads=new Map();this.conflicts=[];this.stopped=false;}
 static rows(data){return new Map(data.rows.map(row=>['row:'+row.id,row]));}
 static values(data){const values=this.rows(data);values.set('order',data.rows.map(row=>row.id));values.set('name',data.name||'Evidence library');return values;}
 async initialize(data){
  Library.validate(data);
  try{await this.dir.getFileHandle('sync-base.json');}
  catch(error){if(error.name!=='NotFoundError')throw error;await Library.write(this.dir,'sync-base.json',JSON.stringify({...data,revision:null},null,2));}
  return this.open();
 }
 async open(){
  let file;try{file=await (await this.dir.getFileHandle('sync-base.json')).getFile();}catch(error){if(error.name==='NotFoundError')throw Error('Open and save this folder in the updated capture extension first to enable synchronization.');throw error;}
  this.base=Library.validate(JSON.parse(await file.text()));
  this.journal=await this.dir.getDirectoryHandle('changes',{create:true});
  return this.read();
 }
 async read(){
  if(!this.base)throw Error('Library is not connected.');
  let waiting=false,changed=false;
  for await(const [name,handle] of this.journal.entries()){
   if(handle.kind!=='file'||!name.endsWith('.json')||this.events.has(name))continue;
   const text=await (await handle.getFile()).text();
   // A newly created file may still be waiting for its writable stream to close.
   if(!text){waiting=true;continue;}
   let event;try{event=JSON.parse(text);}catch{throw Error('Unreadable change file: '+name+'. Your changes remain on disk.');}
   if(event.project!==this.base.project||typeof event.id!=='string'||!Array.isArray(event.changes))throw Error('Invalid change file: '+name);
   for(const change of event.changes){if(typeof change.key!=='string'||!Array.isArray(change.replaces))throw Error('Invalid change record.');}
   this.events.set(name,event);changed=true;
  }
  if(!changed&&this.materialized){
   const copy=structuredClone(this.materialized);this.loaded=structuredClone(copy.data);this.conflicts=copy.conflicts;this.heads=new Map(this.cachedHeads);return {...copy,waiting};
  }
  const registers=new Map();
  for(const [key,value] of SyncLibrary.values(this.base))registers.set(key,new Map([['base:'+key,{id:'base:'+key,value,actor:'Original library',at:''}]]));
  const removals=new Map();
  for(const event of this.events.values())for(let i=0;i<event.changes.length;i++){
   const change=event.changes[i],id=event.id+':'+i;
   if(!registers.has(change.key))registers.set(change.key,new Map());
   registers.get(change.key).set(id,{id,value:change.value,actor:event.actor||'Another window',at:event.at||''});
   if(!removals.has(change.key))removals.set(change.key,new Set());
   for(const old of change.replaces)removals.get(change.key).add(old);
  }
  const heads=new Map(),values=new Map(),conflicts=[];
  for(const [key,candidates] of registers){
   const live=[...candidates.values()].filter(v=>!removals.get(key)?.has(v.id)).sort((a,b)=>a.id.localeCompare(b.id));
   if(!live.length)continue;
   heads.set(key,live.map(v=>v.id));values.set(key,live[0].value);
   const distinct=new Set(live.map(v=>JSON.stringify(v.value)));
   if(distinct.size>1)conflicts.push({key,versions:live});
  }
  const rows=new Map([...values].filter(([key,value])=>key.startsWith('row:')&&value!==null).map(([,value])=>[value.id,value]));
  const order=Array.isArray(values.get('order'))?values.get('order'):[];
  const ordered=[];for(const id of order){if(rows.has(id)){ordered.push(rows.get(id));rows.delete(id);}}
  ordered.push(...[...rows.values()].sort((a,b)=>a.id.localeCompare(b.id)));
  const ids=[...this.events.keys()].sort().join('|');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ids));
  const revision=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const data=Library.validate({version:2,project:this.base.project,name:values.get('name')||this.base.name,revision,rows:ordered});
  this.heads=heads;this.conflicts=conflicts;this.loaded=structuredClone(data);
  this.materialized={data:structuredClone(data),conflicts:structuredClone(conflicts)};this.cachedHeads=new Map(heads);
  return {data:structuredClone(data),conflicts,waiting};
 }
 async snapshot(data){
  if(this.conflicts.length)return;
  // session.json is a compatibility snapshot; synchronization reads the immutable journal.
  await Library.write(this.dir,'session.json',JSON.stringify({...data,savedAt:new Date().toISOString()},null,2));
 }
 async publish(changes,pending=new Map()){
  const imageDir=await this.dir.getDirectoryHandle('images',{create:true});
  for(const [path,blob] of pending){if(!/^images\/[a-zA-Z0-9_-]+\.(png|jpg|webp)$/.test(path))throw Error('Invalid image path.');await Library.write(imageDir,path.split('/')[1],blob);}
  let eventId=null;
  if(changes.length){const id=crypto.randomUUID();eventId=id;await Library.write(this.journal,id+'.json',JSON.stringify({id,project:this.base.project,actor:this.actor,at:new Date().toISOString(),changes}));}
  pending.clear();const result=await this.read();
  try{await this.snapshot(result.data);}catch(error){result.snapshotError='Changes synchronized, but session.json could not be refreshed: '+error.message;}
  result.eventId=eventId;return result;
 }
 async save(data,pending=new Map()){
  Library.validate(data);if(data.project!==this.base.project)throw Error('Wrong project folder.');
  if(this.conflicts.length)throw Error('Resolve conflicting entries before making more edits.');
  const before=SyncLibrary.values(this.loaded),after=SyncLibrary.values(data),keys=new Set([...before.keys(),...after.keys()]);
  const changes=[];
  for(const key of keys){const old=before.has(key)?before.get(key):null,value=after.has(key)?after.get(key):null;if(JSON.stringify(old)!==JSON.stringify(value))changes.push({key,value,replaces:this.heads.get(key)||[]});}
  const localHeads=new Map(this.heads),localBase=structuredClone(data);
  const result=await this.publish(changes,pending);
  if(result.eventId)changes.forEach((change,i)=>localHeads.set(change.key,[result.eventId+':'+i]));
  result.localContext={loaded:localBase,heads:localHeads,conflicts:[]};return result;
 }
 async resolve(key,value){
  const expected=JSON.stringify(this.heads.get(key)||[]);
  await this.read();
  if(expected!==JSON.stringify(this.heads.get(key)||[]))return {data:structuredClone(this.loaded),conflicts:this.conflicts};
  if(!this.conflicts.some(c=>c.key===key))return {data:structuredClone(this.loaded),conflicts:this.conflicts};
  return this.publish([{key,value,replaces:this.heads.get(key)||[]}]);
 }
};
globalThis.renderSyncConflicts=function(container,conflicts,data,onChoose,dir){
 const signature=JSON.stringify(conflicts.map(c=>[c.key,c.versions.map(v=>v.id)]));
 if(container.dataset.signature===signature)return;container.dataset.signature=signature;
 for(const url of container._imageURLs||[])URL.revokeObjectURL(url);container._imageURLs=[];
 container.replaceChildren();container.hidden=!conflicts.length;
 if(!conflicts.length)return;
 const heading=document.createElement('h2');heading.textContent='Choose which version to keep';container.append(heading);
 for(const conflict of conflicts){
  const section=document.createElement('section'),label=document.createElement('strong');
  const example=conflict.versions.find(v=>v.value&&typeof v.value==='object'&&!Array.isArray(v.value))?.value;
  label.textContent=conflict.key==='order'?'Row order':example?.keyword||example?.title||'Entry changed';section.append(label);
  for(const version of conflict.versions){
   const box=document.createElement('div');box.className='conflict-option';const text=document.createElement('p');
   const v=version.value;
   text.textContent=v===null?'Entry removed':Array.isArray(v)?'Order: '+v.map(id=>data.rows.find(r=>r.id===id)?.keyword||data.rows.find(r=>r.id===id)?.title||id).join(' → '):typeof v==='object'?[v.keyword||v.title,v.year?'Year: '+v.year:'',v.sentence,v.notes?'Notes: '+v.notes:'',v.link,v.screenshot?'Screenshot: '+v.screenshot:'No screenshot'].filter(Boolean).join('\n'):String(v);
   const button=document.createElement('button');button.textContent='Keep '+version.actor+' version';button.onclick=()=>onChoose(conflict.key,version.value);
   box.append(text,button);
   if(v?.screenshot&&dir){const show=document.createElement('button');show.textContent='Compare screenshot';show.onclick=async()=>{show.disabled=true;try{const blob=await Library.image(dir,v.screenshot);if(!box.isConnected)return;const url=URL.createObjectURL(blob);container._imageURLs.push(url);const image=document.createElement('img');image.src=url;image.alt='Screenshot from '+version.actor;image.style.maxWidth='100%';image.style.maxHeight='60vh';image.style.display='block';box.append(image);}catch(error){text.textContent+='\n'+error.message;show.disabled=false;}};box.append(show);}
   section.append(box);
  }
  container.append(section);
 }
};
