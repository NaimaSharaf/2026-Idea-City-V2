'use strict';
// Idea City — Entries view. Viewer and editor in one: open the library folder, add ideas,
// tag them, link them to each other and organise them into station modules. Joins the sync
// journal as "Entries page"; the Station view in the same window picks changes up automatically.
const $=id=>document.getElementById(id);
const OUT='__outskirts',PREFIX='ideas:';
let dir=null,sync=null,data=null,base=null,readOnly=false,dirty=false,busy=false,editGen=0,timer=0,conflicts=[],flashId=null,tagFilter=null;
const tell=m=>$('status').textContent=m;
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const clone=v=>structuredClone(v);
const inFrame=parent!==window;
const toParent=msg=>{if(inFrame)parent.postMessage(msg,location.origin);};

// Tag colours match the astronauts' suits on the Station.
const TAGCOLORS=['#ff6b6b','#ffd166','#06d6a0','#4cc9f0','#c77dff','#f4a261','#90be6d','#f72585','#a3c4f3','#e9c46a'];
const hash=s=>{let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
const tagColor=t=>TAGCOLORS[hash(t.toLowerCase())%TAGCOLORS.length];
function tagsOf(r){const seen=new Set(),out=[];for(const t of String(r?.tags||'').split(',')){const s=t.trim();if(s&&!seen.has(s.toLowerCase())){seen.add(s.toLowerCase());out.push(s);}}return out;}
const cleanTags=s=>tagsOf({tags:s}).join(', ');

// ---------- folder memory (shared with the Station view) ----------
const idb=new Promise(res=>{const r=indexedDB.open('idea-city',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>res(null);});
async function kv(k,v){const db=await idb;if(!db)return;return new Promise(res=>{try{const tx=db.transaction('kv',v===undefined?'readonly':'readwrite'),s=tx.objectStore('kv'),q=v===undefined?s.get(k):s.put(v,k);q.onsuccess=()=>res(q.result);q.onerror=()=>res();}catch{res();}});}

async function isEmptyFolder(handle){for await(const [name] of handle.entries())if(!/^\.|^desktop\.ini$/i.test(name))return false;return true;}
async function hasSyncBase(handle){try{await handle.getFileHandle('sync-base.json');return true;}catch(e){if(e.name==='NotFoundError')return false;throw e;}}

async function connect(handle){
 if(await handle.queryPermission({mode:'readwrite'})!=='granted'&&await handle.requestPermission({mode:'readwrite'})!=='granted')throw Error('Folder access was not granted.');
 if(!await hasSyncBase(handle)&&!await isEmptyFolder(handle)&&!confirm(handle.name+' is not empty and is not an Idea City library. Start a new ideas library in it anyway?'))return;
 const s=new SyncLibrary(handle,'Entries page');
 const result=await s.initialize(Library.empty(PREFIX+Library.uuid(),handle.name));
 if(!result.data.project.startsWith(PREFIX))throw Error(handle.name+' belongs to another library (such as your Citations or Presentations library). Choose a new, empty folder for Idea City.');
 dir=handle;sync=s;readOnly=false;dirty=false;apply(result);hideResume();
 await kv('folder',handle);$('reconnect').hidden=true;
 toParent({type:'ic-folder'}); // the Station (re)connects only if it isn't on this folder yet
 tell(conflicts.length?'Connected, but some ideas have conflicting edits. Choose a version below.':'Connected to '+handle.name+'. Changes sync automatically with the Station.');
}
function apply(result){data=result.data;base=clone(data);conflicts=result.conflicts||[];if(result.snapshotError)tell(result.snapshotError);render();}

// ---------- three-way merge so the Station's edits (layout, moves) are never overwritten ----------
function rebase(mine,old,theirs){
 const m=new Map(mine.rows.map(r=>[r.id,r])),o=new Map(old.rows.map(r=>[r.id,r])),t=new Map(theirs.rows.map(r=>[r.id,r])),rows=new Map();
 for(const id of new Set([...m.keys(),...o.keys(),...t.keys()])){
  const a=m.get(id),b=o.get(id),c=t.get(id);
  if(eq(a,b)){if(c)rows.set(id,c);continue;}         // untouched here → take theirs
  if(!a)continue;                                    // removed here
  if(!b||!c){rows.set(id,a);continue;}               // new here, or removed there but edited here
  const merged={};for(const f of new Set([...Object.keys(a),...Object.keys(b),...Object.keys(c)])){const v=eq(a[f],b[f])?c[f]:a[f];if(v!==undefined)merged[f]=v;}
  rows.set(id,merged);
 }
 const order=eq(mine.rows.map(r=>r.id),old.rows.map(r=>r.id))?theirs.rows.map(r=>r.id):mine.rows.map(r=>r.id);
 const out=[];for(const id of order)if(rows.has(id)){out.push(rows.get(id));rows.delete(id);}
 // Rows added elsewhere that this order doesn't know about: keep them next to their old neighbour.
 for(const [id,row] of rows){const i=theirs.rows.findIndex(r=>r.id===id),prevId=i>0?theirs.rows[i-1].id:null,at=prevId?out.findIndex(r=>r.id===prevId)+1:0;out.splice(at>0?at:(i===0?0:out.length),0,row);}
 return {...theirs,rows:out};
}

// ---------- saving ----------
function edited(){if(readOnly||!sync)return;editGen++;dirty=true;tell('Syncing shortly…');clearTimeout(timer);timer=setTimeout(flush,900);}
async function flush(){
 if(!sync||!dirty)return;
 if(busy){clearTimeout(timer);timer=setTimeout(flush,300);return;}
 if(conflicts.length){tell('Choose a version for the conflicting ideas first; your edits are kept on this page.');return;}
 busy=true;const gen=editGen;
 try{
  const latest=(await sync.read()).data,next=rebase(data,base,latest);
  const result=await sync.save(next,new Map());
  if(gen===editGen){dirty=false;apply(result);tell(result.snapshotError||'All changes synced.');}
  else{data=rebase(data,next,result.data);base=clone(result.data);conflicts=result.conflicts||[];render();clearTimeout(timer);timer=setTimeout(flush,300);}
 }catch(e){tell(/conflict/i.test(e.message)?'Some ideas have conflicting edits. Choose a version below.':'Not synced: '+e.message+' Your edits stay on this page.');try{const r=await sync.read();conflicts=r.conflicts;renderConflicts();}catch{}}
 finally{busy=false;}
}
setInterval(async()=>{
 if(!sync||busy||dirty||document.hidden&&!inFrame)return;busy=true;
 try{const r=await sync.read();if(r.data.revision!==data.revision||r.conflicts.length!==conflicts.length)apply(r);}catch(e){tell(e.message);}finally{busy=false;}
},2500);
addEventListener('beforeunload',e=>{if(dirty){flush();e.preventDefault();}});

// ---------- library model ----------
function groups(){
 const list=[{id:OUT,title:'Airlock',row:null,entries:[]}];
 for(const r of data?.rows||[]){if(r.kind==='section')list.push({id:r.id,title:r.title,row:r,entries:[]});else list.at(-1).entries.push(r);}
 return list;
}
function insertAt(rows,houseId){
 if(houseId===OUT){const i=rows.findIndex(r=>r.kind==='section');return i<0?rows.length:i;}
 let at=rows.findIndex(r=>r.id===houseId)+1;if(!at)return rows.length;
 while(at<rows.length&&rows[at].kind!=='section')at++;return at;
}
function moveTo(id,houseId){const i=data.rows.findIndex(r=>r.id===id);if(i<0)return;const [row]=data.rows.splice(i,1);data.rows.splice(insertAt(data.rows,houseId),0,row);flashId=id;edited();render();}
function step(id,d){const i=data.rows.findIndex(r=>r.id===id),j=i+d;if(i<0||j<0||j>=data.rows.length||data.rows[j].kind==='section')return;[data.rows[i],data.rows[j]]=[data.rows[j],data.rows[i]];edited();render();}
// Rows are re-created when sync merges, so handlers always look up the current row by id.
const byId=id=>data?.rows.find(r=>r.id===id);
const live=row=>byId(row.id)||row;
const label=r=>r?.keyword||'Untitled idea';
const isIdea=r=>r&&r.kind!=='section';
// Links are stored on both ideas, so either side can show and remove them.
const linksOf=r=>[...new Set(Array.isArray(r.links)?r.links:[])].filter(id=>id!==r.id&&isIdea(byId(id)));
function link(a,b){if(a===b)return;for(const [x,y] of [[a,b],[b,a]]){const r=byId(x);if(!isIdea(r))continue;const l=Array.isArray(r.links)?r.links:[];if(!l.includes(y))r.links=[...l,y];}}
function unlink(a,b){for(const [x,y] of [[a,b],[b,a]]){const r=byId(x);if(!r||!Array.isArray(r.links))continue;r.links=r.links.filter(i=>i!==y);if(!r.links.length)delete r.links;}}
function allTags(){const m=new Map();for(const r of data?.rows||[])if(isIdea(r))for(const t of tagsOf(r)){const k=t.toLowerCase(),e=m.get(k)||{tag:t,n:0};e.n++;m.set(k,e);}return [...m.values()].sort((a,b)=>b.n-a.n||a.tag.localeCompare(b.tag));}
function tagEl(t,n,on,onclick){const b=document.createElement('button');b.type='button';b.className='tag'+(on?' on':'');const sw=document.createElement('span');sw.className='sw';sw.style.background=tagColor(t);b.append(sw,document.createTextNode(t+(n!=null?' · '+n:'')));b.onclick=onclick;return b;}
// A <select> of every other idea, grouped by module.
function ideaOptions(select,exclude,first){
 select.replaceChildren(new Option(first,''));
 for(const g of groups()){const ideas=g.entries.filter(r=>!exclude.has(r.id));if(!ideas.length)continue;
  const og=document.createElement('optgroup');og.label=g.id===OUT?'Airlock':g.title||'Untitled module';for(const r of ideas)og.append(new Option(label(r).slice(0,80),r.id));select.append(og);}
 select.disabled=locked()||select.options.length<2;
}

// ---------- rendering ----------
const locked=()=>readOnly||!sync||conflicts.length>0;
function houseOptions(select,current){select.replaceChildren();for(const g of groups())select.add(new Option(g.id===OUT?'Airlock (no module)':g.title||'Untitled module',g.id));select.value=current;if(select.value!==current)select.value=OUT;}
function render(){
 const active=document.activeElement,focusKey=active?.dataset?.key,sel=focusKey&&'selectionStart' in active?[active.selectionStart,active.selectionEnd]:null;
 $('empty').hidden=!!data;$('work').hidden=!data;
 $('save').disabled=!sync;$('lib-name').hidden=!data;$('lib-name').textContent=data?(readOnly?'Read-only · ':'')+(data.name||'Library')+' · '+data.rows.filter(isIdea).length+' ideas':'';
 if(!data)return;
 for(const el of $('add-form').elements)el.disabled=locked();$('house-name').disabled=$('house-form').querySelector('button').disabled=locked();
 const remembered=$('f-house').value||sessionStorageGet('ic-house')||OUT;houseOptions($('f-house'),remembered);
 const keepLink=$('f-link').value;ideaOptions($('f-link'),new Set(),'No link');$('f-link').value=keepLink;if($('f-link').value!==keepLink)$('f-link').value='';
 const tags=allTags();
 // tag picker under the add form: click to add the tag
 const pick=$('tag-pick');pick.replaceChildren();if(tags.length){pick.append('Your tags:');for(const {tag} of tags)pick.append(tagEl(tag,null,tagsOf({tags:$('f-tags').value}).some(x=>x.toLowerCase()===tag.toLowerCase()),()=>{const cur=tagsOf({tags:$('f-tags').value});if(!cur.some(x=>x.toLowerCase()===tag.toLowerCase()))cur.push(tag);$('f-tags').value=cur.join(', ');render();}));}
 // tag filter above the list
 if(tagFilter&&!tags.some(t=>t.tag.toLowerCase()===tagFilter))tagFilter=null;
 const fl=$('filters');fl.replaceChildren();if(tags.length){fl.append('Filter by tag:');for(const {tag,n} of tags)fl.append(tagEl(tag,n,tagFilter===tag.toLowerCase(),()=>{tagFilter=tagFilter===tag.toLowerCase()?null:tag.toLowerCase();render();}));}
 const q=$('search').value.trim().toLowerCase(),list=$('list');list.replaceChildren();
 const all=groups();
 for(const g of all){
  if(g.id===OUT&&!g.entries.length&&all.length>1)continue;
  const filtered=q||tagFilter;
  const shown=g.entries.filter(r=>(!q||[r.keyword,r.tags,r.notes,g.title].join(' ').toLowerCase().includes(q))&&(!tagFilter||tagsOf(r).some(t=>t.toLowerCase()===tagFilter)));
  if(filtered&&!shown.length)continue;
  const box=document.createElement('div');box.className='house';
  const head=document.createElement('div');head.className='head';
  const dot=document.createElement('span');dot.className='dot';if(g.row?.city?.color){dot.style.background=g.row.city.color;dot.style.boxShadow='0 0 8px '+g.row.city.color;}
  const name=document.createElement('input');name.value=g.title;name.setAttribute('aria-label','Module name');name.dataset.key=g.id+':title';
  if(g.id===OUT){name.disabled=true;name.title='Ideas above your first module. Move them into a module, or add a module.';}
  else{name.disabled=locked();name.oninput=()=>{live(g.row).title=name.value;edited();};}
  const count=document.createElement('span');count.className='count';count.textContent=g.entries.length+' idea'+(g.entries.length===1?'':'s');
  head.append(dot,name,count);
  if(g.id!==OUT){const del=document.createElement('button');del.textContent='Remove module';del.className='danger';del.disabled=locked();del.onclick=()=>{
   const where=all[all.indexOf(g)-1];if(!confirm('Remove the module "'+(g.title||'Untitled')+'"?'+(g.entries.length?' Its '+g.entries.length+' idea'+(g.entries.length===1?' moves':'s move')+' to '+(where?.id===OUT?'the Airlock':'"'+where.title+'"')+'.':'')))return;
   data.rows=data.rows.filter(r=>r.id!==g.id);edited();render();};head.append(del);}
  box.append(head);
  if(!shown.length){const p=document.createElement('p');p.className='none';p.textContent='No ideas yet. Add one above and choose this module.';box.append(p);}
  for(const r of shown)box.append(entryEl(r,g));
  list.append(box);
 }
 if(!list.children.length)list.innerHTML='<p class="small">'+(q||tagFilter?'Nothing matches your search.':'No ideas yet. Add your first one above.')+'</p>';
 if(focusKey){const el=document.querySelector('[data-key="'+CSS.escape(focusKey)+'"]');if(el&&el!==document.activeElement){el.focus();if(sel)try{el.setSelectionRange(...sel);}catch{}}}
 if(flashId){list.querySelector('[data-id="'+CSS.escape(flashId)+'"]')?.classList.add('flash');flashId=null;}
 renderConflicts();
}
function field(r,key,text,opts={}){
 const l=document.createElement('label');l.textContent=text;if(opts.cls)l.className=opts.cls;
 const el=document.createElement(opts.area?'textarea':'input');if(opts.area)el.rows=2;
 el.value=r[key]||'';el.disabled=locked();el.dataset.key=r.id+':'+key;el.maxLength=opts.max||300;
 el.oninput=()=>{const row=live(r);const v=key==='notes'?el.value:el.value.trimStart();if(v||key==='keyword')row[key]=v;else delete row[key];edited();};
 if(opts.after)el.onchange=()=>{opts.after(el);render();};l.append(el);return l;
}
function entryEl(r,g){
 const el=document.createElement('div');el.className='entry';el.dataset.id=r.id;
 el.append(field(r,'keyword','Idea'),field(r,'tags','Tags · comma separated',{after:inp=>{const row=live(r),v=cleanTags(inp.value);if(v)row.tags=v;else delete row.tags;edited();}}),
  field(r,'notes','Notes · one thought per line',{area:true,cls:'notes',max:5000}));
 // tag chips + summary
 const meta=document.createElement('div');meta.className='meta tagpick';const tags=tagsOf(r),links=linksOf(r),n=(r.notes||'').split(/\r?\n/).filter(l=>l.trim()).length;
 for(const t of tags)meta.append(tagEl(t,null,tagFilter===t.toLowerCase(),()=>{tagFilter=tagFilter===t.toLowerCase()?null:t.toLowerCase();render();}));
 meta.append((tags.length?'':'No tags yet · ')+'🔗 '+links.length+' linked · '+(n?n+' thought'+(n>1?'s':''):'no notes yet'));el.append(meta);
 // linked ideas
 const lk=document.createElement('div');lk.className='links';lk.append('Linked with:');
 for(const id of links){const o=byId(id),chip=document.createElement('span');chip.className='chip';
  const go=document.createElement('span');go.className='go';go.textContent=label(o).slice(0,60);go.title='Jump to this idea';go.onclick=()=>{const t=document.querySelector('.entry[data-id="'+CSS.escape(id)+'"]');if(t){t.scrollIntoView({behavior:'smooth',block:'center'});t.classList.remove('flash');void t.offsetWidth;t.classList.add('flash');}};
  const x=document.createElement('button');x.textContent='×';x.title='Unlink';x.setAttribute('aria-label','Unlink '+label(o));x.disabled=locked();x.onclick=()=>{unlink(r.id,id);edited();render();};
  chip.append(go,x);lk.append(chip);}
 if(!links.length)lk.append(' none');
 const add=document.createElement('select');add.setAttribute('aria-label','Link '+label(r)+' to another idea');ideaOptions(add,new Set([r.id,...links]),'＋ Link to another idea…');
 add.onchange=()=>{if(!add.value)return;link(r.id,add.value);flashId=add.value;edited();render();tell('Linked "'+label(r)+'" with "'+label(byId(add.value))+'". They talk over a radio beam on the Station.');};
 lk.append(add);el.append(lk);
 const tools=document.createElement('div');tools.className='tools';
 const mv=document.createElement('select');mv.setAttribute('aria-label','Module for '+label(r));houseOptions(mv,g.id);mv.disabled=locked();mv.onchange=()=>moveTo(r.id,mv.value);
 const mk=(t,title,fn)=>{const b=document.createElement('button');b.textContent=t;b.title=title;b.disabled=locked();b.onclick=fn;return b;};
 const show=mk('Show on Station','Switch to the Station and find this astronaut',()=>{if(dirty)flush();toParent({type:'ic-show',view:'city',focus:r.id});});show.hidden=!inFrame;
 tools.append(document.createTextNode('Module '),mv,mk('↑','Move up',()=>step(r.id,-1)),mk('↓','Move down',()=>step(r.id,1)),show,
  mk('Remove','Remove this idea',()=>{if(!confirm('Remove "'+label(r)+'"?'))return;for(const id of linksOf(live(r)))unlink(r.id,id);
   for(const o of data.rows)if(Array.isArray(o.links)&&o.links.includes(r.id)){o.links=o.links.filter(i=>i!==r.id);if(!o.links.length)delete o.links;}
   data.rows=data.rows.filter(x=>x.id!==r.id);edited();render();}));
 tools.lastChild.classList.add('danger');el.append(tools);return el;
}

function renderConflicts(){
 renderSyncConflicts($('conflicts'),conflicts,data,async(key,value)=>{
  if(busy)return tell('Sync in progress, try again in a moment.');busy=true;
  try{const r=await sync.resolve(key,value);dirty=false;apply(r);tell(r.conflicts.length?'Choose a version for the remaining ideas.':'Conflict resolved.');}catch(e){tell(e.message);}finally{busy=false;}
 },dir);
}
function sessionStorageGet(k){try{return sessionStorage.getItem(k);}catch{return null;}}

// ---------- actions ----------
$('add-form').onsubmit=e=>{
 e.preventDefault();if(locked())return;
 const title=$('f-title').value.trim();if(!title){tell('Give the idea a name.');return;}
 const row={id:Library.uuid(),keyword:title,sentence:'',link:'',screenshot:''},tags=cleanTags($('f-tags').value),notes=$('f-notes').value.trim();
 if(tags)row.tags=tags;if(notes)row.notes=notes;
 const house=$('f-house').value||OUT;try{sessionStorage.setItem('ic-house',house);}catch{}
 data.rows.splice(insertAt(data.rows,house),0,row);flashId=row.id;
 const to=$('f-link').value;if(to)link(row.id,to);
 for(const id of ['f-title','f-tags','f-notes'])$(id).value='';$('f-link').value='';$('f-title').focus();
 edited();render();tell('"'+title+'" added'+(to?' and linked':'')+'. Syncing…');
};
$('add-form').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('add-form').requestSubmit();}});
$('f-tags').addEventListener('change',()=>render());
$('f-house').onchange=()=>{try{sessionStorage.setItem('ic-house',$('f-house').value);}catch{}};
$('house-form').onsubmit=e=>{e.preventDefault();if(locked())return;const name=$('house-name').value.trim();if(!name)return $('house-name').focus();
 const id=Library.uuid();data.rows.push({id,kind:'section',title:name});$('house-name').value='';$('f-house').value=id;try{sessionStorage.setItem('ic-house',id);}catch{}
 edited();render();$('f-house').value=id;tell('Module "'+name+'" docked. New ideas will go there.');};
$('search').oninput=render;
$('save').onclick=async()=>{if(!sync)return;if(!dirty){busy||apply(await sync.read());tell('Up to date.');return;}clearTimeout(timer);await flush();};
$('folder').onclick=async()=>{try{if(dirty)await flush();const h=await showDirectoryPicker({mode:'readwrite',id:'idea-city'});await connect(h);}catch(e){if(e.name!=='AbortError')tell(e.message);}};
$('reconnect').onclick=async()=>{try{const h=await kv('folder');if(h)await connect(h);}catch(e){tell(e.message);}};
$('to-city').onclick=()=>toParent({type:'ic-show',view:'city'});
$('to-city').hidden=!inFrame;
$('json').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const d=Library.validate(JSON.parse(await f.text()));dir=null;sync=null;readOnly=true;dirty=false;conflicts=[];data=d;base=clone(d);render();tell('Read-only view of '+f.name+'. Open the folder to edit.');}catch(err){tell('Not a valid session.json: '+err.message);}};
addEventListener('keydown',e=>{if(e.ctrlKey&&e.shiftKey&&e.code==='KeyS'){e.preventDefault();toParent({type:'ic-toggle'});}});
addEventListener('message',async e=>{
 if(e.origin!==location.origin||e.data?.type!=='ic-folder')return;
 try{const h=await kv('folder');if(h&&!(dir&&await dir.isSameEntry(h))){if(dirty)await flush();await connect(h);}}catch(err){tell(err.message);}
});

// ---------- start ----------
render();
// Auto-open the last library. Chrome keeps folder access while you use it (and across restarts if
// you chose "Allow on every visit"); otherwise it needs one click, so the first click anywhere reopens it.
function hideResume(){$('resume').hidden=true;removeEventListener('pointerdown',resumeOnClick,true);removeEventListener('keydown',resumeOnClick,true);}
async function resumeOnClick(e){if(e.target.closest?.('#folder,#json,details'))return;const h=await kv('folder');if(!h||sync)return hideResume();hideResume();try{await connect(h);}catch(err){tell(err.message);$('reconnect').hidden=false;}}
(async()=>{const h=await kv('folder');if(!h)return;
 $('reconnect').textContent='Reconnect '+h.name;
 try{if(await h.queryPermission({mode:'readwrite'})==='granted'){await connect(h);return;}}catch(e){tell(e.message);}
 $('resume-name').textContent=h.name;$('resume').hidden=false;$('empty').hidden=true;
 addEventListener('pointerdown',resumeOnClick,true);addEventListener('keydown',resumeOnClick,true);
 tell('Click anywhere to reopen '+h.name+'. In Chrome\'s prompt, choose "Allow on every visit" to skip this next time.');
})();
