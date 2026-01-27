/**
 * ChatGPT Graph Extension - Popup Script
 */

import { initI18n, i18n, SUPPORTED_LOCALES, getUserLocale, setUserLocale } from '../shared/i18n.js';

// 创建语言切换器
function createLanguageSwitcher() {
  const container = document.getElementById('language-switcher-container');
  if (!container) return;

  // 如果已经存在，先清空
  container.innerHTML = '';

  const switcher = document.createElement('div');
  switcher.className = 'language-switcher';

  const label = document.createElement('label');
  label.textContent = i18n('languageLabel');
  label.htmlFor = 'language-select';

  const select = document.createElement('select');
  select.id = 'language-select';
  select.className = 'language-select';

  // 添加语言选项
  Object.entries(SUPPORTED_LOCALES).forEach(([code, name]) => {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = name;
    select.appendChild(option);
  });

  // 设置当前语言
  getUserLocale().then(locale => {
    select.value = locale;
  });

  // 监听变化
  select.addEventListener('change', async (e) => {
    const newLocale = e.target.value;
    await setUserLocale(newLocale);
    await initI18n(newLocale);

    // 重新加载状态以更新界面文本
    loadStatusContent();
  });

  switcher.appendChild(label);
  switcher.appendChild(select);
  container.appendChild(switcher);
}

async function loadStatus() {
  // 初始化国际化
  await initI18n();

  // 创建语言切换器（只创建一次）
  createLanguageSwitcher();

  // 加载内容
  loadStatusContent();
}

async function loadStatusContent() {
  const container = document.getElementById('content');

  try {
    // 获取存储的 token
    const result = await chrome.storage.local.get(['accessToken', 'tokenTimestamp']);

    const hasToken = !!result.accessToken;
    const tokenAge = result.tokenTimestamp ? Date.now() - result.tokenTimestamp : null;
    const tokenAgeMinutes = tokenAge ? Math.floor(tokenAge / 1000 / 60) : null;
    const tokenAgeHours = tokenAge ? Math.floor(tokenAge / 1000 / 60 / 60) : null;
    const tokenExpired = tokenAge && tokenAge > 24 * 60 * 60 * 1000; // 24小时

    let statusHtml = '';

    // 如果没有 token，显示设置引导
    if (!hasToken) {
      statusHtml = `
        <div class="status">
          <div class="status-item">
            <span class="status-label">${i18n('statusLabel')}</span>
            <span class="status-value error">${i18n('notConfigured')}</span>
          </div>
        </div>

        <div class="help">
          <p>
            <strong>${i18n('welcomeTitle')}</strong><br><br>
            ${i18n('welcomeMessage')}
          </p>
        </div>

        <div class="actions">
          <button class="primary" id="setup-btn">
            ${i18n('setupTokenBtn')}
          </button>
        </div>
      `;

      container.innerHTML = statusHtml;

      document.getElementById('setup-btn').addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('src/setup/index.html') });
      });

      return;
    }

    // 状态区域
    statusHtml += `
      <div class="status">
        <div class="status-item">
          <span class="status-label">${i18n('authenticationLabel')}</span>
          <span class="status-value ${hasToken ? (tokenExpired ? 'warning' : 'success') : 'error'}">
            ${hasToken ? (tokenExpired ? i18n('tokenExpired') : i18n('authenticated')) : i18n('notConfigured')}
          </span>
        </div>
        <div class="status-item">
          <span class="status-label">${i18n('extensionLabel')}</span>
          <span class="status-value success">${i18n('statusActive')}</span>
        </div>
      </div>
    `;

    // Token 信息
    const tokenPreview = result.accessToken.substring(0, 40) + '...';
    const tokenLength = result.accessToken.length;
    const timeDisplay = tokenAgeHours > 0
      ? i18n(tokenAgeHours > 1 ? 'hoursAgo' : 'hourAgo', tokenAgeHours.toString())
      : i18n(tokenAgeMinutes > 1 ? 'minutesAgo' : 'minuteAgo', tokenAgeMinutes.toString());

    statusHtml += `
      <div class="token-info">
        <h3>${i18n('tokenInfoTitle')}</h3>
        <div class="token-preview">${tokenPreview}</div>
        <div class="token-time">
          ${i18n('tokenLength', tokenLength.toString())}<br>
          ${i18n('tokenCaptured', timeDisplay)}
          ${tokenExpired ? `<br><strong style="color: #dc2626;">${i18n('tokenExpiredWarning')}</strong>` : ''}
        </div>
      </div>
    `;

    // 操作按钮
    statusHtml += `
      <div class="actions" style="margin-bottom: 8px;">
        <button class="primary" id="open-sidepanel-btn" style="flex: 1;">
          📊 ${i18n('openGraphBtn') || 'Open Graph View'}
        </button>
      </div>
      <div class="actions">
        <button class="secondary" id="update-btn">
          ${tokenExpired ? i18n('updateTokenBtn') : i18n('changeTokenBtn')}
        </button>
        <button class="secondary" id="clear-btn">
          ${i18n('clearTokenBtn')}
        </button>
      </div>
    `;

    // 帮助信息
    if (tokenExpired) {
      statusHtml += `
        <div class="help">
          <p>${i18n('tokenExpiredHelp')}</p>
        </div>
      `;
    } else {
      statusHtml += `
        <div class="help">
          <p>${i18n('readyHelp')}</p>
        </div>
      `;
    }

    container.innerHTML = statusHtml;

    // 绑定事件
    const openSidePanelBtn = document.getElementById('open-sidepanel-btn');
    const updateBtn = document.getElementById('update-btn');
    const clearBtn = document.getElementById('clear-btn');

    if (openSidePanelBtn) {
      openSidePanelBtn.addEventListener('click', async () => {
        try {
          // 获取当前标签页
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab) {
            // 打开侧边栏
            await chrome.sidePanel.open({ tabId: tab.id });
            // 关闭 popup
            window.close();
          }
        } catch (error) {
          console.error('Failed to open side panel:', error);
          alert('Failed to open side panel: ' + error.message);
        }
      });
    }

    if (updateBtn) {
      updateBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('src/setup/index.html') });
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (confirm(i18n('confirmClearToken'))) {
          await chrome.storage.local.remove(['accessToken', 'tokenTimestamp']);
          loadStatusContent(); // 重新加载内容
        }
      });
    }

  } catch (error) {
    console.error('Failed to load status:', error);
    container.innerHTML = `
      <div class="status">
        <div class="status-item">
          <span class="status-label">${i18n('errorLabel')}</span>
          <span class="status-value error">${i18n('errorLoadFailed')}</span>
        </div>
      </div>
      <div class="help">
        <p><strong>${i18n('errorLabel')}:</strong> ${error.message}</p>
      </div>
    `;
  }
}

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', loadStatus);
