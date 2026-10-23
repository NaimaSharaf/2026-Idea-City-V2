// Click the icon → Idea City side panel. Right-click the icon → open the viewer or the Station in a tab.
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(console.error);
chrome.runtime.onInstalled.addListener(()=>chrome.contextMenus.removeAll(()=>{
 chrome.contextMenus.create({id:'open-viewer',title:'Open Idea City viewer',contexts:['action']});
 chrome.contextMenus.create({id:'open-station',title:'Open Idea City Station',contexts:['action']});
}));
chrome.contextMenus.onClicked.addListener(info=>{
 if(info.menuItemId==='open-viewer')chrome.tabs.create({url:chrome.runtime.getURL('app.html#entries')});
 if(info.menuItemId==='open-station')chrome.tabs.create({url:chrome.runtime.getURL('app.html#city')});
});
