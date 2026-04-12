/**
 * Service worker entrypoint.
 * Keep message receivers available immediately, then initialize slower services.
 */

import { setupMessageListener } from './messaging/message-handler.js';
import { db } from './database/db.js';
import { cache } from './cache/cache-manager.js';
import { initTokenCapture, getTokenStatus } from './auth/token-capture.js';

let listenersRegistered = false;
let sidePanelConfigured = false;
let servicesInitialized = false;
let initializePromise = null;

function registerRuntimeListeners() {
  if (!listenersRegistered) {
    setupMessageListener();
    listenersRegistered = true;
    console.log('[Background] Message listener registered');
  }

  if (!sidePanelConfigured) {
    setupSidePanel();
    sidePanelConfigured = true;
    console.log('[Background] Side panel configured');
  }
}

async function initializeServices() {
  if (servicesInitialized) {
    return;
  }

  if (initializePromise) {
    return initializePromise;
  }

  initializePromise = (async () => {
    console.log('[Background] Service Worker initializing...');

    try {
      await db.open();
      console.log('[Background] Database opened');

      const tokenCaptureReady = initTokenCapture();
      if (tokenCaptureReady) {
        console.log('[Background] Token auto-capture enabled');

        const tokenStatus = await getTokenStatus();
        if (tokenStatus.hasToken && !tokenStatus.isExpired) {
          console.log('[Background] Valid token found (source:', tokenStatus.source, ')');
        } else if (tokenStatus.hasToken && tokenStatus.isExpired) {
          console.log('[Background] Token expired, waiting for auto-capture');
        } else {
          console.log('[Background] No token found, waiting for auto-capture');
        }
      } else {
        console.warn('[Background] Token auto-capture not available');
      }

      servicesInitialized = true;
      console.log('[Background] Service Worker initialized successfully');
      console.log('[Background] Cache stats:', cache.getStats());
    } catch (error) {
      console.error('[Background] Initialization failed:', error);
    } finally {
      initializePromise = null;
    }
  })();

  return initializePromise;
}

function setupSidePanel() {
  chrome.action.onClicked.addListener(async (tab) => {
    console.log('[Background] Extension icon clicked, opening side panel');

    try {
      await chrome.sidePanel.open({ tabId: tab.id });
      console.log('[Background] Side panel opened');
    } catch (error) {
      console.error('[Background] Failed to open side panel:', error);
    }
  });

  chrome.sidePanel.setOptions({
    enabled: true
  });
}

function bootstrapBackground() {
  registerRuntimeListeners();
  void initializeServices();
}

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Background] Extension installed:', details.reason);

  if (details.reason === 'install') {
    console.log('[Background] First time installation');
  } else if (details.reason === 'update') {
    console.log('[Background] Extension updated');
  }

  bootstrapBackground();
});

self.addEventListener('activate', (event) => {
  console.log('[Background] Service Worker activated');
  registerRuntimeListeners();
  event.waitUntil(initializeServices());
});

bootstrapBackground();
