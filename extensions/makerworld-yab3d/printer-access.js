// Asks once for permission to contact the one printer YAB3D named. Chrome only shows
// its permission prompt after a click on an extension page, which is why this page exists.
(() => {
  const requested = new URLSearchParams(location.search).get('printer');
  const origin = self.yab3dPrinterBridge.printerOrigin(requested);
  const button = document.getElementById('allow'), status = document.getElementById('status');
  document.getElementById('printer').textContent = origin || 'an address that is not a private printer address';
  if (!origin) { button.disabled = true; status.textContent = 'This address cannot be allowed. Go back to YAB3D and check the printer address.'; return; }
  const done = () => { button.disabled = true; status.textContent = 'Allowed. Go back to YAB3D and press Check U1 again. You can close this tab.'; };
  chrome.permissions.contains({ origins: [origin + '/*'] }, (has) => { if (has) done(); });
  button.addEventListener('click', () => {
    chrome.permissions.request({ origins: [origin + '/*'] }, (granted) => {
      if (chrome.runtime.lastError) { status.textContent = chrome.runtime.lastError.message; return; }
      if (granted) done(); else status.textContent = 'Not allowed. YAB3D cannot reach the printer until you allow it.';
    });
  });
})();
