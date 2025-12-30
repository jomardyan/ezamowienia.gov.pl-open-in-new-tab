const BASE_URL = new URL('https://ezamowienia.gov.pl/mp-client/tenders/');
const TRUSTED_ORIGIN = BASE_URL.origin;
const TRUSTED_PATH_PREFIX = BASE_URL.pathname;
const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL('')).origin;

function getSenderUrl(sender) {
  if (!sender) return '';
  return sender.url || (sender.tab && sender.tab.url) || '';
}

function isTrustedSender(sender) {
  if (!sender || sender.id !== chrome.runtime.id) return false;
  const senderUrl = getSenderUrl(sender);
  if (!senderUrl) return false;
  if (senderUrl.startsWith(EXTENSION_ORIGIN)) return true;
  try {
    const url = new URL(senderUrl);
    return url.origin === TRUSTED_ORIGIN;
  } catch (error) {
    return false;
  }
}

function isTrustedOfferUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const url = new URL(rawUrl);
    if (url.origin !== TRUSTED_ORIGIN) return false;
    if (url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    if (!url.pathname.startsWith(TRUSTED_PATH_PREFIX)) return false;
    return true;
  } catch (error) {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object' || message.type !== 'openTab') return;
  if (!isTrustedSender(sender)) {
    sendResponse({ ok: false, error: 'untrusted_sender' });
    return;
  }

  const url = typeof message.url === 'string' ? message.url : '';
  if (!isTrustedOfferUrl(url)) {
    sendResponse({ ok: false, error: 'invalid_url' });
    return;
  }

  chrome.tabs.create({ url, active: Boolean(message.active) }, () => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: 'tabs_error' });
      return;
    }
    sendResponse({ ok: true });
  });

  return true;
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
