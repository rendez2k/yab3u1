// Background script — handles converted file downloads.
//
// Chrome/Chromium:
// Legacy Blob URL download handler. Current Chrome conversions use a named link.
//
// Firefox:
// Receives the finished binary data and creates a new Blob URL inside
// the extension background context, because Firefox blocks access to
// MakerWorld-context Blob URLs from downloads.download().

try { importScripts('printer-bridge.js'); } catch (error) { console.warn('[YAB3D] printer bridge unavailable:', error); }

const isFirefoxBackground =
  chrome.runtime.getURL('').startsWith('moz-extension://');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'u1_download') {
    chrome.downloads.download({
      url: msg.url,
      filename: msg.filename,
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        const error = chrome.runtime.lastError.message;

        console.warn('[U1 Extension] download failed:', error);
        sendResponse({ ok: false, error });
        return;
      }

      sendResponse({ ok: true, downloadId });
    });

    return true;
  }

  if (msg?.type === 'u1_download_firefox') {
    if (!isFirefoxBackground) {
      sendResponse({
        ok: false,
        error: 'Firefox download handler is unavailable',
      });
      return false;
    }

    (async () => {
      let objectUrl = null;

      try {
        if (!(msg.data instanceof ArrayBuffer)) {
          throw new TypeError(
            'Firefox download data is not an ArrayBuffer'
          );
        }

        const bytes = new Uint8Array(msg.data);

        if (bytes.byteLength === 0) {
          throw new Error('Firefox download data is empty');
        }

        const blob = new Blob(
          [bytes],
          { type: 'application/octet-stream' }
        );

        objectUrl = URL.createObjectURL(blob);

        const downloadId = await browser.downloads.download({
          url: objectUrl,
          filename: msg.filename,
          saveAs: false,
        });

        sendResponse({
          ok: true,
          downloadId,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        console.warn(
          '[U1 Extension] Firefox download failed:',
          message
        );

        sendResponse({
          ok: false,
          error: message,
        });
      } finally {
        if (objectUrl) {
          // Keep the URL alive long enough for Firefox's download manager
          // to open it before releasing the temporary Blob resource.
          setTimeout(() => {
            URL.revokeObjectURL(objectUrl);
          }, 60_000);
        }
      }
    })();

    return true;
  }

  if (msg?.type === 'yab3d_printer') {
    // Printer bridge: a YAB3D page asks for one of a few printer requests.
    const bridge = self.yab3dPrinterBridge;
    const page = sender?.origin || (sender?.url ? new URL(sender.url).origin : '');
    const refused = bridge.refusal({ page, printer: msg.printer, route: msg.route, body: msg.body });
    if (refused) { sendResponse({ ok: false, error: refused }); return false; }
    const printer = bridge.printerOrigin(msg.printer);
    (async () => {
      try {
        const allowed = await chrome.permissions.contains({ origins: [printer + '/*'] });
        if (!allowed) {
          // Chrome only asks for a permission after a click on an extension page.
          await chrome.tabs.create({ url: chrome.runtime.getURL('printer-access.html') + '?printer=' + encodeURIComponent(printer) });
          sendResponse({ ok: false, needsPermission: true, error: 'Allow the YAB3D extension to reach your printer in the tab that just opened, then press Check U1 again.' });
          return;
        }
        const call = async (route, body) => {
          const response = await fetch(printer + route, {
            method: body ? 'POST' : 'GET', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(8000),
            headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(msg.key ? { 'X-Api-Key': String(msg.key) } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}),
          });
          if (!response.ok) throw new Error('Printer request failed (' + response.status + '). Check the address and access settings.');
          return response.json();
        };
        if (msg.body) {
          // Read the printer again immediately before a write: it must be idle and the slot free.
          const info = await call('/server/info'), snapshot = await call(bridge.STATUS_ROUTE);
          if (!bridge.writable(info, snapshot, msg.body.script)) throw new Error('The printer is busy, unavailable or the slot has a Spoolman assignment. Nothing was sent.');
        }
        sendResponse({ ok: true, data: await call(msg.route, msg.body) });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  }

  return false;
});