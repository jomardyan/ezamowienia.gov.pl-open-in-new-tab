chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'openTab' || !message.url) return;

  chrome.tabs.create({ url: message.url, active: Boolean(message.active) }, () => {
    sendResponse({ ok: true });
  });

  return true;
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
