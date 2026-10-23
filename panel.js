'use strict';
// Idea City — side panel. Like the Overleaf capture panel: a compact editor for one idea at a time,
// joined to the same library folder and sync journal (as "Side panel") as the viewer and the Station.
const $=id=>document.getElementById(id);
const OUT='__outskirts',PREFIX='ideas:';
let dir=null,sync=null,data=null,base=null,current=null,dirty=false,busy=false,editGen=0,timer=0,conflicts=[];
const pending=new Map(); // screenshots waiting to be written to images/ with the next sync
const tell=m=>$('status').textContent=m;
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const clone=v=>structuredClone(v);
const isNote=r=>r&&r.kind!=='section';
const byId=id=>data?.rows.find(r=>r.id===id);
const label=r=>r?.keyword||'Untitled idea';
const cleanTags=s=>{const seen=new Set(),out=[];for(const t of String(s||'').split(',')){const v=t.trim();if(v&&!seen.has(v.toLowerCase())){seen.add(v.toLowerCase());out.push(v);}}return out.join(', ');};

// ---------- folder memory (shared with the viewer and the Station) ----------
const idb=new Promise(res=>{const r=indexedDB.open('idea-city',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>res(null);});
async function kv(k,v){const db=await idb;if(!db)return;return new Promise(res=>{try{const tx=db.transaction('kv',v===undefined?'readonly':'readwrite'),s=tx.objectStore('kv'),q=v===undefined?s.get(k):s.put(v,k);q.onsuccess=()=>res(q.result);q.onerror=()=>res();}catch{res();}});}
async function isEmptyFolder(h){for await(const [name] of h.entries())if(!/^\.|^desktop\.ini$/i.test(name))return false;return true;}
async function hasSyncBase(h){try{await h.getFileHandle('sync-base.json');return true;}catch(e){if(e.name==='NotFoundError')return false;throw e;}}

async function connect(handle){
 if(await handle.queryPermission({mode:'readwrite'})!=='granted'&&await handle.requestPermission({mode:'readwrite'})!=='granted')throw Error('Folder access was not granted.');
 if(!await hasSyncBase(handle)&&!await isEmptyFolder(handle)&&!confirm(handle.name+' is not empty and is not an Idea City library. Start a new ideas library in it anyway?'))return;
 const s=new SyncLibrary(handle,'Side panel');
 const result=await s.initialize(Library.empty(PREFIX+Library.uuid(),handle.name));
 if(!result.data.project.startsWith(PREFIX))throw Error(handle.name+' belongs to another library (such as your Citations or Presentations library). Choose an Idea City folder.');
 dir=handle;sync=s;dirty=false;apply(result);
 await kv('folder',handle);$('reconnect').hidden=true;$('intro').hidden=true;$('work').hidden=false;
 chrome.runtime.sendMessage({type:'nc-folder'}).catch(()=>{}); // open viewer/Station tabs follow along
 tell(conflicts.length?'Connected, but some ideas have conflicting edits. Choose a version in the viewer.':'Connected to '+handle.name+'. Changes sync automatically.');
}
function apply(result){data=result.data;base=clone(data);conflicts=result.conflicts||[];draw();}

// ---------- sync (same three-way merge as the viewer, so nobody's edits are lost) ----------
function rebase(mine,old,theirs){
 const m=new Map(mine.rows.map(r=>[r.id,r])),o=new Map(old.rows.map(r=>[r.id,r])),t=new Map(theirs.rows.map(r=>[r.id,r])),rows=new Map();
 for(const id of new Set([...m.keys(),...o.keys(),...t.keys()])){
  const a=m.get(id),b=o.get(id),c=t.get(id);
  if(eq(a,b)){if(c)rows.set(id,c);continue;}
  if(!a)continue;
  if(!b||!c){rows.set(id,a);continue;}
  const merged={};for(const f of new Set([...Object.keys(a),...Object.keys(b),...Object.keys(c)])){const v=eq(a[f],b[f])?c[f]:a[f];if(v!==undefined)merged[f]=v;}
  rows.set(id,merged);
 }
 const order=eq(mine.rows.map(r=>r.id),old.rows.map(r=>r.id))?theirs.rows.map(r=>r.id):mine.rows.map(r=>r.id);
 const out=[];for(const id of order)if(rows.has(id)){out.push(rows.get(id));rows.delete(id);}
 for(const [id,row] of rows){const i=theirs.rows.findIndex(r=>r.id===id),prevId=i>0?theirs.rows[i-1].id:null,at=prevId?out.findIndex(r=>r.id===prevId)+1:0;out.splice(at>0?at:(i===0?0:out.length),0,row);}
 return {...theirs,rows:out};
}
function edited(){if(!sync)return;editGen++;dirty=true;tell('Syncing shortly…');clearTimeout(timer);timer=setTimeout(flush,900);}
async function flush(){
 if(!sync||!dirty)return;
 if(busy){clearTimeout(timer);timer=setTimeout(flush,300);return;}
 if(conflicts.length){tell('Some ideas have conflicting edits. Open the viewer and choose a version; your edits are kept here.');return;}
 busy=true;const gen=editGen;
 try{
  const latest=(await sync.read()).data,next=rebase(data,base,latest);
  const result=await sync.save(next,pending);
  if(gen===editGen){dirty=false;apply(result);tell(result.snapshotError||'All changes synced.');}
  else{data=rebase(data,next,result.data);base=clone(result.data);conflicts=result.conflicts||[];clearTimeout(timer);timer=setTimeout(flush,300);}
 }catch(e){tell(/conflict/i.test(e.message)?'Some ideas have conflicting edits. Choose a version in the viewer.':'Not synced: '+e.message+' Your edits stay here.');}
 finally{busy=false;}
}
// Pick up edits from the viewer and the Station.
setInterval(async()=>{
 if(!sync||busy||dirty)return;busy=true;
 try{const r=await sync.read();if(r.data.revision!==data.revision||r.conflicts.length!==conflicts.length)apply(r);}catch(e){tell(e.message);}finally{busy=false;}
},2500);
addEventListener('pagehide',()=>{if(dirty)flush();});

// ---------- library model ----------
function groups(){
 const list=[{id:OUT,title:'Airlock',entries:[]}];
 for(const r of data?.rows||[]){if(r.kind==='section')list.push({id:r.id,title:r.title||'Untitled module',entries:[]});else list.at(-1).entries.push(r);}
 return list;
}
const moduleOf=id=>groups().find(g=>g.entries.some(r=>r.id===id))?.id||OUT;
function insertAt(rows,houseId){
 if(houseId===OUT){const i=rows.findIndex(r=>r.kind==='section');return i<0?rows.length:i;}
 let at=rows.findIndex(r=>r.id===houseId)+1;if(!at)return rows.length;
 while(at<rows.length&&rows[at].kind!=='section')at++;return at;
}
function setVal(id,v){const el=$(id);if(document.activeElement!==el&&el.value!==v)el.value=v;}

function draw(){
 $('lib').hidden=!data;
 if(!data)return;
 const n=data.rows.filter(isNote).length;$('lib').textContent=(dir?.name||'Library')+' · '+n+' idea'+(n===1?'':'s');
 const gs=groups();
 // note picker, grouped by module
 const sel=$('entry');sel.replaceChildren();
 for(const g of gs){if(!g.entries.length)continue;const og=document.createElement('optgroup');og.label=g.title;for(const r of g.entries)og.append(new Option(label(r).slice(0,80),r.id));sel.append(og);}
 if(!n)sel.append(new Option('No ideas yet. Click ＋ New',''));
 if(!isNote(byId(current))){const saved=sessionStorage.getItem('nc-current');current=isNote(byId(saved))?saved:data.rows.find(isNote)?.id||null;}
 sel.value=current||'';
 // module picker
 const mod=$('module'),keep=current?moduleOf(current):(sessionStorage.getItem('nc-module')||OUT);mod.replaceChildren();
 for(const g of gs)mod.append(new Option(g.title,g.id));mod.value=gs.some(g=>g.id===keep)?keep:OUT;mod.append(new Option('＋ New module…','__new'));
 const r=byId(current);$('editor').hidden=!r;$('del').disabled=$('show').disabled=$('grab').disabled=!r;
 if(r){setVal('title',r.keyword||'');setVal('tags',r.tags||'');setVal('text',r.notes||'');
  const lines=(r.notes||'').split(/\r?\n/).filter(l=>l.trim()).length,links=Array.isArray(r.links)?r.links.length:0;
  $('meta').textContent=(lines?lines+' thought'+(lines>1?'s':''):'No notes yet')+' · 🔗 '+links+' linked (add links in the viewer)';}
 drawPaper(r);drawPics(r);
 $('module').disabled=false;
}
// ---------- papers: page title, link, screenshot, and optional BibTeX ----------
let movePending=false,shotPath=null,shotURL=null,bibBox=null;
function drawPaper(r){
 const on=!!r?.paper;$('paper-box').hidden=!on;$('paper').disabled=!sync;
 if(!on){drawShot(null);return;}
 setVal('link',r.link||'');
 $('open-link').disabled=!r.link;$('rm-shot').disabled=!r.screenshot;
 drawShot(r);
 // BibTeX box: rebuilt only when switching ideas, so typing is never interrupted
 const host=$('bib-box');
 if(bibBox?.dataset.id===r.id)bibBox.refresh(r.bibtex);
 else{
  bibBox=Bib.field(r,{onEdit:v=>{const x=live();if(!x)return;if(v.trim())x.bibtex=v;else delete x.bibtex;$('bib-sum').textContent=x.bibtex?'BibTeX ✓':'＋ Add BibTeX';edited();},tell});
  bibBox.dataset.id=r.id;host.replaceChildren(bibBox);$('bib-wrap').open=!!r.bibtex;
 }
 $('bib-sum').textContent=r.bibtex?'BibTeX ✓':'＋ Add BibTeX';
}
async function drawShot(r){
 const host=$('shot-view'),path=r?.screenshot||'';
 if(path===shotPath)return;shotPath=path;
 if(shotURL){URL.revokeObjectURL(shotURL);shotURL=null;}
 host.replaceChildren();
 if(!path){host.textContent=r?'No screenshot. Click Retake screenshot on the paper\'s page, or paste one.':'';return;}
 try{
  const blob=await Library.image(dir,path,pending);if(shotPath!==path)return;
  shotURL=URL.createObjectURL(blob);const img=new Image();img.src=shotURL;img.alt='Screenshot of '+label(r);img.title='Click to open full size';
  img.onclick=()=>window.open(shotURL,'_blank');host.replaceChildren(img);
 }catch(e){shotPath=null;host.textContent='Screenshot not found ('+e.message+').';}
}
// Screenshot of what is visible in the current tab. Chrome's screenshot API needs access to all sites
// (asked once). askCapture() must run first thing in a click, before any await, or Chrome ignores it.
const askCapture=()=>chrome.permissions.request({origins:['<all_urls>']});
async function capturePage(asked){
 if(!await asked)throw Error('Screenshot access was not allowed. Take a screenshot yourself and use Paste screenshot.');
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
 if(!tab?.id||!/^https?:/.test(tab.url||''))throw Error('Open the paper\'s web page first (a regular http/https page).');
 const shot=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});
 const blob=await Library.picture(await (await fetch(shot)).blob());
 return {tab,blob};
}
function setShot(r,blob){
 if(r.screenshot&&pending.has(r.screenshot))pending.delete(r.screenshot);
 r.screenshot='images/'+Library.uuid()+'.png';pending.set(r.screenshot,blob);
}
$('paper').onclick=async()=>{
 if(!sync)return tell('Choose a library folder first.');
 const asked=askCapture(),btn=$('paper');btn.disabled=true;tell('Taking a screenshot of this page…');
 try{
  const {tab,blob}=await capturePage(asked);
  const same=data.rows.find(r=>isNote(r)&&r.paper&&r.link===tab.url);
  if(same){pick(same.id);tell('This page is already saved as "'+label(same)+'". Use Retake screenshot to update it.');return;}
  const to=$('module').value||OUT,title=(tab.title||new URL(tab.url).hostname).trim().slice(0,300)||'Untitled paper';
  const row={id:Library.uuid(),keyword:title,sentence:'',link:tab.url,screenshot:'',paper:true,tags:'paper'};
  setShot(row,blob);data.rows.splice(insertAt(data.rows,to),0,row);edited();pick(row.id);
  tell('Paper saved with a screenshot of '+new URL(tab.url).hostname+'. Add BibTeX below if you have it.');
 }catch(e){tell(e.message);}
 finally{btn.disabled=!sync;}
};
$('shot').onclick=async()=>{
 const r=live();if(!r)return;const asked=askCapture();tell('Taking a screenshot of this page…');
 try{const {tab,blob}=await capturePage(asked);setShot(r,blob);if(!r.link)r.link=tab.url;edited();draw();tell('Screenshot updated from '+new URL(tab.url).hostname+'.');}catch(e){tell(e.message);}
};
$('paste-shot').onclick=()=>{$('paste-shot').focus();tell('Now press ⌘V / Ctrl+V to paste the image.');};
$('paste-shot').addEventListener('paste',async e=>{
 e.preventDefault();const r=live();if(!r)return;
 const file=[...e.clipboardData.items].find(i=>i.kind==='file'&&i.type.startsWith('image/'))?.getAsFile();
 if(!file)return tell('No image in the clipboard.');
 try{setShot(r,await Library.picture(file));edited();draw();tell('Screenshot pasted.');}catch(err){tell(err.message);}
});
$('rm-shot').onclick=()=>{const r=live();if(!r?.screenshot)return;pending.delete(r.screenshot);r.screenshot='';edited();draw();tell('Screenshot removed.');};
$('link').oninput=()=>{const r=live();if(!r)return;const v=$('link').value.trim();
 if(v&&!/^https?:\/\//i.test(v)){tell('Links must start with http:// or https://');return;}
 r.link=v;$('open-link').disabled=!v;edited();};
$('open-link').onclick=()=>{const v=live()?.link;if(v)chrome.tabs.create({url:v});};

// ---------- screenshots on any idea: paste (⌘V anywhere in the panel) or drop images ----------
const picURLs=new Map();let picsFor=null;
function drawPics(r){
 const box=$('pics'),list=r?.images||[],key=(r?.id||'')+'|'+list.join(',');
 $('paste-pic').disabled=!r;if(key===picsFor)return;picsFor=key;
 for(const [p,u] of picURLs)if(!list.includes(p)){URL.revokeObjectURL(u);picURLs.delete(p);}
 box.replaceChildren();
 if(!list.length){const p=document.createElement('p');p.className='small';p.textContent='Copy a screenshot (⌘⇧⌃4 on a Mac), then press ⌘V anywhere in this panel. You can also drop image files here.';box.append(p);return;}
 list.forEach((path,i)=>{
  const fig=document.createElement('div');fig.className='pic';const img=new Image();img.alt='Screenshot '+(i+1)+' of '+label(r);img.title='Click to open full size';
  const rm=document.createElement('button');rm.textContent='×';rm.title='Remove this screenshot';rm.className='danger';
  rm.onclick=()=>{const x=live();if(!x||!confirm('Remove this screenshot?'))return;pending.delete(path);x.images=(x.images||[]).filter(p=>p!==path);if(!x.images.length)delete x.images;edited();draw();tell('Screenshot removed.');};
  fig.append(img,rm);box.append(fig);
  const show=u=>{img.src=u;img.onclick=()=>window.open(u,'_blank');};
  if(picURLs.has(path))show(picURLs.get(path));
  else Library.image(dir,path,pending).then(b=>{const u=URL.createObjectURL(b);picURLs.set(path,u);show(u);}).catch(()=>{img.alt='Not found yet (still syncing?)';});
 });
}
async function addPics(files){
 const r=live();if(!r)return tell('Pick or create an idea first (＋ New).');
 const imgs=files.filter(f=>f&&f.type.startsWith('image/'));if(!imgs.length)return tell('No image found. Copy a screenshot first.');
 try{
  const added=[];for(const f of imgs){const blob=await Library.picture(f),path='images/'+Library.uuid()+'.png';pending.set(path,blob);added.push(path);}
  r.images=[...(r.images||[]),...added];edited();draw();tell(added.length===1?'Screenshot added.':added.length+' screenshots added.');
 }catch(e){tell(e.message);}
}
$('paste-pic').onclick=()=>{$('paste-pic').focus();tell('Now press ⌘V / Ctrl+V to paste the screenshot.');};
document.addEventListener('paste',e=>{
 if(e.defaultPrevented)return; // the paper's own Paste screenshot button handled it
 const files=[...e.clipboardData.items].filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile());
 if(!files.length)return; // plain text pastes normally
 e.preventDefault();addPics(files);
});
const drop=$('pics');
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('over');});
drop.addEventListener('dragleave',()=>drop.classList.remove('over'));
drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('over');addPics([...e.dataTransfer.files]);});

function pick(id){current=id;try{sessionStorage.setItem('nc-current',id||'');}catch{}draw();}

// ---------- actions ----------
const live=()=>byId(current);
$('entry').onchange=()=>{if(dirty)flush();pick($('entry').value);};
$('title').oninput=()=>{const r=live();if(!r)return;r.keyword=$('title').value.trimStart()||'Untitled idea';edited();};
$('title').onchange=()=>draw();
$('tags').onchange=()=>{const r=live();if(!r)return;const v=cleanTags($('tags').value);if(v)r.tags=v;else delete r.tags;$('tags').value=v;edited();draw();};
$('text').oninput=()=>{const r=live();if(!r)return;const v=$('text').value;if(v)r.notes=v;else delete r.notes;edited();};
$('module').onchange=()=>{
 if($('module').value==='__new'){movePending=true;draw();$('mod-name').focus();tell('Type a name for the new module, then click ＋ Add module. The current idea moves into it.');return;}
 const to=$('module').value;try{sessionStorage.setItem('nc-module',to);}catch{}
 const r=live();if(!r||moduleOf(r.id)===to)return;
 const i=data.rows.findIndex(x=>x.id===r.id),[row]=data.rows.splice(i,1);data.rows.splice(insertAt(data.rows,to),0,row);edited();draw();
 tell('Moved to '+$('module').selectedOptions[0].text+'.');
};
$('new').onclick=()=>{
 if(!data)return;
 const to=$('module').value||OUT,row={id:Library.uuid(),keyword:'Untitled idea',sentence:'',link:'',screenshot:''};
 data.rows.splice(insertAt(data.rows,to),0,row);edited();pick(row.id);$('title').value='';$('title').focus();
};
$('del').onclick=()=>{
 const r=live();if(!r||!confirm('Delete "'+label(r)+'"?'))return;
 if(r.screenshot)pending.delete(r.screenshot);for(const p of r.images||[])pending.delete(p);
 for(const o of data.rows)if(Array.isArray(o.links)&&o.links.includes(r.id)){o.links=o.links.filter(i=>i!==r.id);if(!o.links.length)delete o.links;}
 data.rows=data.rows.filter(x=>x.id!==r.id);current=null;edited();draw();tell('Idea deleted.');
};
$('mod-form').onsubmit=e=>{
 e.preventDefault();if(!data)return;const name=$('mod-name').value.trim();if(!name)return;
 const row={id:Library.uuid(),kind:'section',title:name};data.rows.push(row);$('mod-name').value='';
 try{sessionStorage.setItem('nc-module',row.id);}catch{}
 const r=live(),moving=r&&movePending;movePending=false;
 if(moving){const i=data.rows.findIndex(x=>x.id===r.id),[x]=data.rows.splice(i,1);data.rows.push(x);}
 edited();draw();$('module').value=row.id;
 tell('Module "'+name+'" docked.'+(moving?' "'+label(r)+'" moved into it.':' Click ＋ New to add an idea in it.'));
};

// Insert the text highlighted on the current tab (asks for access to that site the first time).
$('grab').onclick=async()=>{
 const r=live();if(!r)return;
 try{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id||!/^https?:/.test(tab.url||''))throw Error('Highlight text on a regular web page first.');
  const run=()=>chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>String(getSelection()||'').trim()});
  let res;
  try{[res]=await run();}
  catch{ // no access yet (activeTab only covers the tab where you clicked the icon): ask once for this site
   const origin=new URL(tab.url).origin+'/*';
   if(!await chrome.permissions.request({origins:[origin]}))throw Error('Access to this site was not allowed.');
   [res]=await run();
  }
  const text=res?.result;if(!text)throw Error('Nothing is highlighted on this page.');
  const box=$('text'),at=document.activeElement===box?box.selectionStart:box.value.length;
  const before=box.value.slice(0,at),after=box.value.slice(at),add=(before&&!before.endsWith('\n')?'\n':'')+text+(after&&!after.startsWith('\n')?'\n':'');
  box.value=before+add+after;r.notes=box.value;edited();draw();tell('Added '+text.length+' characters from '+new URL(tab.url).hostname+'.');
 }catch(e){tell(e.message);}
};

async function openApp(view,focus){
 if(dirty)await flush();
 const url=chrome.runtime.getURL('app.html');
 const tabs=await chrome.tabs.query({}).catch(()=>[]);const t=tabs.find(x=>x.url?.startsWith(url));
 if(t){await chrome.tabs.update(t.id,{active:true});await chrome.windows.update(t.windowId,{focused:true}).catch(()=>{});}
 else{await chrome.tabs.create({url:url+(focus?'?focus='+encodeURIComponent(focus):'')+'#'+view});return;}
 chrome.runtime.sendMessage({type:'nc-show',view,focus}).catch(()=>{});
}
$('open-viewer').onclick=()=>openApp('entries');
$('open-station').onclick=()=>openApp('city');
$('show').onclick=()=>openApp('city',current);
$('sync').onclick=async()=>{if(!sync)return tell('Choose a library folder first.');if(dirty)await flush();else{try{apply(await sync.read());tell('Up to date.');}catch(e){tell(e.message);}}};

$('folder').onclick=async()=>{try{if(dirty)await flush();const h=await showDirectoryPicker({mode:'readwrite',id:'idea-city'});await connect(h);}catch(e){if(e.name!=='AbortError')tell(e.message);}};
$('reconnect').onclick=async()=>{try{const h=await kv('folder');if(h)await connect(h);}catch(e){tell(e.message);}};
// The viewer or Station chose a folder: follow it.
chrome.runtime.onMessage.addListener(async msg=>{if(msg?.type==='nc-folder-app'){try{const h=await kv('folder');if(h&&!(dir&&await dir.isSameEntry(h))){if(dirty)await flush();await connect(h);}}catch(e){tell(e.message);}}});
(async()=>{
 const h=await kv('folder');if(!h)return;
 if(await h.queryPermission({mode:'readwrite'})==='granted'){try{await connect(h);}catch(e){tell(e.message);}}
 else{$('reconnect').textContent='Reconnect '+h.name;$('reconnect').hidden=false;}
})();
