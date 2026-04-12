import { log } from '../../shared/utils.js';

export const TURN_CONTAINER_SELECTOR = 'section[data-turn-id], article';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 从 id 属性中提取 UUID（支持 image-{uuid} 等格式）
 * @param {Element} node - DOM 节点
 * @returns {string|null}
 */
function extractUuidFromIdAttribute(node) {
  const id = node.getAttribute('id');
  if (!id) return null;

  // 匹配 image-{uuid} 格式（图片生成消息）
  const imageMatch = id.match(/^image-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (imageMatch) {
    return imageMatch[1];
  }

  return null;
}

function escapeSelectorValue(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(value);
  }

  return String(value).replace(/["\\]/g, '\\$&');
}

function getUuidLikeTurnId(node) {
  const turnId = node?.getAttribute?.('data-turn-id');
  return turnId && UUID_REGEX.test(turnId) ? turnId : null;
}

function getInnerMessageNode(container) {
  if (!container?.querySelector) return null;

  return (
    container.querySelector('[data-message-author-role][data-message-id]') ||
    container.querySelector('[data-message-id]')
  );
}

export function isMessageContainer(node) {
  return !!(node?.matches && node.matches(TURN_CONTAINER_SELECTOR));
}

export function findMessageContainer(node) {
  if (!node) return null;

  if (isMessageContainer(node)) {
    return node;
  }

  if (node.closest) {
    return node.closest(TURN_CONTAINER_SELECTOR);
  }

  return null;
}

export function getAllMessageContainers(root = document) {
  if (!root?.querySelectorAll) return [];
  return Array.from(root.querySelectorAll(TURN_CONTAINER_SELECTOR));
}

export function isPlaceholderMessageId(messageId) {
  if (!messageId) return false;

  // ChatGPT streaming placeholders observed in the wild:
  // - placeholder-request-...
  // - request-placeholder-...
  return messageId.includes('placeholder');
}

/**
 * 从节点中提取 ID
  * @param {Element} node - DOM 节点
  * @returns {string|null}
 */
export function getUniqueMessageId(node, options = {}) {
  const { allowTurnIdFallback = true } = options;

  if (!node?.getAttribute) {
    return null;
  }

  if (node.hasAttribute('data-message-id')) {
    return node.getAttribute('data-message-id');
  }

  const container = findMessageContainer(node);
  if (container) {
    const innerMessage = getInnerMessageNode(container);
    if (innerMessage) {
      return innerMessage.getAttribute('data-message-id');
    }

    if (container.hasAttribute('data-message-id')) {
      return container.getAttribute('data-message-id');
    }

    const imageElement = container.querySelector?.('[id^="image-"]');
    if (imageElement) {
      const uuid = extractUuidFromIdAttribute(imageElement);
      if (uuid) return uuid;
    }

    if (allowTurnIdFallback) {
      const turnId = getUuidLikeTurnId(container);
      if (turnId) return turnId;
    }

    if (allowTurnIdFallback) {
      log('warn', 'MessageIdHelper', 'Message container missing data-message-id attribute');
    }
    return null;
  }

  const uuid = extractUuidFromIdAttribute(node);
  if (uuid) return uuid;

  return null;
}

/**
 * 提取稳定的消息 ID。
 * 仅接受真正的 data-message-id / image uuid，不接受 data-turn-id 兜底，
 * 以避免同一条 assistant 消息先被 turnId、后被 messageId 处理两次。
 * @param {Element} node - DOM 节点
 * @returns {string|null}
 */
export function getStableMessageId(node) {
  const messageId = getUniqueMessageId(node, { allowTurnIdFallback: false });
  return isPlaceholderMessageId(messageId) ? null : messageId;
}

/**
 * 从 DOM 节点提取最准确的 UUID
 * 优先级：内部 Message ID > 自身 Message ID > image-{uuid} > null
 * @param {Element} article - 消息元素
 * @returns {string|null} 消息唯一 ID
 */
export function resolveMessageId(article) {
  return getUniqueMessageId(article, { allowTurnIdFallback: true });
}

/**
 * 根据消息 ID 查找对应的 article 元素
 * 支持 data-message-id、data-turn-id 和 image-{uuid} 格式
 * @param {string} messageId - 消息 ID
 * @returns {Element|null} article 元素
 */
export function findArticleByMessageId(messageId) {
  if (!messageId) return null;

  const escapedId = escapeSelectorValue(messageId);

  const messageNode = document.querySelector(`[data-message-id="${escapedId}"]`);
  if (messageNode) {
    return findMessageContainer(messageNode) || messageNode;
  }

  let container = document.querySelector(`section[data-turn-id="${escapedId}"], article[data-turn-id="${escapedId}"]`);
  if (container) return container;

  container = document.querySelector(`section[data-message-id="${escapedId}"], article[data-message-id="${escapedId}"]`);
  if (container) return container;

  container = document.querySelector(`[id="image-${escapedId}"]`);
  if (container) {
    return findMessageContainer(container) || container;
  }

  const containers = getAllMessageContainers();
  for (const candidate of containers) {
    if (resolveMessageId(candidate) === messageId || candidate.getAttribute('data-turn-id') === messageId) {
      return candidate;
    }
  }

  return null;
}

/**
 * 检查消息 ID 是否存在于 DOM 中
 * @param {string} messageId - 消息 ID
 * @returns {boolean} 是否存在
 */
export function messageIdExistsInDOM(messageId) {
  if (!messageId) return false;

  const escapedId = escapeSelectorValue(messageId);

  // 检查 data-message-id
  if (document.querySelector(`[data-message-id="${escapedId}"]`)) {
    return true;
  }

  // 检查 data-turn-id
  if (document.querySelector(`[data-turn-id="${escapedId}"]`)) {
    return true;
  }

  // 检查 id="image-{uuid}" 格式
  if (document.querySelector(`[id="image-${escapedId}"]`)) {
    return true;
  }

  if (findArticleByMessageId(messageId)) {
    return true;
  }

  return false;
}
