'use strict';
// Idea City — Station view. Adapted from Presentation City / Paper City; joins the ideas library's sync as "Station".
// Each idea is an astronaut; each module is a section heading in Entries, drawn as a pod docked to the
// Observation Deck. Linked ideas talk over radio beams and meet at the Deck. Each module's layout, colour
// and walls are stored on its section row (field "city"); the Airlock and the Deck live in city.json.
const $=id=>document.getElementById(id);
const canvas=$('map'),ctx=canvas.getContext('2d');
const COLORS=['#8ecae6','#c77dff','#f4a261','#b5e48c','#e9c46a','#ffafcc','#a3c4f3','#f6bd60','#90dbf4','#c9ada7'];
const SUITS=['#d1495b','#00798c','#edae49','#30638e','#6a4c93','#2a9d8f','#e76f51','#457b9d','#8d6a9f','#3d5a80'];
const TAGCOLORS=['#ff6b6b','#ffd166','#06d6a0','#4cc9f0','#c77dff','#f4a261','#90be6d','#f72585','#a3c4f3','#e9c46a'];
const OUT='__outskirts';
const SPOT=30,LINE=6,MEET_EVERY=120,MEET_FOR=35; // seconds: spotlight turn, one note line, meeting cycle
let dir=null,sync=null,library=null,readOnly=false;
let local={version:2,outskirts:null,walls:[]}; // city.json: only things with no section row to live on
let prev=new Map(),towns=[],walls=new Set(),people=new Map();
let bubbleMode='turns',beamMode='all',meetMode='auto',gatherAll=false,highlight=null;
let camTouched=false,hoverP=null,cam={x:0,y:0,z:1},tool='select',selected=null,hover=null,drag=null,spaceDown=false;

const tell=m=>$('status').textContent=m;
const key=(x,y)=>x+','+y;
const hash=s=>{let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
const nameOf=r=>(r.keyword||'Untitled idea').trim()||'Untitled idea';
function tagsOf(r){const seen=new Set(),out=[];for(const t of String(r?.tags||'').split(',')){const s=t.trim();if(s&&!seen.has(s.toLowerCase())){seen.add(s.toLowerCase());out.push(s);}}return out;}
const tagColor=t=>TAGCOLORS[hash(t.toLowerCase())%TAGCOLORS.length];
const hasTag=(p,t)=>tagsOf(p.row).some(x=>x.toLowerCase()===t);
const dimmed=p=>highlight&&!hasTag(p,highlight);
const noteLines=r=>(r.notes||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
const nowS=()=>Date.now()/1000;
const townAt=(x,y)=>towns.find(t=>x>=t.x&&x<t.x+t.w&&y>=t.y&&y<t.y+t.h);

// ---------- storage ----------
const idb=new Promise(res=>{const r=indexedDB.open('idea-city',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>res(null);});
async function kv(k,v){const db=await idb;if(!db)return;return new Promise(res=>{try{const tx=db.transaction('kv',v===undefined?'readonly':'readwrite'),s=tx.objectStore('kv'),q=v===undefined?s.get(k):s.put(v,k);q.onsuccess=()=>res(q.result);q.onerror=()=>res();}catch{res();}});}
async function readJSON(name){try{const f=await (await dir.getFileHandle(name)).getFile();return JSON.parse(await f.text());}catch(e){if(e.name==='NotFoundError')return null;throw e;}}
// All library reads/writes run one at a time.
let queue=Promise.resolve(),busy=0;
function enqueue(fn){busy++;const run=queue.then(fn).catch(e=>tell(/conflict/i.test(e.message)?'Some ideas have conflicting edits. Choose a version in Entries, then the Station can save again.':e.message)).finally(()=>busy--);queue=run;return run;}
function editLibrary(mutate,message){
 if(readOnly||!sync){tell('Read-only station: open the library folder to save changes.');return;}
 return enqueue(async()=>{library=(await sync.read()).data;const next=structuredClone(library);if(mutate(next)===false)return;const r=await sync.save(next);library=r.data;reconcile(false);if(r.snapshotError)tell(r.snapshotError);else if(message)tell(message);});
}
let layoutTimer=0,layoutDirty=false,layoutGen=0;
function save(){ // layout, colours and walls
 if(readOnly||!sync)return;layoutDirty=true;clearTimeout(layoutTimer);const my=++layoutGen;
 layoutTimer=setTimeout(()=>enqueue(async()=>{
  const mine=new Map(towns.map(t=>[t.id,[]])),loose=[];
  for(const k of walls){const [x,y]=k.split(',').map(Number),o=owner(x,y);(o&&o.id!==OUT?mine.get(o.id):loose).push(o&&o.id!==OUT?[x-o.x,y-o.y]:k);}
  library=(await sync.read()).data;const next=structuredClone(library);let changed=false;
  for(const row of next.rows){if(row.kind!=='section')continue;const t=towns.find(t=>t.id===row.id);if(!t)continue;
   const c={x:t.x,y:t.y,w:t.w,h:t.h,color:t.color,walls:mine.get(t.id)};if(JSON.stringify(row.city)!==JSON.stringify(c)){row.city=c;changed=true;}}
  if(changed){const r=await sync.save(next);library=r.data;}
  const o=towns.find(t=>t.id===OUT);local={version:2,outskirts:o?{x:o.x,y:o.y,w:o.w,h:o.h,color:o.color}:local.outskirts,walls:loose,hub:hub?{x:hub.x,y:hub.y,w:hub.w,h:hub.h}:local.hub};
  const h=await dir.getFileHandle('city.json',{create:true}),w=await h.createWritable();await w.write(JSON.stringify(local,null,1));await w.close();
  if(my===layoutGen)layoutDirty=false;reconcile(false);
 }),1200);
}
function owner(x,y){if(hub&&x>=hub.x-2&&x<hub.x+hub.w+2&&y>=hub.y-2&&y<hub.y+hub.h+2)return null;return towns.find(t=>x>=t.x-2&&x<t.x+t.w+2&&y>=t.y-2&&y<t.y+t.h+2)||towns.reduce((b,t)=>{const d=Math.hypot(x-(t.x+t.w/2),y-(t.y+t.h/2));return !b||d<b.d?{t,d}:b;},null)?.t;}

async function connect(handle){
 if(await handle.queryPermission({mode:'readwrite'})!=='granted'&&await handle.requestPermission({mode:'readwrite'})!=='granted')throw Error('Folder access was not granted.');
 const s=new SyncLibrary(handle,'Station');let result;
 try{result=await s.open();}catch(e){throw Error(handle.name+' is not an Idea City library. Create one with Open library folder in Entries. ('+e.message+')');}
 if(!result.data.project.startsWith('ideas:'))throw Error(handle.name+' belongs to another library (such as your Citations or Presentations library). Idea City uses its own folder.');
 dir=handle;sync=s;readOnly=false;
 const saved=await readJSON('city.json').catch(()=>null);
 local=saved?.version===2?saved:{version:2,outskirts:null,walls:[]};
 towns=[];hub=null;people.clear();library=result.data;reconcile(true);fit();
 if(library.rows.some(r=>r.kind==='section'&&!r.city))save();
 await kv('folder',handle);$('reconnect').hidden=true;if(parent!==window)parent.postMessage({type:'ic-folder'},location.origin);
 tell(result.conflicts.length?'Connected, but some ideas have conflicting edits. Resolve them in Entries before the Station can save.':'Connected to '+handle.name+'. Modules, ideas, tags and links sync with Entries.');
}
$('open').onclick=async()=>{try{await connect(await showDirectoryPicker({mode:'readwrite',id:'idea-city'}));}catch(e){if(e.name!=='AbortError')tell(e.message);}};
$('reconnect').onclick=async()=>{try{await connect(await kv('folder'));}catch(e){tell(e.message);}};
$('json').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{library=Library.validate(JSON.parse(await f.text()));dir=null;sync=null;readOnly=true;local={version:2,outskirts:null,walls:[]};towns=[];hub=null;people.clear();reconcile(true);fit();tell('Read-only station. Open the folder to save module names and walls.');}catch(err){tell('Not a valid session.json: '+err.message);}};
(async()=>{const h=await kv('folder');if(!h)return;if(await h.queryPermission({mode:'readwrite'})==='granted'){try{await connect(h);}catch(e){tell(e.message);}}else{$('reconnect').hidden=false;$('reconnect').textContent='Reconnect '+h.name;}})();
setInterval(()=>{if(!sync||busy||document.hidden)return;enqueue(async()=>{const r=await sync.read();if(r.data.revision!==library.revision){library=r.data;reconcile(!layoutDirty);}});},3000);

// ---------- station model ----------
function reconcile(fromDisk){
 const groups=[{id:OUT,section:'Airlock',row:null,rows:[]}];
 for(const r of library.rows||[]){if(r.kind==='section')groups.push({id:r.id,section:r.title||'Untitled module',row:r,rows:[]});else groups.at(-1).rows.push(r);}
 prev=new Map(towns.map(t=>[t.id,t]));towns=[];let grew=false;
 if(fromDisk)walls=new Set(local.walls||[]);
 groups.forEach((g,i)=>{
  if(g.id===OUT&&!g.rows.length)return;
  const old=prev.get(g.id),stored=g.id===OUT?local.outskirts:g.row.city;
  const s=(!fromDisk&&old)||(stored?.w&&stored)||old||{};
  const t={id:g.id,section:g.section,name:g.section,members:g.rows.map(r=>r.id),color:s.color||COLORS[i%COLORS.length]};
  if(s.w){Object.assign(t,{x:s.x,y:s.y,w:s.w,h:s.h});if(fitHouse(t))grew=true;}else{Object.assign(t,{x:0,y:0,w:12,h:11});fitHouse(t);Object.assign(t,place(t.w,t.h));grew=true;}
  if(fromDisk&&g.row?.city?.walls)for(const [dx,dy] of g.row.city.walls)walls.add(key(t.x+dx,t.y+dy));
  towns.push(t);
 });
 const home=new Map();for(const t of towns)for(const id of t.members)home.set(id,t.id);
 const rows=new Map((library.rows||[]).filter(r=>r.kind!=='section').map(r=>[r.id,r]));
 for(const id of [...people.keys()])if(!rows.has(id))people.delete(id);
 for(const [id,r] of rows){const t=towns.find(t=>t.id===home.get(id));let p=people.get(id);
  if(!p){p={id,row:r,wait:Math.random()*2};const s=spot(t);p.x=s.x;p.y=s.y;p.tx=p.x;p.ty=p.y;people.set(id,p);}
  p.row=r;if(p.town!==t.id&&!inside(t,p.x,p.y)){const s=spot(t);p.x=s.x;p.y=s.y;}p.town=t.id;p.path=null;}
 computeLinks();
 if(selected&&!people.has(selected))closeCard();
 if(ensureHub())grew=true;
 renderTowns();renderTags();if(selected)openCard(people.get(selected));
 if(!camTouched&&towns.length!==reconcile.n){reconcile.n=towns.length;fit();}
 if(grew&&!readOnly)setTimeout(save,0);
}
// Links are undirected; clusters of linked ideas share a table on the Observation Deck.
let linkPairs=[],linked=new Map(),meetSeat=new Map(),meetNeed=0;
function computeLinks(){
 const pairs=new Map();linked=new Map();
 for(const p of people.values())for(const id of Array.isArray(p.row.links)?p.row.links:[]){if(id===p.id||!people.has(id))continue;const [a,b]=p.id<id?[p.id,id]:[id,p.id];pairs.set(a+'|'+b,[a,b]);}
 linkPairs=[...pairs.values()];
 for(const [a,b] of linkPairs){if(!linked.has(a))linked.set(a,new Set());if(!linked.has(b))linked.set(b,new Set());linked.get(a).add(b);linked.get(b).add(a);}
 const up=new Map(),find=x=>{while(up.get(x)!==x){up.set(x,up.get(up.get(x)));x=up.get(x);}return x;};
 for(const id of linked.keys())up.set(id,id);for(const [a,b] of linkPairs)up.set(find(a),find(b));
 const clusters=new Map();for(const id of [...linked.keys()].sort()){const r=find(id);if(!clusters.has(r))clusters.set(r,[]);clusters.get(r).push(id);}
 meetSeat=new Map();let n=0;
 for(const c of [...clusters.values()].sort((a,b)=>b.length-a.length)){for(const id of c)meetSeat.set(id,n++);n=Math.ceil(n/4)*4;} // each cluster starts at a fresh table
 meetNeed=n;
}
function place(w,h){
 const taken=[...towns,...prev.values(),...(hub?[hub]:[])].filter(s=>s.w);
 for(let y=2;;y++)for(let x=2;x<=Math.max(100,y);x++)if(!taken.some(o=>x<o.x+o.w+4&&x+w+4>o.x&&y<o.y+o.h+4&&y+h+4>o.y))return {x,y,w,h};
}
const inside=(t,x,y)=>x>=t.x+1&&x<t.x+t.w-1&&y>=t.y+2&&y<t.y+t.h-1;
function spot(t){for(let i=0;i<40;i++){const x=t.x+1+Math.floor(Math.random()*(t.w-2)),y=t.y+2+Math.floor(Math.random()*(t.h-3));if(!blocked(x,y))return {x:x+.5,y:y+.5};}return {x:t.x+t.w/2,y:t.y+t.h/2};}
function moveResident(p,t){
 p.town=t.id;
 editLibrary(next=>{const i=next.rows.findIndex(r=>r.id===p.id);if(i<0)return false;const [row]=next.rows.splice(i,1);let at;
  if(t.id===OUT){at=next.rows.findIndex(r=>r.kind==='section');if(at<0)at=next.rows.length;}
  else{at=next.rows.findIndex(r=>r.id===t.id)+1;if(!at)return false;while(at<next.rows.length&&next.rows[at].kind!=='section')at++;}
  next.rows.splice(at,0,row);},'"'+nameOf(p.row)+'" moved to '+t.name+'. Entries shows it in that module now.');
}
const renameTimers={};
function renameTown(t,value){
 value=value.trim();if(!value||value===t.section)return;
 if(t.id===OUT)return editLibrary(next=>{next.rows.unshift({id:Library.uuid(),kind:'section',title:value,city:{x:t.x,y:t.y,w:t.w,h:t.h,color:t.color,walls:[]}});},'The Airlock is now the module "'+value+'" in Entries.').then(()=>{local.outskirts=null;save();});
 return editLibrary(next=>{const r=next.rows.find(r=>r.id===t.id);if(!r)return false;r.title=value;},'Renamed. The module in Entries is now "'+value+'".');
}

// ---------- sidebar ----------
function renderTowns(){
 const box=$('towns'),a=document.activeElement,focus=a?.dataset?.town,sel=focus&&[a.selectionStart,a.selectionEnd,a.value];
 box.replaceChildren();
 for(const t of towns){
  const el=document.createElement('div');el.className='town';
  el.innerHTML='<div class="top"><span class="dot"></span><input aria-label="Module name"></div><div class="small"></div><div class="now"></div><div class="row"><button data-a="go">Visit</button><button data-a="wall">Seal it in</button><button data-a="color">Recolor</button></div>';
  el.querySelector('.dot').style.background=t.color;
  const inp=el.querySelector('input');inp.value=focus===t.id?sel[2]:t.name;inp.placeholder=t.section;inp.dataset.town=t.id;
  if(t.id===OUT){inp.onchange=()=>renameTown(t,inp.value);inp.title='Press Enter to turn the Airlock into a module';}
  else inp.oninput=()=>{t.name=inp.value||t.section;clearTimeout(renameTimers[t.id]);renameTimers[t.id]=setTimeout(()=>renameTown(t,inp.value),900);};
  el.querySelector('.small').textContent=(t.id===OUT?'Ideas with no module · rename to make it a module':'Module in Entries')+' · '+t.members.length+' idea'+(t.members.length===1?'':'s');
  const sp=spotlight(t);el.querySelector('.now').textContent=sp?'💡 Spotlight: '+nameOf(sp.row):'No ideas docked yet';
  el.querySelector('[data-a=go]').onclick=()=>focusTown(t);
  el.querySelector('[data-a=wall]').onclick=()=>{wallTown(t);save();};
  el.querySelector('[data-a=color]').onclick=()=>{t.color=COLORS[(COLORS.indexOf(t.color)+1)%COLORS.length];el.querySelector('.dot').style.background=t.color;save();};
  box.append(el);
  if(focus===t.id){inp.focus();inp.setSelectionRange(sel[0],sel[1]);}
 }
 if(!towns.length)box.innerHTML='<p class="small">No ideas yet. Add them in Entries.</p>';
}
function tagButton(t,n,on,onclick){const b=document.createElement('button');b.className='tag'+(on?' on':'');const sw=document.createElement('span');sw.className='sw';sw.style.background=tagColor(t);b.append(sw,document.createTextNode(t+(n!=null?' · '+n:'')));b.onclick=onclick;return b;}
function renderTags(){
 const m=new Map();for(const p of people.values())for(const t of tagsOf(p.row)){const k=t.toLowerCase(),e=m.get(k)||{tag:t,n:0};e.n++;m.set(k,e);}
 const list=[...m.values()].sort((a,b)=>b.n-a.n||a.tag.localeCompare(b.tag)),box=$('tags');box.replaceChildren();
 if(highlight&&!m.has(highlight))highlight=null;
 if(!list.length){box.innerHTML='<p class="small">Tags you add in Entries appear here. Click one to light up its astronauts.</p>';return;}
 for(const {tag,n} of list)box.append(tagButton(tag,n,highlight===tag.toLowerCase(),()=>{highlight=highlight===tag.toLowerCase()?null:tag.toLowerCase();renderTags();tell(highlight?'Lit up the astronauts tagged "'+tag+'". Click the tag again to clear.':'Tag highlight cleared.');}));
}
function wallTown(t){for(let x=t.x;x<t.x+t.w;x++)for(const y of [t.y,t.y+t.h-1]){if(y===t.y+t.h-1&&Math.abs(x+.5-(t.x+t.w/2))<1.5)continue;walls.add(key(x,y));}for(let y=t.y;y<t.y+t.h;y++)for(const x of [t.x,t.x+t.w-1])walls.add(key(x,y));}
// ---------- right-click: choose a new module ----------
function closeHomeMenu(){$('ctx').hidden=true;}
function openHomeMenu(p,cx,cy){
 const m=$('ctx');m.replaceChildren();
 const title=document.createElement('div');title.className='ctx-title';title.textContent='Move "'+nameOf(p.row).slice(0,40)+'" to';m.append(title);
 for(const t of towns){const b=document.createElement('button');b.className='ctx-item';const dot=document.createElement('span');dot.className='dot';dot.style.background=t.color;b.append(dot,document.createTextNode(t.name+(t.id===p.town?'  (current module)':'')));
  b.disabled=t.id===p.town;b.onclick=()=>{closeHomeMenu();moveResident(p,t);};m.append(b);}
 const form=document.createElement('form');form.className='ctx-new';form.innerHTML='<input placeholder="Or dock a new module…" maxlength="80"><button class="primary">Move in</button>';
 form.onsubmit=e=>{e.preventDefault();const name=form.querySelector('input').value.trim();if(!name)return;if(!sync){tell('Open your library folder first.');return;}closeHomeMenu();
  const id=Library.uuid();editLibrary(next=>{const i=next.rows.findIndex(r=>r.id===p.id);if(i<0)return false;const [row]=next.rows.splice(i,1);next.rows.push({id,kind:'section',title:name},row);},'"'+nameOf(p.row)+'" moved into the new module '+name+'. It is a new module in Entries.');};
 m.append(form);m.hidden=false;
 const r=m.parentElement.getBoundingClientRect(),w=m.offsetWidth,h=m.offsetHeight;
 m.style.left=Math.max(8,Math.min(cx-r.left,r.width-w-8))+'px';m.style.top=Math.max(8,Math.min(cy-r.top,r.height-h-8))+'px';
}
addEventListener('keydown',e=>{if(e.key==='Escape')closeHomeMenu();});
addEventListener('pointerdown',e=>{if(!$('ctx').hidden&&!$('ctx').contains(e.target)&&e.target!==canvas)closeHomeMenu();});
canvas.addEventListener('wheel',closeHomeMenu);
$('new-town').onsubmit=async e=>{e.preventDefault();const inp=$('new-town-name'),name=inp.value.trim();if(!name)return inp.focus();
 if(!sync){tell('Open your library folder first; a new module is a new section in Entries.');return;}
 const id=Library.uuid();await editLibrary(next=>{next.rows.push({id,kind:'section',title:name});},name+' is docked. It is a new module in Entries.');
 const t=towns.find(t=>t.id===id);if(t){inp.value='';focusTown(t);save();}};
$('clear-walls').onclick=()=>{if(walls.size&&confirm('Remove all '+walls.size+' wall blocks?')){walls.clear();save();}};
const HINTS={select:'Click an astronaut to read its idea, tags and links. Right-click one, or drag it, to move it to another module. Drag empty space to pan.',wall:'Click or drag to lay wall blocks. Astronauts cannot pass the force-field walls.',erase:'Click or drag over walls to remove them.',move:'Drag a module (or the Deck) to relocate it, with its crew and walls.'};
function setTool(t){tool=t;document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('on',b.dataset.tool===t));$('hint').textContent=HINTS[t]+' Scroll to zoom; hold Space or right-drag to pan.';canvas.style.cursor=t==='select'?'default':t==='move'?'move':'crosshair';}
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));setTool('select');

// ---------- card ----------
const ACT_LABEL={spotlight:'💡 In the spotlight at the console',working:'Working at a desk',floating:'Floating around the module',meeting:'📡 Meeting its linked ideas at the Observation Deck',deck:'🔭 At the Observation Deck'};
function openCard(p){
 if(!p)return closeCard();selected=p.id;const r=p.row,t=towns.find(t=>t.id===p.town);
 $('card-name').textContent=nameOf(r);
 $('card-meta').textContent=[t?.name,ACT_LABEL[p.act]].filter(Boolean).join(' · ');
 const tags=$('card-tags');tags.replaceChildren();for(const tg of tagsOf(r))tags.append(tagButton(tg,null,highlight===tg.toLowerCase(),()=>{highlight=highlight===tg.toLowerCase()?null:tg.toLowerCase();renderTags();openCard(p);}));
 $('card-text').textContent=r.notes||'No notes yet. Add thoughts in Entries, one per line.';
 const box=$('card-links');box.replaceChildren();const ids=[...(linked.get(p.id)||[])];
 const h=document.createElement('h3');h.textContent=ids.length?'Linked ideas · '+ids.length:'No linked ideas yet';box.append(h);
 for(const id of ids){const o=people.get(id);if(!o)continue;const b=document.createElement('button');b.className='linkbtn';const ot=towns.find(t=>t.id===o.town);
  b.append(document.createTextNode('📡 '+nameOf(o.row)+' '));const s=document.createElement('small');s.textContent=ot?.name||'';b.append(s);
  b.onclick=()=>{frame([{x:o.x-4,y:o.y-4,w:8,h:8}],2);openCard(o);};box.append(b);}
 $('card').hidden=false;
}
function closeCard(){selected=null;$('card').hidden=true;}
$('card-close').onclick=closeCard;

// ---------- camera (isometric 3D) ----------
const TW=64,TH=32; // iso tile width/height in px
const iso=(x,y)=>({X:(x-y)*TW/2,Y:(x+y)*TH/2});
const unIso=(X,Y)=>({x:(X/(TW/2)+Y/(TH/2))/2,y:(Y/(TH/2)-X/(TW/2))/2});
function resize(){const d=devicePixelRatio||1,r=canvas.getBoundingClientRect();canvas.width=r.width*d;canvas.height=r.height*d;}
addEventListener('resize',resize);resize();
const toIso=(sx,sy)=>({X:sx/cam.z+cam.x,Y:sy/cam.z+cam.y});
const toWorld=(sx,sy)=>{const i=toIso(sx,sy);return unIso(i.X,i.Y);};
function zoomAt(f,sx,sy){camTouched=true;const i=toIso(sx,sy);cam.z=Math.min(3,Math.max(.2,cam.z*f));cam.x=i.X-sx/cam.z;cam.y=i.Y-sy/cam.z;}
function frame(list,maxZ){if(!list.length)return;const r=canvas.getBoundingClientRect(),pts=list.flatMap(t=>[iso(t.x,t.y),iso(t.x+t.w,t.y),iso(t.x,t.y+t.h),iso(t.x+t.w,t.y+t.h)]),X0=Math.min(...pts.map(p=>p.X)),X1=Math.max(...pts.map(p=>p.X)),Y0=Math.min(...pts.map(p=>p.Y))-80,Y1=Math.max(...pts.map(p=>p.Y))+40;
 cam.z=Math.min(maxZ,Math.max(.2,Math.min(r.width/(X1-X0+120),r.height/(Y1-Y0+60))));cam.x=(X0+X1)/2-r.width/2/cam.z;cam.y=(Y0+Y1)/2-r.height/2/cam.z;}
const fit=()=>frame(hub?[...towns,hub]:towns,1.4),focusTown=t=>{camTouched=true;frame([t],1.8);};
$('zin').onclick=()=>{const r=canvas.getBoundingClientRect();zoomAt(1.25,r.width/2,r.height/2);};
$('zout').onclick=()=>{const r=canvas.getBoundingClientRect();zoomAt(.8,r.width/2,r.height/2);};
$('fit').onclick=fit;

// ---------- input ----------
const pos=e=>{const r=canvas.getBoundingClientRect();return {sx:e.clientX-r.left,sy:e.clientY-r.top};};
function personAt(sx,sy){const i=toIso(sx,sy),now=performance.now()/1000;let best=null,bz=-1e9;for(const p of people.values()){const f=iso(p.x,p.y),y=f.Y-lift(p,now);if(Math.abs(i.X-f.X)<12&&i.Y<y+4&&i.Y>y-42&&p.x+p.y>bz){bz=p.x+p.y;best=p;}}return best;}
function paint(from,to){const n=Math.max(Math.abs(to.x-from.x),Math.abs(to.y-from.y),1)*2;for(let i=0;i<=n;i++){const x=Math.floor(from.x+(to.x-from.x)*i/n),y=Math.floor(from.y+(to.y-from.y)*i/n),k=key(x,y);if(tool==='wall'){if(![...people.values()].some(p=>Math.floor(p.x)===x&&Math.floor(p.y)===y))walls.add(k);}else walls.delete(k);}}
canvas.onpointerdown=e=>{
 canvas.setPointerCapture(e.pointerId);const {sx,sy}=pos(e),w=toWorld(sx,sy);
 if(e.button===2&&!spaceDown){const p=personAt(sx,sy);if(p){openHomeMenu(p,e.clientX,e.clientY);return;}}
 closeHomeMenu();
 if(e.button!==0||spaceDown)return drag={kind:'pan',sx,sy,cx:cam.x,cy:cam.y};
 if(tool==='wall'||tool==='erase'){paint(w,w);return drag={kind:'paint',last:w};}
 if(tool==='move'){const t=townAt(Math.floor(w.x),Math.floor(w.y))||(hub&&inRect(hub,Math.floor(w.x),Math.floor(w.y))?hub:null);if(t)return drag={kind:'town',t,w0:w,dx:0,dy:0};}
 if(tool==='select'){const p=personAt(sx,sy);if(p)return drag={kind:'person',p,sx,sy,moved:false};}
 drag={kind:'pan',sx,sy,cx:cam.x,cy:cam.y,click:true};
};
canvas.onpointermove=e=>{
 const {sx,sy}=pos(e),w=toWorld(sx,sy);hover=w;hoverP=drag?null:personAt(sx,sy);if(!drag)return;
 if(drag.kind==='pan'){if(Math.hypot(sx-drag.sx,sy-drag.sy)>3){drag.click=false;camTouched=true;}cam.x=drag.cx-(sx-drag.sx)/cam.z;cam.y=drag.cy-(sy-drag.sy)/cam.z;}
 else if(drag.kind==='paint'){paint(drag.last,w);drag.last=w;}
 else if(drag.kind==='town'){drag.dx=Math.round(w.x-drag.w0.x);drag.dy=Math.round(w.y-drag.w0.y);}
 else if(drag.kind==='person'){if(Math.hypot(sx-drag.sx,sy-drag.sy)>4)drag.moved=true;if(drag.moved){const f=toWorld(sx,sy+22*cam.z);drag.p.x=f.x;drag.p.y=f.y;}}
};
canvas.onpointerup=()=>{
 const d=drag;drag=null;if(!d)return;
 if(d.kind==='paint')save();
 else if(d.kind==='pan'&&d.click&&tool==='select')closeCard();
 else if(d.kind==='town'&&(d.dx||d.dy)){const t=d.t,moved=new Set();
  for(const k of walls){const [x,y]=k.split(',').map(Number);if(x>=t.x-1&&x<=t.x+t.w&&y>=t.y-1&&y<=t.y+t.h)moved.add(k);}
  for(const k of moved)walls.delete(k);for(const k of moved){const [x,y]=k.split(',').map(Number);walls.add(key(x+d.dx,y+d.dy));}
  for(const p of people.values()){if(t===hub?inRect(hub,Math.floor(p.x),Math.floor(p.y)):p.town===t.id&&inRect(t,Math.floor(p.x),Math.floor(p.y))){p.x+=d.dx;p.y+=d.dy;}p.path=null;}
  t.x+=d.dx;t.y+=d.dy;save();}
 else if(d.kind==='person'){const p=d.p;
  if(!d.moved)return openCard(p);
  const t=townAt(Math.floor(p.x),Math.floor(p.y));
  if(t&&t.id!==p.town)moveResident(p,t);
  const home=towns.find(t=>t.id===p.town);if(!inside(home,p.x,p.y)||blocked(Math.floor(p.x),Math.floor(p.y))){const s=spot(home);p.x=s.x;p.y=s.y;}
  p.path=null;p.sitting=p.standing=false;p.wait=1.5;if(selected===p.id)openCard(p);}
};
canvas.onwheel=e=>{e.preventDefault();const {sx,sy}=pos(e);zoomAt(Math.exp(-e.deltaY*.0015),sx,sy);};
canvas.oncontextmenu=e=>e.preventDefault();
canvas.onpointerleave=()=>{hover=null;hoverP=null;};
const pref=(id,store,set)=>{try{if(localStorage[store]){set(localStorage[store]);$(id).value=localStorage[store];}}catch{}$(id).onchange=e=>{set(e.target.value);try{localStorage[store]=e.target.value;}catch{}};};
pref('bubbles','ideaCityBubbles',v=>bubbleMode=v);pref('beams','ideaCityBeams',v=>beamMode=v);pref('meet','ideaCityMeet',v=>meetMode=v);
addEventListener('keydown',e=>{if(e.target.matches('input,textarea,select'))return;
 if(e.code==='Space'){spaceDown=true;e.preventDefault();}
 const m={KeyV:'select',KeyW:'wall',KeyE:'erase',KeyM:'move'}[e.code];if(m)setTool(m);if(e.key==='Escape')closeCard();});
addEventListener('keyup',e=>{if(e.code==='Space')spaceDown=false;});

// ---------- crew behaviour ----------
// One idea per module takes the spotlight at the console; linked ideas meet at the Observation Deck;
// everyone else works at a desk or floats around the module.
const meetingNow=()=>meetMode==='now'||meetMode==='auto'&&nowS()%MEET_EVERY<MEET_FOR;
function spotlight(t){const ids=t.members.filter(id=>people.has(id));if(!ids.length)return null;return people.get(ids[Math.floor(nowS()/SPOT+hash(t.id)%97)%ids.length]);}
const spots=new Map();
function activityAt(p){
 if(gatherAll)return 'deck';
 if(spots.get(p.town)===p)return 'spotlight';
 if(meetingNow()&&linked.has(p.id))return 'meeting';
 return Math.floor((nowS()+hash(p.id)%97)/18)%4===3?'floating':'working';
}
function currentLine(p){const l=noteLines(p.row);if(!l.length)return null;const k=Math.floor(nowS()/LINE+hash(p.id)%13)%l.length;return {line:l[k],k,n:l.length};}
const furnCache=new Map();
function furniture(t){
 const k=[t.id,t.x,t.y,t.w,t.h].join(',');let f=furnCache.get(k);if(f)return f;
 if(furnCache.size>300)furnCache.clear();
 f={items:[],block:new Set(),seats:[]};
 const add=(type,x,y,w,h,extra={},blocks=true)=>{const it={type,x,y,w,h,key:type+':'+x+','+y,town:t.id,...extra};f.items.push(it);if(blocks)for(let i=0;i<w;i++)for(let j=0;j<h;j++)f.block.add(key(x+i,y+j));return it;};
 const ix0=t.x+1,ix1=t.x+t.w-2,iy0=t.y+2,iy1=t.y+t.h-2,mx=Math.floor(t.x+t.w/2);
 f.stage={x:ix0,y:iy0,w:ix1-ix0+1,h:3};
 add('console',mx,iy0+2,1,1);f.consoleSpot=[mx,iy0+1];
 add('plant',ix0,iy0,1,1);add('plant',ix1,iy0,1,1);add('tank',ix0,iy0+2,1,1);add('tank',ix1,iy0+2,1,1);
 add('stripe',mx,iy0+3,1,iy1-iy0-2,{},false); // glowing centre aisle
 for(let y=iy0+4;y+1<=iy1;y+=3)for(let x=ix0;x<=ix1;x++){if(x===mx)continue;add('desk',x,y,1,1);f.seats.push(add('seat',x,y+1,1,1,{seat:[x,y+1]},false));}
 furnCache.set(k,f);return f;
}
const capacity=t=>furniture(t).seats.length;
function fitHouse(t){let g=false;if(t.w<12){t.w=12;g=true;}if(t.h<11){t.h=11;g=true;}while(t.w<80&&capacity(t)<Math.max(1,t.members.length)){t.w+=2;t.h+=2;g=true;}return g;}
let blockedCache=null;
function blocked(x,y){
 if(walls.has(key(x,y)))return true;
 if(!blockedCache){blockedCache=new Set();for(const t of towns)for(const k of furniture(t).block)blockedCache.add(k);if(hub)for(const k of hubFurniture(hub).block)blockedCache.add(k);}
 return blockedCache.has(key(x,y));
}
function route(from,goals){ // breadth-first search through modules, tubes and the Deck
 const sx=Math.floor(from.x),sy=Math.floor(from.y),want=new Set(goals.map(g=>key(g[0],g[1])));
 const seen=new Map([[key(sx,sy),null]]),q=[[sx,sy]];
 for(let qi=0;qi<q.length;qi++){const [x,y]=q[qi],k=key(x,y);
  if(want.has(k)){const path=[];let c=k;while(c){const [a,b]=c.split(',').map(Number);path.unshift({x:a+.5,y:b+.5});c=seen.get(c);}return path.slice(1);}
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy,nk=key(nx,ny);if(seen.has(nk)||!walkable(nx,ny)||blocked(nx,ny))continue;seen.set(nk,k);q.push([nx,ny]);}}
 return null;
}
function pickGoal(p,t){
 const f=furniture(t),i=Math.max(0,t.members.indexOf(p.id));
 if(p.act==='spotlight')return {key:'console:'+t.id,at:f.consoleSpot,stand:true,face:-1};
 if(p.act==='working'&&f.seats.length){const s=f.seats[i%f.seats.length];return {key:s.key,at:s.seat,sit:true,face:1};}
 if(hub&&(p.act==='meeting'||p.act==='deck')){const H=hubFurniture(hub);
  if(H.seats.length){const n=p.act==='meeting'?meetSeat.get(p.id)??0:[...people.keys()].indexOf(p.id),s=H.seats[n%H.seats.length];return {key:'hub'+s.key,at:s.seat,sit:true,face:s.face};}}
 const s=spot(t);return {key:'roam',at:[Math.floor(s.x),Math.floor(s.y)]};
}
function plan(p,t){p.goal=pickGoal(p,t);p.path=route(p,[p.goal.at])||route(p,[[Math.floor(spot(t).x),Math.floor(spot(t).y)]])||[];p.arrived=false;p.sitting=p.standing=false;p.planTown=t.id;}
function step(dt){
 blockedCache=null;spots.clear();for(const t of towns)spots.set(t.id,spotlight(t));
 for(const p of people.values()){
  if(drag?.p===p)continue;const t=towns.find(t=>t.id===p.town);if(!t)continue;
  const act=activityAt(p);
  if(act!==p.act||p.planTown!==t.id||!p.path){p.act=act;p.wait=act==='spotlight'?0:Math.random()*1.2;plan(p,t);}
  if(p.standing||p.sitting)continue;
  if(p.wait>0){p.wait-=dt;continue;}
  if(!p.path.length){
   if(p.arrived)continue;p.arrived=true;const g=p.goal;
   if(g.stand){p.standing=true;p.face=g.face;p.x=g.at[0]+.5;p.y=g.at[1]+.5;continue;}
   if(g.sit){p.sitting=true;p.face=g.face;p.x=g.at[0]+.5;p.y=g.at[1]+.5;continue;}
   if(act==='floating'){p.wait=1+Math.random()*3;p.arrived=false;p.goal=pickGoal(p,t);p.path=route(p,[p.goal.at])||[];}
   continue;}
  const n=p.path[0];if(blocked(Math.floor(n.x),Math.floor(n.y))){plan(p,t);continue;}
  const dx=n.x-p.x,dy=n.y-p.y,dd=Math.hypot(dx,dy),v=Math.min(dd,1.6*dt*(act==='floating'?.6:1)*(act==='spotlight'?1.8:1)*(1+Math.min(3,p.path.length/8)));
  if(dd<.02){p.path.shift();continue;}
  p.face=dx-dy<0?-1:1;p.x+=dx/dd*v;p.y+=dy/dd*v;p.walk=(p.walk||0)+dt;
 }
 if(!step.t||performance.now()-step.t>500){step.t=performance.now();renderPhase();}
}
let lastPhase='';
function renderPhase(force){
 const n={spotlight:0,working:0,floating:0,meeting:0,deck:0};for(const p of people.values())if(p.act)n[p.act]++;
 const s=nowS()%MEET_EVERY,meet=meetMode==='now'?'📡 Linked ideas are meeting at the Deck':meetMode==='off'?'Meetings are off':meetingNow()?'📡 Meeting in progress ('+Math.ceil(MEET_FOR-s)+' s left)':'Next meeting in '+Math.ceil(MEET_EVERY-s)+' s';
 $('phase').textContent=people.size?(gatherAll?'🔭 Everyone is at the Observation Deck':meet)+' · '+[n.spotlight&&'💡 '+n.spotlight+' in the spotlight',n.working&&n.working+' working',n.floating&&n.floating+' floating',n.meeting&&n.meeting+' meeting'].filter(Boolean).join(' · '):'No crew aboard yet.';
 const k=towns.map(t=>spots.get(t.id)?.id).join()+gatherAll;
 if(k!==lastPhase||force){lastPhase=k;renderTowns();}
 if(selected&&people.has(selected)){const p=people.get(selected);if($('card-meta').dataset.act!==p.act){$('card-meta').dataset.act=p.act;openCard(p);}}
}
function renderGather(){$('gather').textContent=gatherAll?'Back to the modules':'🔭 Everyone to the Observation Deck';$('gather').classList.toggle('on',gatherAll);}
$('gather').onclick=()=>{gatherAll=!gatherAll;renderGather();tell(gatherAll?'All crew to the Observation Deck!':'Crew heading back to their modules.');};
$('visit-deck').onclick=()=>{if(hub)focusTown(hub);};
function boardText(t){ // what the module's mission board shows
 const sp=spots.get(t.id);
 if(gatherAll)return {live:false,title:t.name,who:'Crew is at the Observation Deck'};
 if(sp){const l=currentLine(sp),tags=tagsOf(sp.row);return {live:true,title:nameOf(sp.row),who:tags.length?tags.map(x=>'#'+x).join('  '):'no tags',tags,line:l,links:linked.get(sp.id)?.size||0,prog:(nowS()/SPOT+hash(t.id)%97)%1};}
 return {live:false,title:t.name,who:'No ideas docked yet'};
}

// ---------- drawing: isometric space station ----------
const stars=Array.from({length:420},()=>({x:Math.random(),y:Math.random(),d:.2+Math.random()*.8,r:Math.random()*1.4+.3,p:Math.random()*6}));
const PLANETS=[{x:.84,y:.16,r:96,c1:'#4cc9f0',c2:'#03045e',ring:false,d:.04,earth:true},{x:.1,y:.84,r:40,c1:'#e0aaff',c2:'#3c096c',ring:true,d:.07}];
const shade=(hex,f)=>{const n=parseInt(hex.slice(1),16),c=[n>>16,n>>8&255,n&255].map(v=>Math.max(0,Math.min(255,Math.round(f<1?v*f:v+(255-v)*(f-1)))));return 'rgb('+c.join(',')+')';};
const SLAB=22,WALL=30;
function poly(pts,fill,stroke){ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.X,p.Y):ctx.moveTo(p.X,p.Y));ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
const up=(p,h)=>({X:p.X,Y:p.Y-h});
function background(W,H,now){
 const g=ctx.createRadialGradient(W*.6,H*.35,0,W*.5,H*.5,Math.max(W,H));g.addColorStop(0,'#141a44');g.addColorStop(.55,'#0a0b26');g.addColorStop(1,'#03040e');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
 const n=ctx.createRadialGradient(W*.25,H*.3,0,W*.25,H*.3,W*.45);n.addColorStop(0,'#3a0ca322');n.addColorStop(1,'#0000');ctx.fillStyle=n;ctx.fillRect(0,0,W,H);
 for(const s of stars){const x=((s.x*W-cam.x*s.d*.08)%W+W)%W,y=((s.y*H-cam.y*s.d*.08)%H+H)%H;ctx.globalAlpha=.45+.55*Math.abs(Math.sin(now*s.d*1.5+s.p));ctx.fillStyle='#fff';ctx.fillRect(x,y,s.r,s.r);}
 ctx.globalAlpha=1;
 for(const p of PLANETS){const x=p.x*W-cam.x*p.d,y=p.y*H-cam.y*p.d,gr=ctx.createRadialGradient(x-p.r*.4,y-p.r*.4,p.r*.1,x,y,p.r);gr.addColorStop(0,p.c1);gr.addColorStop(1,p.c2);
  if(p.ring){ctx.strokeStyle='#e0aaff55';ctx.lineWidth=5;ctx.beginPath();ctx.ellipse(x,y,p.r*1.7,p.r*.35,-.3,Math.PI,2*Math.PI);ctx.stroke();}
  ctx.fillStyle=gr;ctx.beginPath();ctx.arc(x,y,p.r,0,7);ctx.fill();
  if(p.earth){ctx.save();ctx.beginPath();ctx.arc(x,y,p.r,0,7);ctx.clip();ctx.fillStyle='#57cc99aa';for(const [a,b,rx,ry] of [[-.3,-.2,.35,.22],[.25,.15,.28,.35],[-.1,.5,.3,.12]]){ctx.beginPath();ctx.ellipse(x+a*p.r+Math.sin(now*.05)*p.r*.1,y+b*p.r,rx*p.r,ry*p.r,.4,0,7);ctx.fill();}ctx.restore();
   const at=ctx.createRadialGradient(x,y,p.r*.9,x,y,p.r*1.15);at.addColorStop(0,'#4cc9f000');at.addColorStop(.5,'#4cc9f055');at.addColorStop(1,'#4cc9f000');ctx.fillStyle=at;ctx.beginPath();ctx.arc(x,y,p.r*1.15,0,7);ctx.fill();}
  if(p.ring){ctx.beginPath();ctx.ellipse(x,y,p.r*1.7,p.r*.35,-.3,0,Math.PI);ctx.stroke();}}
}
function drawPlatform(t,tx,ty,now){
 const N=iso(tx,ty),E=iso(tx+t.w,ty),S=iso(tx+t.w,ty+t.h),Wp=iso(tx,ty+t.h);
 const c=iso(tx+t.w/2,ty+t.h/2),gl=ctx.createRadialGradient(c.X,c.Y+SLAB+30,0,c.X,c.Y+SLAB+30,t.w*TW*.35);gl.addColorStop(0,t.color+'44');gl.addColorStop(1,t.color+'00');ctx.fillStyle=gl;ctx.fillRect(c.X-t.w*TW*.4,c.Y,t.w*TW*.8,t.h*TH+120);
 // hull: brushed metal sides with a coloured stripe and blinking hull lights
 poly([Wp,S,up(S,-SLAB),up(Wp,-SLAB)],'#b8bfd4');poly([S,E,up(E,-SLAB),up(S,-SLAB)],'#8b93b8');
 ctx.lineWidth=3;ctx.strokeStyle=t.color;ctx.beginPath();ctx.moveTo(Wp.X,Wp.Y+SLAB*.55);ctx.lineTo(S.X,S.Y+SLAB*.55);ctx.lineTo(E.X,E.Y+SLAB*.55);ctx.stroke();
 ctx.lineWidth=1;ctx.strokeStyle='#ffffff55';for(let i=0;i<=t.w;i+=2){const a=iso(tx+i,ty+t.h);ctx.beginPath();ctx.moveTo(a.X,a.Y);ctx.lineTo(a.X,a.Y+SLAB);ctx.stroke();}
 for(let j=0;j<=t.h;j+=2){const a=iso(tx+t.w,ty+j);ctx.beginPath();ctx.moveTo(a.X,a.Y);ctx.lineTo(a.X,a.Y+SLAB);ctx.stroke();}
 for(let i=1;i<t.w;i+=4){const a=iso(tx+i+.5,ty+t.h);ctx.fillStyle=Math.sin(now*2.5+i)>.6?'#ff5d73':'#ff5d7333';ctx.beginPath();ctx.arc(a.X,a.Y+SLAB*.25,2,0,7);ctx.fill();}
 // solar panel wings on the east side
 const w0=iso(tx+t.w,ty+t.h*.3),w1=iso(tx+t.w,ty+t.h*.7),arm=TW*.9;
 ctx.strokeStyle='#9aa3c7';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo((w0.X+w1.X)/2,(w0.Y+w1.Y)/2+SLAB/2);ctx.lineTo((w0.X+w1.X)/2+arm*.4,(w0.Y+w1.Y)/2+SLAB/2-arm*.2);ctx.stroke();
 poly([{X:w0.X+arm*.4,Y:w0.Y+SLAB/2-arm*.2},{X:w0.X+arm*1.6,Y:w0.Y+SLAB/2-arm*.8},{X:w1.X+arm*1.6,Y:w1.Y+SLAB/2-arm*.8},{X:w1.X+arm*.4,Y:w1.Y+SLAB/2-arm*.2}],'#1d3557','#4cc9f0');
 ctx.strokeStyle='#4cc9f055';ctx.beginPath();for(let k=1;k<4;k++){const f=k/4;ctx.moveTo(w0.X+arm*(.4+1.2*f),w0.Y+SLAB/2-arm*(.2+.6*f));ctx.lineTo(w1.X+arm*(.4+1.2*f),w1.Y+SLAB/2-arm*(.2+.6*f));}ctx.stroke();
 // deck plating
 const g=ctx.createLinearGradient(N.X,N.Y,S.X,S.Y);g.addColorStop(0,'#3d4466');g.addColorStop(1,'#2a2e45');poly([N,E,S,Wp],g);
 ctx.strokeStyle='#ffffff10';ctx.lineWidth=1;ctx.beginPath();
 for(let i=1;i<t.w;i++){const a=iso(tx+i,ty),b=iso(tx+i,ty+t.h);ctx.moveTo(a.X,a.Y);ctx.lineTo(b.X,b.Y);}
 for(let j=1;j<t.h;j++){const a=iso(tx,ty+j),b=iso(tx+t.w,ty+j);ctx.moveTo(a.X,a.Y);ctx.lineTo(b.X,b.Y);}ctx.stroke();
 ctx.shadowColor=t.color;ctx.shadowBlur=12;ctx.lineWidth=2;poly([N,E,S,Wp],null,t.color+'cc');ctx.shadowBlur=0;
}
function drawWall(x,y,now){
 const N=iso(x,y),E=iso(x+1,y),S=iso(x+1,y+1),Wp=iso(x,y+1);
 poly([Wp,S,up(S,WALL),up(Wp,WALL)],'#4b5371');poly([S,E,up(E,WALL),up(S,WALL)],'#363c56');
 poly([up(N,WALL),up(E,WALL),up(S,WALL),up(Wp,WALL)],'#8b93b8');
 const pulse=.55+.45*Math.sin(now*2.5+x*.7+y*.5);ctx.globalAlpha=pulse;ctx.shadowColor='#5ef2ff';ctx.shadowBlur=10;ctx.lineWidth=2;
 poly([up(N,WALL),up(E,WALL),up(S,WALL),up(Wp,WALL)],null,'#5ef2ff');ctx.shadowBlur=0;ctx.globalAlpha=1;
}
function drawSign(t,tx,ty,now){
 const b=t===hub?iso(tx+t.w/2,ty+1):iso(tx+1.5,ty+1.5),top=b.Y-(t===hub?96:112)-Math.sin(now*1.5+t.x)*3;
 ctx.strokeStyle='#9aa3c7';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(b.X,b.Y-(t===hub?70:78));ctx.lineTo(b.X,top+26);ctx.stroke();
 ctx.font='bold 15px system-ui';const label=(t===hub?'🔭 ':'')+t.name,sw=ctx.measureText(label).width+26;
 ctx.fillStyle='#0d1030cc';ctx.shadowColor=t.color;ctx.shadowBlur=16;ctx.beginPath();ctx.roundRect(b.X-sw/2,top,sw,26,6);ctx.fill();ctx.shadowBlur=0;
 ctx.strokeStyle=t.color;ctx.lineWidth=1.5;ctx.stroke();
 ctx.fillStyle='#f1f4ff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,b.X,top+13.5);
}
// ---------- Observation Deck + docking tubes ----------
let hub=null;
const inRect=(r,x,y)=>x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h;
const doorOf=t=>Math.floor(t.w/2);
const hubCache={};
function hubFurniture(h){
 const k=[h.x,h.y,h.w,h.h].join();if(hubCache.k===k)return hubCache.f;
 const f={items:[],block:new Set(),seats:[]};
 const add=(type,x,y,w,hh,extra={},blocks=true)=>{const it={type,x,y,w,h:hh,key:type+':'+x+','+y,...extra};f.items.push(it);if(blocks)for(let i=0;i<w;i++)for(let j=0;j<hh;j++)f.block.add(key(x+i,y+j));return it;};
 // telescope under the big window, plants in the corners, round meeting tables with four stools
 add('telescope',h.x+Math.floor(h.w/2)-1,h.y+1,2,1);
 for(const [x,y] of [[h.x+1,h.y+1],[h.x+h.w-2,h.y+1],[h.x+h.w-2,h.y+h.h-2],[h.x+1,h.y+h.h-2]])add('plant',x,y,1,1);
 for(let y=h.y+4;y<=h.y+h.h-4;y+=4)for(let x=h.x+3;x+1<=h.x+h.w-3;x+=4){add('decktable',x,y,1,1);
  for(const [sx,sy,face] of [[x-1,y,1],[x+1,y,-1],[x,y-1,1],[x,y+1,-1]])f.seats.push(add('stool',sx,sy,1,1,{face,seat:[sx,sy],table:x+','+y},false));}
 hubCache.k=k;hubCache.f=f;return f;
}
function ensureHub(){
 const need=Math.max(1,people.size,meetNeed);let grew=false;
 if(!hub&&!towns.length)return false;
 if(!hub){const s=local.hub;hub={id:'__hub',name:'Observation Deck',color:'#4cc9f0',members:[],x:s?.x??0,y:s?.y??0,w:s?.w||12,h:s?.h||12};if(!s?.w){fitHub(need);Object.assign(hub,placeNear(hub.w,hub.h));grew=true;}}
 if(fitHub(need))grew=true;return grew;
}
function fitHub(need){let g=false;while(hub.w<90&&hubFurniture(hub).seats.length<need){hub.w+=2;hub.h+=2;g=true;}return g;}
function placeNear(w,h){ // the free spot closest to the middle of all modules
 if(!towns.length)return {x:2,y:2,w,h};
 const cx=towns.reduce((a,t)=>a+t.x+t.w/2,0)/towns.length,cy=towns.reduce((a,t)=>a+t.y+t.h/2,0)/towns.length;
 const free=(x,y)=>!towns.some(o=>x<o.x+o.w+5&&x+w+5>o.x&&y<o.y+o.h+5&&y+h+5>o.y);
 for(let r=0;r<150;r++)for(let dx=-r;dx<=r;dx++)for(const dy of [-r,r]){for(const [a,b] of [[dx,dy],[dy,dx]]){const x=Math.round(cx-w/2+a),y=Math.round(cy-h/2+b);if(free(x,y))return {x,y,w,h};}}
 return {x:2,y:2,w,h};
}
let wayCache={sig:'',set:new Set()};
function walkways(){
 if(!hub)return wayCache.set;
 const sig=towns.map(t=>[t.x,t.y,t.w,t.h].join()).join('|')+'#'+[hub.x,hub.y,hub.w,hub.h];
 if(wayCache.sig===sig)return wayCache.set;
 const set=new Set(),rects=[...towns,hub],X0=Math.min(...rects.map(r=>r.x))-6,Y0=Math.min(...rects.map(r=>r.y))-6,X1=Math.max(...rects.map(r=>r.x+r.w))+6,Y1=Math.max(...rects.map(r=>r.y+r.h))+6;
 const goal=new Set();for(let x=hub.x+1;x<hub.x+hub.w-1;x++){goal.add(key(x,hub.y-1));goal.add(key(x,hub.y+hub.h));}for(let y=hub.y+1;y<hub.y+hub.h-1;y++){goal.add(key(hub.x-1,y));goal.add(key(hub.x+hub.w,y));}
 const order=[...towns].sort((a,b)=>Math.hypot(a.x-hub.x,a.y-hub.y)-Math.hypot(b.x-hub.x,b.y-hub.y));
 for(const t of order){
  const sx=t.x+doorOf(t),sy=t.y+t.h;if(rects.some(r=>inRect(r,sx,sy)))continue;
  const seen=new Map([[key(sx,sy),null]]),q=[[sx,sy]];let end=null;
  for(let i=0;i<q.length;i++){const [x,y]=q[i],k=key(x,y);if(goal.has(k)||set.has(k)){end=k;break;}
   for(const [dx,dy] of [[0,1],[1,0],[-1,0],[0,-1]]){const nx=x+dx,ny=y+dy,nk=key(nx,ny);if(nx<X0||nx>X1||ny<Y0||ny>Y1||seen.has(nk)||rects.some(r=>inRect(r,nx,ny)))continue;seen.set(nk,k);q.push([nx,ny]);}}
  for(let c=end;c;c=seen.get(c))set.add(c);
 }
 wayCache={sig,set};return set;
}
function walkable(x,y){
 if(hub&&inRect(hub,x,y))return true;
 for(const t of towns){if(x>=t.x+1&&x<=t.x+t.w-2&&y>=t.y+2&&y<=t.y+t.h-2)return true;if(x===t.x+doorOf(t)&&y===t.y+t.h-1)return true;}
 return walkways().has(key(x,y));
}
function drawTube(x,y,now){ // docking tube: floor with glass ribs
 const N=iso(x,y),E=iso(x+1,y),S=iso(x+1,y+1),Wp=iso(x,y+1);
 poly([Wp,S,up(S,-7),up(Wp,-7)],'#8b93b8');poly([S,E,up(E,-7),up(S,-7)],'#6c7296');
 ctx.lineWidth=1;poly([N,E,S,Wp],'#3d4466','#5ef2ff40');
 const c=iso(x+.5,y+.5);ctx.fillStyle=Math.sin(now*3-(x+y)*.8)>.5?'#5ef2ff':'#5ef2ff33';ctx.fillRect(c.X-3,c.Y-1,6,2);
 ctx.strokeStyle='#a3c4f344';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(Wp.X,Wp.Y);ctx.quadraticCurveTo(c.X,c.Y-40,E.X,E.Y);ctx.stroke();
}
// ---------- furniture drawing ----------
function box(x,y,w,h,z,H,top,left,right){
 const N=up(iso(x,y),z+H),E=up(iso(x+w,y),z+H),S=up(iso(x+w,y+h),z+H),Wp=up(iso(x,y+h),z+H),S0=up(iso(x+w,y+h),z),W0=up(iso(x,y+h),z),E0=up(iso(x+w,y),z);
 poly([W0,S0,S,Wp],left);poly([S0,E0,E,S],right);poly([N,E,S,Wp],top);
}
const flat=(x,y,w,h,z,fill,stroke)=>{ctx.lineWidth=1;poly([up(iso(x,y),z),up(iso(x+w,y),z),up(iso(x+w,y+h),z),up(iso(x,y+h),z)],fill,stroke);};
function shell(t,tx,ty,back,deck){ // back walls with portholes (modules) or a panoramic window (Deck); low front walls with a hatch
 const H=back?78:46,x0=tx,y0=ty+1,x1=tx+t.w,y1=ty+t.h;
 if(back){
  poly([up(iso(x0,y1),0),up(iso(x0,y0),0),up(iso(x0,y0),H),up(iso(x0,y1),H)],'#3d4466ee');
  poly([up(iso(x0,y0),0),up(iso(x1,y0),0),up(iso(x1,y0),H),up(iso(x0,y0),H)],'#4b5371ee');
  ctx.strokeStyle=t.color;ctx.lineWidth=2;ctx.beginPath();const a=up(iso(x0,y1),H),b=up(iso(x0,y0),H),c=up(iso(x1,y0),H);ctx.moveTo(a.X,a.Y);ctx.lineTo(b.X,b.Y);ctx.lineTo(c.X,c.Y);ctx.stroke();
  if(deck)drawWindow(t,tx,ty,H);else drawBoard(t,tx,ty,H);
  for(let j=2;j<t.h-2;j+=3){const p=up(iso(x0,y0+j),H*.55);ctx.fillStyle='#0b0b24';ctx.beginPath();ctx.ellipse(p.X,p.Y,8,8,0,0,7);ctx.fill();ctx.strokeStyle='#cfd5ea';ctx.lineWidth=2.5;ctx.stroke();ctx.fillStyle='#fff';ctx.fillRect(p.X-2+(j%2),p.Y-3,1.5,1.5);}
 }else{
  const L=8,door=Math.floor(t.w/2);
  for(let i=0;i<t.w;i++){if(i===door||i===door-1)continue;poly([up(iso(x0+i,y1),0),up(iso(x0+i+1,y1),0),up(iso(x0+i+1,y1),L),up(iso(x0+i,y1),L)],deck?'#a3c4f355':'#8b93b8');}
  poly([up(iso(x1,y1),0),up(iso(x1,y0),0),up(iso(x1,y0),L),up(iso(x1,y1),L)],deck?'#a3c4f344':'#6c7296');
  const dm=iso(x0+door,y1);ctx.fillStyle=t.color;ctx.fillRect(dm.X-3,dm.Y-3,6,3);
 }
}
function wallQuad(sx0,sw,y0,z0,z1){return [up(iso(sx0,y0),z1),up(iso(sx0+sw,y0),z1),up(iso(sx0+sw,y0),z0),up(iso(sx0,y0),z0)];}
function drawWindow(t,tx,ty,H){ // the Deck's panoramic window, with Earth turning slowly outside
 const sw=t.w-4,sx0=tx+2,y0=ty+1,q=wallQuad(sx0,sw,y0,10,H-8),now=performance.now()/1000;
 poly([up(q[0],4),up(q[1],4),up(q[2],-4),up(q[3],-4)],'#cfd5ea');
 const g=ctx.createLinearGradient(q[0].X,q[0].Y,q[2].X,q[2].Y);g.addColorStop(0,'#02031a');g.addColorStop(1,'#10164a');poly(q,g);
 ctx.save();ctx.beginPath();q.forEach((p,i)=>i?ctx.lineTo(p.X,p.Y):ctx.moveTo(p.X,p.Y));ctx.closePath();ctx.clip();
 for(let i=0;i<40;i++){const u=(hash('s'+i)%1000)/1000,v=(hash('v'+i)%1000)/1000,p=up(iso(sx0+u*sw,y0),10+v*(H-18));ctx.fillStyle='#fff';ctx.globalAlpha=.4+.6*Math.abs(Math.sin(now+i));ctx.fillRect(p.X,p.Y,1.5,1.5);}ctx.globalAlpha=1;
 const e=up(iso(sx0+sw*.62,y0),-10),r=sw*TW*.16,eg=ctx.createRadialGradient(e.X-r*.3,e.Y-r*.4,r*.1,e.X,e.Y,r);eg.addColorStop(0,'#4cc9f0');eg.addColorStop(1,'#03045e');ctx.fillStyle=eg;ctx.beginPath();ctx.arc(e.X,e.Y,r,0,7);ctx.fill();
 ctx.fillStyle='#57cc99aa';for(const [a,b,rx,ry] of [[-.3,-.5,.3,.15],[.2,-.3,.25,.2]]){ctx.beginPath();ctx.ellipse(e.X+(a+((now*.01)%1)-.5)*r,e.Y+b*r,rx*r,ry*r,.3,0,7);ctx.fill();}
 ctx.restore();
 ctx.strokeStyle='#cfd5ea';ctx.lineWidth=3;ctx.beginPath();for(let i=1;i<4;i++){const a=up(iso(sx0+sw*i/4,y0),10),b=up(iso(sx0+sw*i/4,y0),H-8);ctx.moveTo(a.X,a.Y);ctx.lineTo(b.X,b.Y);}ctx.stroke();
 ctx.fillStyle='#ffffff14';poly([q[0],{X:q[0].X+30,Y:q[0].Y+15},{X:q[3].X+60,Y:q[3].Y+30},q[3]],'#ffffff10');
}
function wrap(text,max,lines){
 const flatText=text.replace(/\s+/g,' ').trim(),words=flatText.split(' '),out=[];let line='';
 for(const w of words){const t=line?line+' '+w:w;if(ctx.measureText(t).width<=max||!line)line=t;else{out.push(line);line=w;if(out.length===lines)break;}}
 if(out.length<lines&&line)out.push(line);
 if(out.join(' ').length<flatText.length){let l=out[out.length-1];while(l&&ctx.measureText(l+'…').width>max)l=l.slice(0,-1);out[out.length-1]=l+'…';}
 return out;
}
function drawBoard(t,tx,ty,H){ // mission board on the back wall, text skewed onto the wall plane
 const sw=Math.min(t.w-4,Math.max(6,Math.round(t.w*.55))),sx0=tx+Math.floor((t.w-sw)/2),y0=ty+1,z0=5,z1=H-5,now=performance.now()/1000;
 const [tl,tr,br,bl]=wallQuad(sx0,sw,y0,z0,z1),info=boardText(t);
 poly([up(tl,4),up(tr,4),up(br,-4),up(bl,-4)],'#1b1f3a');
 const g=ctx.createLinearGradient(tl.X,tl.Y,br.X,br.Y);g.addColorStop(0,'#0d1b3e');g.addColorStop(1,'#071029');poly([tl,tr,br,bl],g);
 const Wd=sw*TW/2,Hd=z1-z0;ctx.save();ctx.translate(tl.X,tl.Y);ctx.transform(1,.5,0,1,0,0);
 ctx.beginPath();ctx.rect(0,0,Wd,Hd);ctx.clip();ctx.textAlign='left';ctx.textBaseline='top';
 ctx.strokeStyle='#5ef2ff14';ctx.lineWidth=1;ctx.beginPath();for(let x=0;x<Wd;x+=12){ctx.moveTo(x,0);ctx.lineTo(x,Hd);}for(let y=0;y<Hd;y+=12){ctx.moveTo(0,y);ctx.lineTo(Wd,y);}ctx.stroke();
 const size=Math.max(9,Math.min(14,Wd/22)),small=Math.round(size*.75);ctx.fillStyle=info.live?t.color:'#3d4466';ctx.fillRect(0,0,Wd,4);
 ctx.font='bold '+small+'px system-ui';ctx.fillStyle='#5ef2ff';ctx.fillText(wrap(info.live?'💡 SPOTLIGHT · '+t.name.toUpperCase():'MISSION BOARD',Wd*.62,1)[0]||'',8,8);
 ctx.font='bold '+size+'px system-ui';ctx.fillStyle='#fff';ctx.fillText(wrap(info.title,Wd-16,1)[0]||'',8,10+small);
 if(info.live){
  ctx.font='bold '+small+'px system-ui';let x=8;for(const tg of info.tags.slice(0,4)){const w=ctx.measureText('#'+tg).width;if(x+w>Wd-8)break;ctx.fillStyle=tagColor(tg);ctx.fillText('#'+tg,x,14+small+size);x+=w+10;}
  if(!info.tags.length){ctx.fillStyle='#9aa3c7';ctx.fillText('no tags',8,14+small+size);}
  if(info.line){ctx.font='italic '+small+'px system-ui';ctx.fillStyle='#dfe6ff';ctx.fillText(wrap('“'+info.line.line+'”',Wd-16,1)[0]||'',8,18+small*2+size);}
  ctx.font='bold '+small+'px system-ui';ctx.textAlign='right';ctx.fillStyle='#ffd166';ctx.fillText('📡 '+info.links+(info.line?' · '+(info.line.k+1)+'/'+info.line.n:''),Wd-8,8);ctx.textAlign='left';
  ctx.fillStyle='#2b3170';ctx.fillRect(8,Hd-6,Wd-16,3);ctx.fillStyle=t.color;ctx.fillRect(8,Hd-6,(Wd-16)*info.prog,3);
 }else{ctx.font=small+'px system-ui';ctx.fillStyle='#9aa3c7';ctx.fillText(wrap(info.who,Wd-16,1)[0]||'',8,14+small+size);}
 ctx.restore();
}
function drawStage(t,tx,ty){const s=furniture({...t,x:tx,y:ty}).stage;box(s.x-.5,s.y-.5,s.w+1,s.h+.5,0,6,shade(t.color,.45),shade(t.color,.35),shade(t.color,.28));
 ctx.lineWidth=1;flat(s.x-.5,s.y-.5,s.w+1,s.h+.5,6,null,t.color+'aa');}
const townColor=id=>towns.find(t=>t.id===id)?.color||'#5ef2ff';
function drawItem(it,occ,now){
 const {x,y,w}=it,who=occ.get(it.key);
 switch(it.type){
  case 'seat':{const c='#565b7c';box(x+.25,y+.3,.5,.45,0,7,'#6c7296',shade('#565b7c',.9),shade('#565b7c',.75));box(x+.25,y+.68,.5,.1,7,13,'#8b93b8',c,shade(c,.8));break;}
  case 'desk':{const tc=townColor(it.town),on=occ.get('seat:'+x+','+(y+1));box(x+.08,y+.25,.84,.55,0,13,'#cfd5ea','#9aa3c7','#6c7296');
   box(x+.22,y+.4,.56,.06,13,13,'#1b1f3a',on?tc:'#2a2e45','#14183a');if(on){const s=up(iso(x+.5,y+.46),20);ctx.fillStyle='#ffffffaa';ctx.fillRect(s.X-6,s.Y-2+Math.sin(now*3+x)*2,8,1.5);}break;}
  case 'console':{const tc=townColor(it.town);box(x+.15,y+.2,.7,.6,6,14,'#3b4163','#2a2e45','#1b1f3a');const s=up(iso(x+.5,y+.5),20);ctx.fillStyle=tc;ctx.beginPath();ctx.ellipse(s.X,s.Y,14,7,0,0,7);ctx.fill();
   if(spots.get(it.town)&&!gatherAll){const b=s.Y-38+Math.sin(now*2)*3;ctx.save();ctx.globalAlpha=.25;ctx.fillStyle='#5ef2ff';ctx.beginPath();ctx.moveTo(s.X-13,s.Y);ctx.lineTo(s.X-9,b);ctx.lineTo(s.X+9,b);ctx.lineTo(s.X+13,s.Y);ctx.fill();ctx.restore();
    ctx.save();ctx.globalAlpha=.85;ctx.shadowColor='#ffd166';ctx.shadowBlur=18;ctx.fillStyle='#fff3b0';ctx.beginPath();ctx.arc(s.X,b-6,8,0,7);ctx.fill();ctx.fillStyle='#cfd5ea';ctx.fillRect(s.X-4,b+1,8,5);ctx.shadowBlur=0;
    ctx.strokeStyle='#ffd166';ctx.lineWidth=1.5;for(let i=0;i<6;i++){const a=i*Math.PI/5+Math.PI,r1=12+Math.sin(now*4+i)*2;ctx.beginPath();ctx.moveTo(s.X+Math.cos(a)*r1,b-6+Math.sin(a)*r1);ctx.lineTo(s.X+Math.cos(a)*(r1+5),b-6+Math.sin(a)*(r1+5));ctx.stroke();}ctx.restore();}break;}
  case 'tank':box(x+.3,y+.3,.4,.4,0,30,'#e9ecf5','#b8bfd4','#9aa3c7');{const s=up(iso(x+.5,y+.7),18);ctx.fillStyle='#d1495b';ctx.fillRect(s.X-6,s.Y-1,12,3);}break;
  case 'stool':box(x+.33,y+.33,.34,.34,0,8,'#cfd5ea','#9aa3c7','#6c7296');break;
  case 'decktable':{box(x+.45,y+.45,.1,.1,0,12,'#3b4163','#2a2e45','#1b1f3a');const p=up(iso(x+.5,y+.5),13),busy=['stool:'+(x-1)+','+y,'stool:'+(x+1)+','+y,'stool:'+x+','+(y-1),'stool:'+x+','+(y+1)].some(k=>occ.get('hub'+k));
   ctx.fillStyle=busy?'#5ef2ff55':'#cfd5ea';ctx.strokeStyle='#5ef2ff';ctx.lineWidth=1.5;ctx.beginPath();ctx.ellipse(p.X,p.Y,24,12,0,0,7);ctx.fill();ctx.stroke();
   if(busy){ctx.save();ctx.globalAlpha=.6+.3*Math.sin(now*3);ctx.strokeStyle='#ffd166';ctx.beginPath();ctx.arc(p.X,p.Y-14,5,0,7);ctx.moveTo(p.X,p.Y-9);ctx.lineTo(p.X,p.Y-2);ctx.stroke();for(const r of [9,13]){ctx.beginPath();ctx.arc(p.X,p.Y-14,r,-2.4,-.7);ctx.stroke();}ctx.restore();}break;}
  case 'telescope':{box(x+.6,y+.3,.8,.4,0,10,'#3b4163','#2a2e45','#1b1f3a');const a=up(iso(x+1,y+.5),10);ctx.strokeStyle='#cfd5ea';ctx.lineWidth=7;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(a.X-10,a.Y+2);ctx.lineTo(a.X+18,a.Y-26);ctx.stroke();ctx.lineWidth=3;ctx.strokeStyle='#5ef2ff';ctx.beginPath();ctx.moveTo(a.X+14,a.Y-22);ctx.lineTo(a.X+19,a.Y-27);ctx.stroke();ctx.lineCap='butt';break;}
  case 'plant':{box(x+.32,y+.32,.36,.36,0,10,'#cfd5ea','#9aa3c7','#6c7296');const p=up(iso(x+.5,y+.5),20);ctx.fillStyle='#4caf50';for(const [ox,oy,r] of [[0,0,8],[-5,3,6],[5,3,6],[0,-6,6]]){ctx.beginPath();ctx.arc(p.X+ox,p.Y+oy,r,0,7);ctx.fill();}ctx.fillStyle='#c77dff';ctx.beginPath();ctx.arc(p.X-2,p.Y-4,2.5,0,7);ctx.fill();break;}
 }
}
// Floating ideas drift in zero-g; everyone bobs gently.
function lift(p,now){if(p.act==='floating'&&!p.sitting)return 10+Math.sin(now*1.3+hash(p.id)%7)*4;return 0;}
function drawPerson(p,now){
 const h=hash(p.id),f=iso(p.x,p.y),x=f.X,float=lift(p,now)>0,moving=!float&&p.wait<=0&&!p.sitting&&!p.arrived&&drag?.p!==p,bob=moving?0:Math.sin(now*2+h%7)*1.5,b=(moving?Math.abs(Math.sin((p.walk||0)*9))*2:0)+bob+(drag?.p===p?10:0)+lift(p,now),y=f.Y-b+(p.sitting?-4:0);
 const tags=tagsOf(p.row),suit=tags.length?tagColor(tags[0]):SUITS[h%SUITS.length],face=p.face||1;
 if(dimmed(p))ctx.globalAlpha=.22;
 if(selected===p.id||highlight&&!dimmed(p)){ctx.strokeStyle=selected===p.id?'#5ef2ff':'#ffd166';ctx.lineWidth=2;ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=10;ctx.beginPath();ctx.ellipse(x,f.Y,15,7,0,0,7);ctx.stroke();ctx.shadowBlur=0;}
 ctx.fillStyle='#00000055';ctx.beginPath();ctx.ellipse(x,f.Y,float?6:9,float?3:4,0,0,7);ctx.fill();
 if(float){const k=(now*4+h)%1;ctx.fillStyle='#ffffff'+(k<.5?'88':'33');ctx.beginPath();ctx.arc(x+(face>0?-9:9),y-6+k*6,2+k*2,0,7);ctx.fill();}
 const s=moving?Math.sin((p.walk||0)*9)*2:0;ctx.fillStyle='#d9dde8';
 if(p.sitting){ctx.fillRect(x-6+face*2,y-8,4,5);ctx.fillRect(x+2+face*2,y-8,4,5);}else if(float){ctx.fillRect(x-6,y-8,4,7);ctx.fillRect(x+2,y-9,4,7);}else{ctx.fillRect(x-6+s,y-8,4,8);ctx.fillRect(x+2-s,y-8,4,8);}
 ctx.fillStyle='#8a90a6';ctx.fillRect(x-6+s,y-2,4,2);ctx.fillRect(x+2-s,y-2,4,2);
 ctx.fillStyle=suit;ctx.beginPath();ctx.roundRect(face>0?x-11:x+5,y-21,6,12,2);ctx.fill(); // backpack in the first tag's colour
 ctx.fillStyle='#eef1f7';ctx.beginPath();ctx.roundRect(x-7,y-22,14,15,5);ctx.fill();
 ctx.fillStyle=suit;ctx.fillRect(x-7,y-14,14,3);
 tags.slice(1,4).forEach((t,i)=>{ctx.fillStyle=tagColor(t);ctx.beginPath();ctx.arc(x-3+i*4,y-18,1.6,0,7);ctx.fill();}); // more tags: chest badges
 ctx.fillStyle='#f4f6fb';ctx.beginPath();ctx.arc(x,y-29,9,0,7);ctx.fill();ctx.strokeStyle='#b8bfd4';ctx.lineWidth=1;ctx.stroke();
 const v=ctx.createLinearGradient(x-6,y-34,x+6,y-24);v.addColorStop(0,'#5ef2ff');v.addColorStop(.5,'#1b2a6b');v.addColorStop(1,'#0b1033');
 ctx.fillStyle=v;ctx.beginPath();ctx.ellipse(x+face*2,y-29,6,4.5,0,0,7);ctx.fill();
 ctx.fillStyle='#ffffffaa';ctx.fillRect(x+face*2-3,y-31,2,1.5);
 const ant=linked.has(p.id);ctx.strokeStyle='#b8bfd4';ctx.beginPath();ctx.moveTo(x-face*5,y-36);ctx.lineTo(x-face*7,y-42);ctx.stroke();
 ctx.fillStyle=ant?(Math.sin(now*5+h)>0?'#ffd166':'#5ef2ff'):suit;ctx.beginPath();ctx.arc(x-face*7,y-42,ant?2.4:1.8,0,7);ctx.fill();
 if(p.act==='spotlight'&&p.standing){const a=Math.sin(now*3+h)*4;ctx.strokeStyle='#eef1f7';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x+face*6,y-18);ctx.lineTo(x+face*12,y-24+a);ctx.stroke();}
 ctx.globalAlpha=1;
}
const antenna=(p,now)=>{const f=iso(p.x,p.y),face=p.face||1;return {X:f.X-face*7,Y:f.Y-42-lift(p,now)+(p.sitting?-4:0)};};
function drawBeams(now){ // radio beams between linked ideas
 if(beamMode==='off')return;ctx.save();ctx.lineCap='round';
 for(const [a,b] of linkPairs){const A=people.get(a),B=people.get(b);if(!A||!B)continue;
  const sel=selected===a||selected===b||hoverP===A||hoverP===B;if(beamMode==='selected'&&!sel)continue;
  const pa=antenna(A,now),pb=antenna(B,now),mx=(pa.X+pb.X)/2,my=Math.min(pa.Y,pb.Y)-20-Math.hypot(pa.X-pb.X,pa.Y-pb.Y)*.22;
  const dim=highlight&&dimmed(A)&&dimmed(B);ctx.globalAlpha=dim?.08:sel?.95:.45;
  ctx.strokeStyle=sel?'#ffd166':'#5ef2ff';ctx.lineWidth=sel?2.5:1.5;ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=sel?12:5;ctx.setLineDash([6,7]);ctx.lineDashOffset=-now*28;
  ctx.beginPath();ctx.moveTo(pa.X,pa.Y);ctx.quadraticCurveTo(mx,my,pb.X,pb.Y);ctx.stroke();ctx.setLineDash([]);
  for(const k0 of [0,.5]){const k=(now*.35+k0+(hash(a+b)%100)/100)%1,u=1-k;ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(u*u*pa.X+2*u*k*mx+k*k*pb.X,u*u*pa.Y+2*u*k*my+k*k*pb.Y,sel?3:2,0,7);ctx.fill();}
 }
 ctx.restore();
}
function tileOutline(x,y,col){ctx.lineWidth=2;poly([iso(x,y),iso(x+1,y),iso(x+1,y+1),iso(x,y+1)],col+'33',col);}
function draw(){
 const d=devicePixelRatio||1,W=canvas.width/d,H=canvas.height/d,now=performance.now()/1000;
 ctx.setTransform(d,0,0,d,0,0);background(W,H,now);
 ctx.setTransform(cam.z*d,0,0,cam.z*d,-cam.x*cam.z*d,-cam.y*cam.z*d);
 const placed=towns.map(t=>{let tx=t.x,ty=t.y;if(drag?.kind==='town'&&drag.t===t){tx+=drag.dx;ty+=drag.dy;}return {t,tx,ty};});
 const hx=hub?hub.x+(drag?.kind==='town'&&drag.t===hub?drag.dx:0):0,hy=hub?hub.y+(drag?.kind==='town'&&drag.t===hub?drag.dy:0):0,HF=hub&&hubFurniture({...hub,x:hx,y:hy});
 const shells=[...placed.map(p=>({...p,deck:false})),...(hub?[{t:hub,tx:hx,ty:hy,deck:true}]:[])].sort((a,b)=>(a.tx+a.ty)-(b.tx+b.ty));
 const occ=new Map();for(const p of people.values())if(p.arrived&&p.sitting&&p.goal)occ.set(p.goal.key,p);
 for(const k of walkways()){const [x,y]=k.split(',').map(Number);drawTube(x,y,now);}
 for(const s of shells){drawPlatform(s.t,s.tx,s.ty,now);
  if(s.deck){flat(s.tx+1,s.ty+2,s.t.w-2,s.t.h-3,.3,'#4cc9f018','#4cc9f055');shell(s.t,s.tx,s.ty,true,true);continue;}
  for(const it of furniture({...s.t,x:s.tx,y:s.ty}).items)if(it.type==='stripe'){flat(it.x+.35,it.y,it.w-.7,it.h,.5,s.t.color+'33',s.t.color+'aa');for(let j=0;j<it.h;j+=2){const c=iso(it.x+.5,it.y+j+.5);ctx.fillStyle=Math.sin(now*4-j)>.3?s.t.color:s.t.color+'44';ctx.fillRect(c.X-2,c.Y-1,4,2);}}
  shell(s.t,s.tx,s.ty,true,false);drawStage(s.t,s.tx,s.ty);}
 if(hover&&(tool==='wall'||tool==='erase'))tileOutline(Math.floor(hover.x),Math.floor(hover.y),tool==='wall'?'#5ef2ff':'#ff5d73');
 if(drag?.kind==='town'){const t=drag.t;for(const k of walls){const [x,y]=k.split(',').map(Number);if(x>=t.x-1&&x<=t.x+t.w&&y>=t.y-1&&y<=t.y+t.h)tileOutline(x+drag.dx,y+drag.dy,'#5ef2ff');}}
 const V=toIso(0,0),V2=toIso(W,H),items=[];
 for(const k of walls){const [x,y]=k.split(',').map(Number),c=iso(x+.5,y+.5);if(c.X<V.X-TW||c.X>V2.X+TW||c.Y<V.Y-TH||c.Y>V2.Y+TH*3)continue;items.push({z:x+y+1,w:[x,y]});}
 for(const {t,tx,ty} of placed)for(const it of furniture({...t,x:tx,y:ty}).items)if(it.type!=='stripe')items.push({z:it.x+it.y+(it.w+it.h)/2-(it.type==='seat'?-.03:0),it});
 if(HF)for(const it of HF.items)items.push({z:it.x+it.y+(it.w+it.h)/2-(it.type==='stool'?.02:0),it:{...it,key:'hub'+it.key}});
 for(const p of people.values())items.push({z:p.x+p.y+.01,p});
 for(const s of shells)items.push({z:s.tx+s.ty+s.t.w+s.t.h+.5,front:[s.t,s.tx,s.ty,false,s.deck]});
 items.sort((a,b)=>a.z-b.z);
 for(const p of people.values())if(p.act==='spotlight'&&p.standing){const f=iso(p.x,p.y);const g=ctx.createRadialGradient(f.X,f.Y,0,f.X,f.Y,46);g.addColorStop(0,'#fff6c8aa');g.addColorStop(1,'#fff6c800');ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(f.X,f.Y,46,23,0,0,7);ctx.fill();}
 for(const it of items)it.w?drawWall(it.w[0],it.w[1],now):it.it?drawItem(it.it,occ,now):it.front?shell(...it.front):drawPerson(it.p,now);
 drawBeams(now);
 for(const s of shells)drawSign(s.t,s.tx,s.ty,now);
 const list=[...people.values()];
 if(cam.z>=.55){ctx.font='11px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
  for(const p of list){const n=nameOf(p.row),icon=p.act==='spotlight'?'💡 ':p.act==='meeting'?'📡 ':'',label=icon+(n.length>24?n.slice(0,23)+'…':n),w=ctx.measureText(label).width+10,f=iso(p.x,p.y),x=f.X,y=f.Y+8;
   const live=p.act==='spotlight';ctx.globalAlpha=dimmed(p)?.25:1;ctx.fillStyle=selected===p.id?'#5ef2ff':live?'#ffd166':'#0d1030cc';ctx.beginPath();ctx.roundRect(x-w/2,y,w,15,4);ctx.fill();ctx.fillStyle=selected===p.id||live?'#0d1030':'#dfe6ff';ctx.fillText(label,x,y+8);}
  ctx.globalAlpha=1;}
 for(const p of list){const a=bubbleAlpha(p,now);if(a>0)drawBubble(p,a,now);}
}
// Speech bubbles: each idea says its notes, one thought at a time.
const bubbleText=p=>selected===p.id||hoverP===p?noteLines(p.row).join('\n'):currentLine(p)?.line||'';
function bubbleAlpha(p,now){
 if(!noteLines(p.row).length||dimmed(p))return 0;
 if(selected===p.id||hoverP===p)return 1;
 if(p.act==='spotlight'&&p.standing)return 1; // the spotlight idea always speaks
 if(bubbleMode==='off'||cam.z<.45)return 0;if(bubbleMode==='always')return 1;
 if(p.act==='working'&&spots.get(p.town)?.standing)return 0; // quiet while the spotlight idea talks
 const c=(now+(hash(p.id)%1000)/50)%16;return c>6?0:Math.min(1,c*3,(6-c)*3);
}
function drawBubble(p,a,now){
 const full=selected===p.id||hoverP===p;ctx.save();ctx.globalAlpha=a;ctx.font='12px system-ui';ctx.textAlign='left';ctx.textBaseline='top';
 const text=bubbleText(p),lines=full?text.split('\n').flatMap(l=>wrap(l,200,3)).slice(0,10):wrap(text,180,3),w=Math.max(...lines.map(l=>ctx.measureText(l).width))+16,h=lines.length*15+10;
 const f=iso(p.x,p.y),x=f.X,bx=x-w/2,by=f.Y-50-lift(p,now)-h;
 ctx.fillStyle='#f4f6ffee';ctx.strokeStyle=full?'#5ef2ff':'#9aa3c7';ctx.lineWidth=1.5;ctx.shadowColor='#5ef2ff';ctx.shadowBlur=full?12:0;
 ctx.beginPath();ctx.roundRect(bx,by,w,h,8);ctx.moveTo(x-6,by+h);ctx.lineTo(x,by+h+8);ctx.lineTo(x+6,by+h);ctx.fill();ctx.stroke();ctx.shadowBlur=0;
 ctx.fillRect(x-5,by+h-2,10,3);
 ctx.fillStyle='#14183a';lines.forEach((l,i)=>ctx.fillText(l,bx+8,by+6+i*15));ctx.restore();
}
let last=performance.now();
(function loop(t){step(Math.min(.1,(t-last)/1000));last=t;draw();requestAnimationFrame(loop);})(last);

// ---------- talk to the Entries view through the page shell ----------
addEventListener('message',async e=>{
 if(e.origin!==location.origin)return;const msg=e.data||{};
 if(msg.type==='ic-folder'){try{const h=await kv('folder');if(h&&!(dir&&await dir.isSameEntry(h)))await connect(h);}catch(err){tell(err.message);}}
 if(msg.type==='ic-shown'){resize();if(!camTouched)fit();if(sync&&!busy)enqueue(async()=>{const r=await sync.read();if(r.data.revision!==library.revision){library=r.data;reconcile(!layoutDirty);}});}
 if(msg.type==='ic-focus'){ // the idea may still be syncing: re-read for a few seconds
  for(let i=0;i<12;i++){const p=people.get(msg.id);if(p){frame([{x:p.x-4,y:p.y-4,w:8,h:8}],2.2);openCard(p);return;}
   if(sync)await enqueue(async()=>{const r=await sync.read();if(r.data.revision!==library.revision){library=r.data;reconcile(!layoutDirty);}});
   await new Promise(r=>setTimeout(r,500));}
  tell('That astronaut has not arrived yet. Try again after Entries says All changes synced.');}
});
addEventListener('keydown',e=>{if(e.ctrlKey&&e.shiftKey&&e.code==='KeyS'&&parent!==window){e.preventDefault();parent.postMessage({type:'ic-toggle'},location.origin);}});
