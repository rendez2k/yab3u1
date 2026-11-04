(() => {
if (window.__u1DownloadBridgeInstalled) return;
window.__u1DownloadBridgeInstalled = true;
// Runs in MAIN world — wraps window.fetch to intercept MakerWorld's own
// authenticated f3mf download requests so we inherit auth for free.

console.log('[U1 injected] loaded');

window.__u1ModeActive = false;
window.__u1Capturing  = false;

// Observe MakerWorld's own download requests without changing their responses.
// Installed at document_start, before page clients can cache fetch/XHR methods.
let u1CaptureGeneration = 0;
const u1NativeFetch = window.fetch;
const u1XhrUrls = new WeakMap();

function u1RequestUrl(input) {
  try {
    return new URL(typeof input === 'string' ? input : input?.url || String(input), location.href);
  } catch { return null; }
}

function u1IsDownloadRequest(input) {
  const url = u1RequestUrl(input);
  return url && ['makerworld.com', 'makerworld.com.cn'].includes(url.hostname) &&
    /\/f3mf(?:\/|$)/.test(url.pathname);
}

function u1IsCurrentCapture(generation) {
  return window.__u1Capturing && generation === u1CaptureGeneration;
}

function u1CaptureFailure(generation, error) {
  if (!u1IsCurrentCapture(generation)) return;
  window.__u1Capturing = false;
  window.dispatchEvent(new CustomEvent('__u1_3mf_err', { detail: String(error) }));
}

function u1CaptureStatus(generation, status) {
  if (!u1IsCurrentCapture(generation)) return false;
  if (status === 418 || status === 429) {
    // MakerWorld owns the verification UI and any retry. Never solve or bypass it.
    window.dispatchEvent(new CustomEvent('__u1_capture_waiting', { detail: status }));
    return false;
  }
  if (status < 200 || status >= 300) {
    u1CaptureFailure(generation, `HTTP ${status}`);
    return false;
  }
  return true;
}

function u1DeliverCapture(generation, buffer, requestUrl, transport) {
  if (!u1IsCurrentCapture(generation)) return;
  const blobUrl = URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' }));
  window.__u1Capturing = false;
  console.log('[U1 injected] captured download via', transport);
  window.dispatchEvent(new CustomEvent('__u1_3mf', {
    detail: JSON.stringify({ blobUrl, requestUrl }),
  }));
}

window.fetch = function(input) {
  const generation = window.__u1Capturing && u1IsDownloadRequest(input) ? u1CaptureGeneration : null;
  const responsePromise = u1NativeFetch.apply(this, arguments);
  if (generation !== null) {
    responsePromise.then(async response => {
      if (!u1CaptureStatus(generation, response.status)) return;
      const buffer = await response.clone().arrayBuffer();
      u1DeliverCapture(generation, buffer, u1RequestUrl(input).href, 'fetch');
    }).catch(error => u1CaptureFailure(generation, error.message));
  }
  return responsePromise;
};

const u1NativeXhrOpen = XMLHttpRequest.prototype.open;
const u1NativeXhrSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function(method, url) {
  const result = u1NativeXhrOpen.apply(this, arguments);
  u1XhrUrls.set(this, u1RequestUrl(url)?.href || '');
  return result;
};
XMLHttpRequest.prototype.send = function() {
  const requestUrl = u1XhrUrls.get(this);
  if (window.__u1Capturing && u1IsDownloadRequest(requestUrl)) {
    const generation = u1CaptureGeneration;
    const onEnd = async () => {
      try {
        if (!u1CaptureStatus(generation, this.status)) return;
        let body;
        if (this.responseType === 'blob') body = await this.response.arrayBuffer();
        else if (this.responseType === 'arraybuffer') body = this.response;
        else if (this.responseType === 'json') body = JSON.stringify(this.response);
        else body = this.responseText;
        u1DeliverCapture(generation, body, requestUrl, 'XMLHttpRequest');
      } catch (error) { u1CaptureFailure(generation, error.message); }
    };
    this.addEventListener('loadend', onEnd, { once: true });
    try { return u1NativeXhrSend.apply(this, arguments); }
    catch (error) { this.removeEventListener('loadend', onEnd); throw error; }
  }
  return u1NativeXhrSend.apply(this, arguments);
};

// A final file link is also usable if the site's API or transport has changed.
// Only intercept explicitly named 3MF files during a requested conversion.
document.addEventListener('click', event => {
  if (!window.__u1Capturing) return;
  const link = event.target?.closest?.('a[download]');
  if (!link || !/\.3mf$/i.test(link.download)) return;
  const url = u1RequestUrl(link.href);
  if (!url || !['blob:', 'https:'].includes(url.protocol)) return;
  const generation = u1CaptureGeneration;
  event.preventDefault();
  event.stopImmediatePropagation();
  u1NativeFetch.call(window, link.href).then(async response => {
    if (!u1CaptureStatus(generation, response.status)) return;
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('The downloaded 3MF is not a ZIP archive');
    u1DeliverCapture(generation, buffer, '', 'file link');
  }).catch(error => u1CaptureFailure(generation, error.message));
}, true);


const U1_WINDOW_MESSAGE_SOURCE =
  'makerworld-to-snapmaker-u1';

function sendU1MainWorldReady() {
  window.postMessage(
    {
      source:
        U1_WINDOW_MESSAGE_SOURCE,

      action:
        'main-world-ready',
    },
    '*'
  );
}

function sendU1PrinterSwiperRepairResult(
  wrapperId,
  result,
  details = {}
) {
  window.postMessage(
    {
      source:
        U1_WINDOW_MESSAGE_SOURCE,

      action:
        'printer-swiper-repair-result',

      wrapperId:
        String(wrapperId || ''),

      result:
        String(result || 'unknown'),

      details: {
        swiperFound:
          details.swiperFound === true,

        slideToAvailable:
          details.slideToAvailable === true,

        navigationUpdated:
          details.navigationUpdated === true,

        message:
          String(details.message || ''),
      },
    },
    '*'
  );
}

function sendU1PrinterSwiperRefreshResult(
  wrapperId,
  result,
  details = {}
) {
  window.postMessage(
    {
      source:
        U1_WINDOW_MESSAGE_SOURCE,

      action:
        'printer-swiper-refresh-result',

      wrapperId:
        String(wrapperId || ''),

      result:
        String(result || 'unknown'),

      details: {
        swiperFound:
          details.swiperFound === true,

        navigationFound:
          details.navigationFound === true,

        navigationUpdated:
          details.navigationUpdated === true,

        message:
          String(details.message || ''),
      },
    },
    '*'
  );
}

function refreshU1PrinterSwiper(
  wrapperId
) {
  const normalizedId =
    String(wrapperId || '');

  // Only accept the short internal identifiers generated by content.js.
  // Never accept arbitrary selectors or executable values from page messages.
  if (
    !/^u1-[a-z0-9-]{1,80}$/i.test(
      normalizedId
    )
  ) {
    return;
  }

  const wrapper =
    Array.from(
      document.querySelectorAll(
        '[data-u1-refresh-id]'
      )
    ).find(
      candidate =>
        candidate.dataset.u1RefreshId ===
        normalizedId
    );

  if (!wrapper) {
    sendU1PrinterSwiperRefreshResult(
      normalizedId,
      'wrapper-not-found'
    );

    return;
  }

  const swiperElement =
    wrapper.closest('.swiper');

  const swiper =
    swiperElement?.swiper;

  if (
    !swiper ||
    typeof swiper.update !== 'function'
  ) {
    // Some MakerWorld/Swiper versions may not expose the Swiper instance
    // directly on the DOM element. Request MakerWorld's responsive layout
    // recalculation as a safe fallback.
    window.dispatchEvent(
      new Event('resize')
    );

    sendU1PrinterSwiperRefreshResult(
      normalizedId,
      'resize-fallback-dispatched',
      {
        swiperFound:
          false,
      }
    );

    return;
  }

  let navigationFound =
    false;

  let navigationUpdated =
    false;

  function updateSwiper() {
    swiper.update();

    if (
      typeof swiper.updateSlides ===
      'function'
    ) {
      swiper.updateSlides();
    }

    if (
      typeof swiper.updateSlidesClasses ===
      'function'
    ) {
      swiper.updateSlidesClasses();
    }

    navigationFound =
      Boolean(swiper.navigation);

    if (
      typeof swiper.navigation?.update ===
      'function'
    ) {
      swiper.navigation.update();

      navigationUpdated =
        true;
    }
  }

  try {
    // Update immediately so the new U1 slide becomes part of Swiper's
    // internal slide collection.
    updateSwiper();

    // Update once more after the browser has processed the changed layout.
    // This is especially important when the U1 slide creates the first
    // horizontal overflow in an otherwise completely visible printer list.
    requestAnimationFrame(
      () => {
        try {
          updateSwiper();

          sendU1PrinterSwiperRefreshResult(
            normalizedId,
            'updated',
            {
              swiperFound:
                true,

              navigationFound,
              navigationUpdated,
            }
          );
        } catch (error) {
          console.warn(
            '[U1 injected] Delayed printer Swiper refresh failed:',
            error
          );

          sendU1PrinterSwiperRefreshResult(
            normalizedId,
            'update-failed',
            {
              swiperFound:
                true,

              navigationFound,
              navigationUpdated,

              message:
                error instanceof Error
                  ? error.message
                  : String(error),
            }
          );
        }
      }
    );
  } catch (error) {
    console.warn(
      '[U1 injected] Printer Swiper refresh failed:',
      error
    );

    sendU1PrinterSwiperRefreshResult(
      normalizedId,
      'update-failed',
      {
        swiperFound:
          true,

        navigationFound,
        navigationUpdated,

        message:
          error instanceof Error
            ? error.message
            : String(error),
      }
    );
  }
}

function repairU1PrinterSwiperVisibility(
  wrapperId
) {
  const normalizedId =
    String(wrapperId || '');

  if (
    !/^u1-[a-z0-9-]{1,80}$/i.test(
      normalizedId
    )
  ) {
    return;
  }

  const wrapper =
    Array.from(
      document.querySelectorAll(
        '[data-u1-repair-id]'
      )
    ).find(
      candidate =>
        candidate.dataset.u1RepairId ===
        normalizedId
    );

  if (!wrapper) {
    sendU1PrinterSwiperRepairResult(
      normalizedId,
      'wrapper-not-found'
    );

    return;
  }

  const swiperElement =
    wrapper.closest('.swiper');

  const swiper =
    swiperElement?.swiper;

  if (
    !swiper ||
    typeof swiper.update !== 'function'
  ) {
    window.dispatchEvent(
      new Event('resize')
    );

    sendU1PrinterSwiperRepairResult(
      normalizedId,
      'resize-fallback-dispatched',
      {
        swiperFound:
          false,

        slideToAvailable:
          false,
      }
    );

    return;
  }

  const slideToAvailable =
    typeof swiper.slideTo ===
    'function';

  let navigationUpdated =
    false;

  function updateNavigation() {
    if (
      typeof swiper.navigation?.update ===
      'function'
    ) {
      swiper.navigation.update();

      navigationUpdated =
        true;
    }
  }

  function performRepair() {
    swiper.update();

    if (
      typeof swiper.updateSlides ===
      'function'
    ) {
      swiper.updateSlides();
    }

    if (slideToAvailable) {
      // The U1 option is inserted directly after MakerWorld's first filter.
      // Move to the logical start only after content.js has confirmed that the
      // option exists but is outside the visible Swiper viewport.
      swiper.slideTo(
        0,
        0,
        false
      );
    }

    swiper.update();

    if (
      typeof swiper.updateSlidesClasses ===
      'function'
    ) {
      swiper.updateSlidesClasses();
    }

    updateNavigation();
  }

  try {
    performRepair();

    requestAnimationFrame(
      () => {
        try {
          performRepair();

          sendU1PrinterSwiperRepairResult(
            normalizedId,
            slideToAvailable
              ? 'repaired-to-start'
              : 'updated-without-slide-to',
            {
              swiperFound:
                true,

              slideToAvailable,
              navigationUpdated,
            }
          );
        } catch (error) {
          console.warn(
            '[U1 injected] Delayed printer Swiper visibility repair failed:',
            error
          );

          sendU1PrinterSwiperRepairResult(
            normalizedId,
            'repair-failed',
            {
              swiperFound:
                true,

              slideToAvailable,
              navigationUpdated,

              message:
                error instanceof Error
                  ? error.message
                  : String(error),
            }
          );
        }
      }
    );
  } catch (error) {
    console.warn(
      '[U1 injected] Printer Swiper visibility repair failed:',
      error
    );

    sendU1PrinterSwiperRepairResult(
      normalizedId,
      'repair-failed',
      {
        swiperFound:
          true,

        slideToAvailable,
        navigationUpdated,

        message:
          error instanceof Error
            ? error.message
            : String(error),
      }
    );
  }
}

window.addEventListener('message', (e) => {
  if (
    e.source !== window ||
    !e.data
  ) {
    return;
  }

  if (
    e.data.source ===
      U1_WINDOW_MESSAGE_SOURCE &&
    e.data.action ===
      'main-world-status-request'
  ) {
    sendU1MainWorldReady();

    return;
  }

  if (
    e.data.source ===
      U1_WINDOW_MESSAGE_SOURCE &&
    e.data.action ===
      'refresh-printer-swiper'
  ) {
    refreshU1PrinterSwiper(
      e.data.wrapperId
    );

    return;
  }

  if (
    e.data.source ===
      U1_WINDOW_MESSAGE_SOURCE &&
    e.data.action ===
      'repair-printer-swiper-visibility'
  ) {
    repairU1PrinterSwiperVisibility(
      e.data.wrapperId
    );

    return;
  }

  if (
    e.data.__u1SetMode !== undefined
  ) {
    console.log(
      '[U1 injected] mode set to',
      e.data.__u1SetMode
    );

    window.__u1ModeActive =
      e.data.__u1SetMode;
  }

  if (e.data.__u1StartCapture) {
    u1CaptureGeneration++;
    console.log(
      '[U1 injected] capture armed'
    );

    window.__u1Capturing =
      true;
    window.dispatchEvent(new CustomEvent('__u1_capture_armed'));
  }

  if (e.data.__u1CancelCapture) {
    u1CaptureGeneration++;
    window.__u1Capturing =
      false;
  }
});

// Notify content.js after the Main World message listener is fully ready.
//
// content.js also actively requests this status, so the handshake works
// regardless of which script finishes loading first.
sendU1MainWorldReady();


})();
