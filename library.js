'use strict';
globalThis.Library=(()=>{
 const uuid=()=>crypto.randomUUID();
 function empty(project,name){return {version:2,project,name,revision:null,rows:[]};}
 function validate(data){
  if(!data||data.version!==2||typeof data.project!=='string'||!Array.isArray(data.rows))throw Error('This is not a local library session.');
  if(data.rows.length>50000)throw Error('Too many rows.');
  const ids=new Set();
  for(const row of data.rows){
   if(!row||typeof row.id!=='string'||ids.has(row.id))throw Error('Invalid or duplicate row ID.');ids.add(row.id);
   if(row.kind==='section'){if(typeof row.title!=='string')throw Error('Invalid section.');continue;}
   if(typeof row.keyword!=='string'||typeof row.sentence!=='string'||typeof row.link!=='string')throw Error('Invalid row.');
   if(row.link&&!/^https?:\/\//i.test(row.link))throw Error('Links must start with http:// or https://.');
   if(row.screenshot&&!/^images\/[a-zA-Z0-9_-]+\.(png|jpg|webp)$/.test(row.screenshot))throw Error('Invalid screenshot path.');
  }
  return data;
 }
 async function read(dir){try{const file=await (await dir.getFileHandle('session.json')).getFile();return validate(JSON.parse(await file.text()));}catch(e){if(e.name==='NotFoundError')return null;throw e;}}
 async function write(dir,name,content){const handle=await dir.getFileHandle(name,{create:true});const stream=await handle.createWritable();try{await stream.write(content);await stream.close();}catch(e){await stream.abort().catch(()=>{});throw e;}}
 async function save(dir,data,pending,viewerHTML){
  validate(data);
  const current=await read(dir);
  if((current?.revision||null)!==(data.revision||null))throw Error('This library changed on disk. Reload it before saving; your current edits have not been written.');
  if(current&&current.project!==data.project)throw Error('This folder belongs to another Overleaf project.');
  const images=await dir.getDirectoryHandle('images',{create:true});
  for(const [path,blob] of pending)await write(images,path.split('/')[1],blob);
  // Keep a recoverable text snapshot; screenshots have immutable filenames.
  if(current)await write(dir,'session.previous.json',JSON.stringify(current,null,2));
  if(viewerHTML)await write(dir,'viewer.html',viewerHTML);
  const saved={...data,revision:uuid(),savedAt:new Date().toISOString()};
  await write(dir,'session.json',JSON.stringify(saved,null,2));pending.clear();return saved;
 }
 async function image(dir,path,pending){
  if(pending?.has(path))return pending.get(path);
  if(!/^images\/[a-zA-Z0-9_-]+\.(png|jpg|webp)$/.test(path))throw Error('Invalid image path.');
  return (await (await dir.getDirectoryHandle('images')).getFileHandle(path.split('/')[1])).getFile();
 }
 async function picture(file){
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>16*1024*1024)throw Error('Use a PNG, JPEG or WebP under 16 MB.');
  const bitmap=await createImageBitmap(file);try{
   const scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
   canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('Could not convert screenshot.');return blob;
  }finally{bitmap.close();}
 }
 async function migrate(old){
  if(old?.version!==1||typeof old.project!=='string'||!Array.isArray(old.rows))throw Error('Choose a JSON session from the original extension.');
  const pending=new Map(),data=empty(old.project,old.name||'Imported library');
  for(const row of old.rows){
   if(row.kind==='section'){data.rows.push({id:uuid(),kind:'section',title:String(row.title||'Section')});continue;}
   if(typeof row.keyword!=='string'||typeof row.sentence!=='string')throw Error('Invalid legacy row.');
   const next={id:uuid(),keyword:row.keyword,sentence:row.sentence,link:row.link||'',screenshot:'',incomplete:!!row.incomplete};
   if(row.screenshot){
    const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(row.screenshot);if(!match)throw Error('Unsupported legacy screenshot.');
    const bytes=Uint8Array.from(atob(match[2].replace(/\s/g,'')),c=>c.charCodeAt(0));
    const ext=match[1]==='image/jpeg'?'jpg':match[1].split('/')[1];next.screenshot='images/'+uuid()+'.'+ext;pending.set(next.screenshot,new Blob([bytes],{type:match[1]}));
   }
   data.rows.push(next);
  }
  validate(data);return {data,pending};
 }
 return {uuid,empty,validate,read,write,save,image,picture,migrate};
})();
