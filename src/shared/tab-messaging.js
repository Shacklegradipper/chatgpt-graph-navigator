function sendMessageOnce(tabId, message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

export function isMissingReceiverError(error) {
  return error?.message?.includes('Receiving end does not exist');
}

export async function ensureContentScript(tabId, delayMs = 300) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['dist/content.js']
  });

  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export async function sendMessageToTabWithFallback(tabId, message, options = {}) {
  const {
    injectOnMissingReceiver = true,
    retryDelayMs = 300
  } = options;

  try {
    return await sendMessageOnce(tabId, message);
  } catch (error) {
    if (!injectOnMissingReceiver || !isMissingReceiverError(error)) {
      throw error;
    }

    await ensureContentScript(tabId, retryDelayMs);
    return await sendMessageOnce(tabId, message);
  }
}
