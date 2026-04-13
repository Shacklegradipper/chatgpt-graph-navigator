const RENDER_SETTLE_MS = 80;
const SCROLL_SETTLE_MS = 80;

const root = document.getElementById('cg-export-root');
const sessionId = new URLSearchParams(window.location.search).get('session') || '';
const port = chrome.runtime.connect({
  name: `png-render:${sessionId}`
});

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function waitForImages(rootElement) {
  const images = Array.from(rootElement.querySelectorAll('img'));
  await Promise.all(
    images.map(image => {
      if (image.complete) {
        return Promise.resolve();
      }

      return new Promise(resolve => {
        const finish = () => {
          image.removeEventListener('load', finish);
          image.removeEventListener('error', finish);
          resolve();
        };

        image.addEventListener('load', finish, { once: true });
        image.addEventListener('error', finish, { once: true });
      });
    })
  );
}

async function waitForLayout(rootElement) {
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Ignore font readiness failures and continue with best-effort rendering.
    }
  }

  await waitForImages(rootElement);
  await nextFrame();
  await nextFrame();
  await delay(RENDER_SETTLE_MS);
}

function reportViewport(type, extra = {}) {
  port.postMessage({
    type,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    ...extra
  });
}

async function renderAsset(asset) {
  document.body.style.background = asset.background || '#ffffff';
  root.style.width = `${asset.width}px`;
  root.style.height = `${asset.height}px`;

  if (asset.kind === 'image') {
    root.innerHTML = '';
    const image = document.createElement('img');
    image.src = asset.src || '';
    image.alt = '';
    image.decoding = 'sync';
    image.style.display = 'block';
    image.style.width = `${asset.width}px`;
    image.style.height = `${asset.height}px`;
    image.style.margin = '0';
    image.style.padding = '0';
    root.appendChild(image);
  } else {
    root.innerHTML = asset.html || '';
  }

  await waitForLayout(root);
  window.scrollTo(0, 0);
  await nextFrame();

  reportViewport('asset-ready', {
    assetWidth: asset.width,
    assetHeight: asset.height
  });
}

port.onMessage.addListener(async message => {
  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'render-asset') {
    await renderAsset(message.asset || {});
    return;
  }

  if (message.type === 'scroll-to') {
    window.scrollTo(0, message.offsetY || 0);
    await nextFrame();
    await delay(SCROLL_SETTLE_MS);
    reportViewport('scrolled', {
      offsetY: message.offsetY || 0,
      actualOffsetY: window.scrollY || window.pageYOffset || 0
    });
    return;
  }

  if (message.type === 'shutdown') {
    window.close();
  }
});

window.addEventListener('resize', () => {
  reportViewport('viewport-updated');
});

reportViewport('renderer-ready');
