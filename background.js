// Opens the Idea City page: Entries and Station together in one tab.
chrome.action.onClicked.addListener(()=>chrome.tabs.create({url:chrome.runtime.getURL('app.html')}));
