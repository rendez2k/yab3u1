// Runs on YAB3D pages. Passes printer requests from the page to the extension, which is
// allowed to reach a printer on the home network where a web page is not. The page and
// this script talk by window messages; nothing else on the page is read or changed.
(() => {
  const PAGE = 'yab3d-page', EXTENSION = 'yab3d-extension';
  const answer = (id, payload) => window.postMessage({ source: EXTENSION, id, ...payload }, location.origin);
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.source !== PAGE || typeof message.id !== 'string') return;
    if (message.type === 'ping') {
      answer(message.id, { ok: true, version: chrome.runtime.getManifest().version });
      return;
    }
    if (message.type !== 'printer') return;
    try {
      chrome.runtime.sendMessage({
        type: 'yab3d_printer', printer: message.printer, route: message.route,
        body: message.body ?? null, key: message.key || '',
      }, (reply) => {
        if (chrome.runtime.lastError) answer(message.id, { ok: false, error: chrome.runtime.lastError.message });
        else answer(message.id, reply || { ok: false, error: 'The extension did not answer.' });
      });
    } catch (error) {
      // The extension was reloaded or removed while this page stayed open.
      answer(message.id, { ok: false, error: 'The YAB3D extension was updated. Reload this page and try again.' });
    }
  });
})();
