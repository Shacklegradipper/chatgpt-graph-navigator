const SESSION_PORT_PREFIX = 'png-render:';
const WINDOW_EXTRA_WIDTH = 160;
const WINDOW_EXTRA_HEIGHT = 160;
const MAX_WINDOW_WIDTH = 2200;
const MAX_WINDOW_HEIGHT = 1600;
const MAX_VIEWPORT_HEIGHT = 1200;
const CONNECT_TIMEOUT_MS = 30000;
const RENDER_TIMEOUT_MS = 45000;
const SCROLL_TIMEOUT_MS = 15000;
const SCROLL_SETTLE_MS = 120;
const CAPTURE_MIN_INTERVAL_MS = 600;
const CAPTURE_RETRY_DELAYS_MS = [700, 1100, 1500];

const sessions = new Map();
let bridgeRegistered = false;
let captureQueue = Promise.resolve();
let lastCaptureStartedAt = 0;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function withTimeout(promise, timeoutMs, message) {
  let timerId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
  });
}

function createSession() {
  return {
    id: crypto.randomUUID(),
    port: null,
    windowId: null,
    tabId: null,
    rendererReady: createDeferred(),
    waiters: [],
    viewport: {
      innerWidth: 0,
      innerHeight: 0
    }
  };
}

function waitForSessionEvent(session, type, predicate = () => true, timeoutMs = RENDER_TIMEOUT_MS) {
  const deferred = createDeferred();
  const waiter = {
    type,
    predicate,
    resolve: deferred.resolve,
    reject: deferred.reject
  };
  session.waiters.push(waiter);

  const promise = withTimeout(deferred.promise, timeoutMs, `Timed out waiting for renderer event: ${type}`);
  return promise.finally(() => {
    const index = session.waiters.indexOf(waiter);
    if (index >= 0) {
      session.waiters.splice(index, 1);
    }
  });
}

function resolveSessionEvent(session, message) {
  if (!message || typeof message !== 'object') {
    return;
  }

  if (typeof message.innerWidth === 'number' && message.innerWidth > 0) {
    session.viewport.innerWidth = message.innerWidth;
  }
  if (typeof message.innerHeight === 'number' && message.innerHeight > 0) {
    session.viewport.innerHeight = message.innerHeight;
  }

  const matchingWaiters = session.waiters.filter(waiter => {
    return waiter.type === message.type && waiter.predicate(message);
  });

  matchingWaiters.forEach(waiter => waiter.resolve(message));
  session.waiters = session.waiters.filter(waiter => !matchingWaiters.includes(waiter));
}

function rejectSessionWaiters(session, error) {
  session.waiters.forEach(waiter => waiter.reject(error));
  session.waiters = [];
}

function ensureWindowBounds(width, height) {
  return {
    width: Math.max(420, Math.min(MAX_WINDOW_WIDTH, Math.ceil(width))),
    height: Math.max(320, Math.min(MAX_WINDOW_HEIGHT, Math.ceil(height)))
  };
}

async function createRendererWindow(session, firstAsset) {
  const popupUrl = chrome.runtime.getURL(`src/export-renderer/index.html?session=${encodeURIComponent(session.id)}`);
  const bounds = ensureWindowBounds(
    (firstAsset?.width || 960) + WINDOW_EXTRA_WIDTH,
    Math.min(firstAsset?.height || 720, MAX_VIEWPORT_HEIGHT) + WINDOW_EXTRA_HEIGHT
  );

  const createdWindow = await chrome.windows.create({
    url: popupUrl,
    type: 'popup',
    focused: false,
    width: bounds.width,
    height: bounds.height
  });

  session.windowId = createdWindow.id;
  session.tabId = createdWindow.tabs?.[0]?.id || null;
}

async function closeRendererWindow(session) {
  if (!session.windowId) {
    return;
  }

  try {
    await chrome.windows.remove(session.windowId);
  } catch {
    // Ignore cleanup errors when the user or browser already closed the window.
  }
}

async function ensureViewportWidth(session, assetWidth) {
  if (!session.windowId) {
    return;
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const currentWidth = session.viewport.innerWidth || 0;
    if (currentWidth >= assetWidth) {
      return;
    }

    const currentWindow = await chrome.windows.get(session.windowId);
    const nextBounds = ensureWindowBounds(
      currentWindow.width + (assetWidth - currentWidth),
      currentWindow.height
    );

    await chrome.windows.update(session.windowId, {
      width: nextBounds.width,
      height: nextBounds.height
    });

    await withTimeout(
      waitForSessionEvent(
        session,
        'viewport-updated',
        message => (message.innerWidth || 0) >= currentWidth,
        5000
      ).catch(() => null),
      5000,
      'Timed out while resizing renderer window.'
    ).catch(() => null);
  }
}

function isCaptureQuotaError(error) {
  const message = String(error?.message || error || '');
  return message.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND');
}

async function captureVisibleTabWithThrottle(windowId) {
  const elapsed = Date.now() - lastCaptureStartedAt;
  if (elapsed < CAPTURE_MIN_INTERVAL_MS) {
    await delay(CAPTURE_MIN_INTERVAL_MS - elapsed);
  }

  lastCaptureStartedAt = Date.now();
  return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
}

async function captureRendererSlice(windowId) {
  const queuedCapture = captureQueue
    .catch(() => undefined)
    .then(async () => {
      let lastError = null;

      for (let attempt = 0; attempt <= CAPTURE_RETRY_DELAYS_MS.length; attempt += 1) {
        try {
          return await captureVisibleTabWithThrottle(windowId);
        } catch (error) {
          lastError = error;
          if (!isCaptureQuotaError(error) || attempt === CAPTURE_RETRY_DELAYS_MS.length) {
            throw error;
          }

          await delay(CAPTURE_RETRY_DELAYS_MS[attempt]);
        }
      }

      throw lastError || new Error('Failed to capture renderer window.');
    });

  captureQueue = queuedCapture.then(
    () => undefined,
    () => undefined
  );

  return queuedCapture;
}

function setupPortForSession(session, port) {
  session.port = port;

  port.onMessage.addListener(message => {
    if (message?.type === 'renderer-ready') {
      session.rendererReady.resolve(message);
    }
    resolveSessionEvent(session, message);
  });

  port.onDisconnect.addListener(() => {
    session.port = null;
    const error = new Error('Renderer page disconnected unexpectedly.');
    session.rendererReady.reject(error);
    rejectSessionWaiters(session, error);
  });
}

export function setupPngCaptureBridge() {
  if (bridgeRegistered) {
    return;
  }

  chrome.runtime.onConnect.addListener(port => {
    if (!port?.name?.startsWith(SESSION_PORT_PREFIX)) {
      return;
    }

    const sessionId = port.name.substring(SESSION_PORT_PREFIX.length);
    const session = sessions.get(sessionId);
    if (!session) {
      port.disconnect();
      return;
    }

    setupPortForSession(session, port);
  });

  bridgeRegistered = true;
}

export async function captureHtmlAssetsAsPngDataUrls(assets) {
  if (!Array.isArray(assets) || assets.length === 0) {
    throw new Error('No HTML assets were provided for PNG export.');
  }

  const session = createSession();
  sessions.set(session.id, session);

  try {
    await createRendererWindow(session, assets[0]);
    await withTimeout(
      session.rendererReady.promise,
      CONNECT_TIMEOUT_MS,
      'Timed out waiting for the PNG renderer page to connect.'
    );

    const results = [];

    for (const asset of assets) {
      if (!session.port) {
        throw new Error('PNG renderer page is not connected.');
      }

      const logicalAssetWidth = Math.max(1, Math.ceil(asset.logicalWidth || asset.width || 1));
      const logicalAssetHeight = Math.max(1, Math.ceil(asset.logicalHeight || asset.height || 1));
      const captureScaleY = Math.max(1, (asset.height || logicalAssetHeight) / logicalAssetHeight);

      await ensureViewportWidth(session, asset.width || 1);
      session.port.postMessage({
        type: 'render-asset',
        asset
      });

      const readyMessage = await waitForSessionEvent(session, 'asset-ready');
      const viewportWidth = Math.max(
        1,
        Math.ceil(readyMessage.innerWidth || session.viewport.innerWidth || asset.width || 1)
      );
      const viewportHeight = Math.max(
        1,
        Math.ceil(readyMessage.innerHeight || session.viewport.innerHeight || 1)
      );

      for (let offsetY = 0; offsetY < asset.height; offsetY += viewportHeight) {
        const sliceHeight = Math.min(viewportHeight, asset.height - offsetY);
        const sliceBottom = offsetY + sliceHeight;
        const logicalSliceStart = Math.min(logicalAssetHeight, Math.round(offsetY / captureScaleY));
        const logicalSliceEnd =
          sliceBottom >= asset.height
            ? logicalAssetHeight
            : Math.min(logicalAssetHeight, Math.round(sliceBottom / captureScaleY));
        const logicalSliceHeight = Math.max(1, logicalSliceEnd - logicalSliceStart);

        session.port.postMessage({
          type: 'scroll-to',
          offsetY
        });

        const scrolledMessage = await waitForSessionEvent(
          session,
          'scrolled',
          message => message.offsetY === offsetY,
          SCROLL_TIMEOUT_MS
        );

        await delay(SCROLL_SETTLE_MS);

        const actualOffsetY = Math.max(0, Math.ceil(scrolledMessage.actualOffsetY || 0));
        const sourceOffsetY = Math.max(0, offsetY - actualOffsetY);

        results.push({
          dataUrl: await captureRendererSlice(session.windowId),
          width: asset.width,
          height: sliceHeight,
          logicalWidth: logicalAssetWidth,
          logicalHeight: logicalSliceHeight,
          sourceOffsetY,
          viewportWidth,
          viewportHeight
        });
      }
    }

    if (session.port) {
      session.port.postMessage({ type: 'shutdown' });
    }

    return results;
  } finally {
    await closeRendererWindow(session);
    sessions.delete(session.id);
  }
}
