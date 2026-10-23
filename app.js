'use strict';
// One page, two views: the Entries editor and the Station. Both are live at once and
// share the same library folder through the sync journal, so switching is instant.
const frames={entries:document.getElementById('entries'),city:document.getElementById('city')};
const tabs=[...document.querySelectorAll('[data-view]')];
function show(view){
 if(!frames[view])view='entries';
 for(const [name,frame] of Object.entries(frames))frame.classList.toggle('off',name!==view);
 for(const tab of tabs)tab.setAttribute('aria-selected',String(tab.dataset.view===view));
 try{localStorage.setItem('ic-view',view);}catch{}
 history.replaceState(null,'','#'+view);
 frames[view].contentWindow?.postMessage({type:'ic-shown'},location.origin);
}
const toggle=()=>show(frames.city.classList.contains('off')?'city':'entries');
tabs.forEach(tab=>tab.onclick=()=>show(tab.dataset.view));
addEventListener('keydown',e=>{if(e.ctrlKey&&e.shiftKey&&e.code==='KeyS'){e.preventDefault();toggle();}});
addEventListener('message',e=>{
 if(e.origin!==location.origin)return;
 const msg=e.data||{};
 // A folder was chosen in one view: tell the other view to connect to it too.
 if(msg.type==='ic-folder')chrome.runtime.sendMessage({type:'nc-folder-app'}).catch(()=>{});
 if(msg.type==='ic-folder')for(const frame of Object.values(frames))if(frame.contentWindow!==e.source)frame.contentWindow?.postMessage({type:'ic-folder'},location.origin);
 if(msg.type==='ic-toggle')toggle();
 if(msg.type==='ic-show'){show(msg.view);if(msg.focus)setTimeout(()=>frames.city.contentWindow?.postMessage({type:'ic-focus',id:msg.focus},location.origin),1500);}
});
let start='entries';try{start=location.hash.slice(1)||localStorage.getItem('ic-view')||'entries';}catch{}
show(start);
// Messages from the side panel: follow its folder, or switch view and fly to a note.
const toFrames=msg=>{for(const f of Object.values(frames))f.contentWindow?.postMessage(msg,location.origin);};
chrome.runtime.onMessage.addListener(msg=>{
 if(msg?.type==='nc-folder')toFrames({type:'ic-folder'});
 if(msg?.type==='nc-show'){show(msg.view);if(msg.focus)setTimeout(()=>frames.city.contentWindow?.postMessage({type:'ic-focus',id:msg.focus},location.origin),400);}
});
const focusId=new URLSearchParams(location.search).get('focus');
if(focusId)setTimeout(()=>frames.city.contentWindow?.postMessage({type:'ic-focus',id:focusId},location.origin),2500);
