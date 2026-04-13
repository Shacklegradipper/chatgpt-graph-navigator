import JSZip from 'jszip';
import { convertToMarkdown, downloadBlob } from '../../backup-manager/export-utils.js';
import { extractConversationId } from '../../shared/utils.js';
import { fetchConversationWithRetry } from '../api/conversation.js';
import { loadToken, hasToken } from '../auth/token-manager.js';
import { extractMessageFromDOM } from '../extractors/message-extractor.js';
import { processContent } from '../parser/content-processor.js';
import { findArticleByMessageId, getAllMessageContainers } from '../utils/message-id-helper.js';

const MAX_SECTION_HEIGHT = 16000;
const EXPORT_PADDING = 24;
const EXPORT_GAP = 16;
const FALLBACK_RENDER_WIDTH = 920;
const MAX_PNG_CANVAS_DIMENSION = 8192;
const MAX_PNG_CANVAS_PIXELS = 24000000;
const MAX_PNG_SCALE = 2;
const PNG_RETRY_SHRINK_FACTOR = 0.8;
const MARKDOWN_PNG_PAGE_HEIGHT = 3800;
const MARKDOWN_PNG_OUTER_PADDING = 32;
const MARKDOWN_PNG_CARD_PADDING_X = 32;
const MARKDOWN_PNG_CARD_PADDING_Y = 28;
const MARKDOWN_PNG_BLOCK_GAP = 16;
const MARKDOWN_PNG_HEADER_GAP = 24;
const MARKDOWN_PNG_CARD_RADIUS = 24;
const MARKDOWN_FONT_FAMILY =
  '"SF Pro Display", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
const MARKDOWN_CODE_FONT_FAMILY = '"Cascadia Code", "SFMono-Regular", Consolas, monospace';
const ACTION_GROUP_SELECTORS = [
  '[role="group"][aria-label*="回复操作"]',
  '[role="group"][aria-label*="Response actions"]',
  '[role="group"][aria-label*="你的消息操作"]',
  '[role="group"][aria-label*="Your message actions"]'
];
const CSS_URL_PATTERN = /url\((['"]?)(.*?)\1\)/g;

function sanitizeFilename(name) {
  return String(name || 'Untitled')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 80);
}

function getConversationId(rawData, fallbackId = '') {
  return rawData?.conversation_id || rawData?.id || fallbackId || '';
}

function buildBaseName(rawData, fallbackId = '', suffix = '') {
  const title = sanitizeFilename(rawData?.title || 'Untitled');
  const conversationId = getConversationId(rawData, fallbackId);
  const idPrefix = conversationId ? conversationId.substring(0, 8) : 'conversation';
  return suffix ? `${title}_${idPrefix}_${suffix}` : `${title}_${idPrefix}`;
}

function createJsonBlob(value) {
  return new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json;charset=utf-8'
  });
}

function createTextBlob(value, mimeType = 'text/plain;charset=utf-8') {
  return new Blob([value], { type: mimeType });
}

async function ensureConversationAccess() {
  await loadToken();
  if (!hasToken()) {
    throw new Error('No token available. Please open ChatGPT and refresh the page.');
  }
}

async function loadConversationRaw(conversationId) {
  await ensureConversationAccess();
  return fetchConversationWithRetry(conversationId);
}

function findMessageNode(rawData, messageId) {
  if (!rawData?.mapping || !messageId) {
    return null;
  }

  if (rawData.mapping[messageId]) {
    return rawData.mapping[messageId];
  }

  return (
    Object.values(rawData.mapping).find(node => {
      return node?.message?.id === messageId || node?.id === messageId;
    }) || null
  );
}

function getMessageTextFromNode(node) {
  const content = processContent(node?.message?.content);
  return typeof content === 'string' ? content.trim() : '';
}

function buildFallbackMessageRecord(rawData, messageId) {
  const article = findArticleByMessageId(messageId);
  const domMessage = article ? extractMessageFromDOM(article) : null;

  if (!domMessage) {
    throw new Error('Message not found in the current conversation.');
  }

  return {
    export_type: 'single_message',
    conversation_id: getConversationId(rawData),
    conversation_title: rawData?.title || document.title || 'Untitled',
    message_id: domMessage.id || messageId,
    role: domMessage.role || 'assistant',
    model_slug: '',
    content: domMessage.content || '',
    raw_message: null,
    exported_at: new Date().toISOString()
  };
}

function buildMessageRecord(rawData, messageId) {
  const node = findMessageNode(rawData, messageId);
  const message = node?.message;

  if (!message) {
    return buildFallbackMessageRecord(rawData, messageId);
  }

  const content = getMessageTextFromNode(node);
  return {
    export_type: 'single_message',
    conversation_id: getConversationId(rawData),
    conversation_title: rawData?.title || 'Untitled',
    message_id: message.id || messageId,
    role: message.author?.role || 'assistant',
    model_slug: message.metadata?.model_slug || '',
    content,
    raw_message: message,
    exported_at: new Date().toISOString()
  };
}

function convertMessageToMarkdown(record) {
  const lines = [];
  lines.push(`# ${record.conversation_title || 'Untitled'}`);
  lines.push('');
  lines.push(
    `> Message ID: ${record.message_id} | Role: ${record.role || 'assistant'} | Model: ${record.model_slug || '-'}`
  );
  lines.push(`> Exported: ${record.exported_at}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(record.content || '');
  lines.push('');
  return lines.join('\n');
}

async function downloadZip(files, filename) {
  const zip = new JSZip();

  files.forEach(file => {
    zip.file(file.name, file.content);
  });

  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, filename);
}

function isTransparentColor(color) {
  return !color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)';
}

function resolveExportBackground() {
  const bodyBackground = window.getComputedStyle(document.body).backgroundColor;
  if (!isTransparentColor(bodyBackground)) {
    return bodyBackground;
  }

  const rootBackground = window.getComputedStyle(document.documentElement).backgroundColor;
  if (!isTransparentColor(rootBackground)) {
    return rootBackground;
  }

  return '#ffffff';
}

function copyComputedStyles(source, target) {
  if (!(source instanceof Element) || !(target instanceof Element)) {
    return;
  }

  const computed = window.getComputedStyle(source);
  for (const property of computed) {
    target.style.setProperty(
      property,
      computed.getPropertyValue(property),
      computed.getPropertyPriority(property)
    );
  }

  if (source instanceof HTMLInputElement || source instanceof HTMLTextAreaElement) {
    target.setAttribute('value', source.value);
  }

  if (source instanceof HTMLImageElement) {
    target.setAttribute('src', source.currentSrc || source.src || '');
    target.setAttribute('alt', source.alt || '');
  }
}

function removeActionGroups(root) {
  root.querySelectorAll(ACTION_GROUP_SELECTORS.join(',')).forEach(node => node.remove());
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read blob.'));
    reader.readAsDataURL(blob);
  });
}

function wait(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function waitForNextPaints(count = 2) {
  return new Promise(resolve => {
    const tick = remaining => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => tick(remaining - 1));
    };
    tick(count);
  });
}

function normalizeResourceUrl(url, baseUrl = document.baseURI) {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

async function fetchAsDataUrl(url) {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }

  const absoluteUrl = normalizeResourceUrl(url);
  const response = await fetch(absoluteUrl, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to fetch resource: ${absoluteUrl}`);
  }

  return blobToDataUrl(await response.blob());
}

async function inlineStyleUrls(source, target) {
  if (!(source instanceof Element) || !(target instanceof Element)) {
    return;
  }

  const computed = window.getComputedStyle(source);
  const updates = [];

  for (const property of computed) {
    const value = computed.getPropertyValue(property);
    if (!value || !value.includes('url(')) {
      continue;
    }

    updates.push(
      (async () => {
        let nextValue = value;
        const matches = [...value.matchAll(CSS_URL_PATTERN)];

        for (const match of matches) {
          const rawUrl = match[2];
          if (!rawUrl || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) {
            continue;
          }

          try {
            const dataUrl = await fetchAsDataUrl(rawUrl);
            nextValue = nextValue.replace(match[0], `url("${dataUrl}")`);
          } catch {
            continue;
          }
        }

        target.style.setProperty(
          property,
          nextValue,
          computed.getPropertyPriority(property)
        );
      })()
    );
  }

  await Promise.all(updates);
}

async function inlineImages(sourceRoot, cloneRoot) {
  const sourceImages = Array.from(sourceRoot.querySelectorAll('img'));
  const cloneImages = Array.from(cloneRoot.querySelectorAll('img'));

  await Promise.all(
    sourceImages.map(async (sourceImage, index) => {
      const cloneImage = cloneImages[index];
      if (!cloneImage) {
        return;
      }

      const src = sourceImage.currentSrc || sourceImage.src;
      if (!src || src.startsWith('data:')) {
        return;
      }

      try {
        cloneImage.setAttribute('src', await fetchAsDataUrl(src));
      } catch {
        cloneImage.setAttribute('src', src);
      }
    })
  );
}

async function createStyledClone(sourceNode) {
  const cloneNode = sourceNode.cloneNode(true);
  const sourceElements = [sourceNode, ...sourceNode.querySelectorAll('*')];
  const cloneElements = [cloneNode, ...cloneNode.querySelectorAll('*')];

  sourceElements.forEach((sourceElement, index) => {
    copyComputedStyles(sourceElement, cloneElements[index]);
  });

  await Promise.all(
    sourceElements.map((sourceElement, index) =>
      inlineStyleUrls(sourceElement, cloneElements[index])
    )
  );

  removeActionGroups(cloneNode);
  await inlineImages(sourceNode, cloneNode);
  return cloneNode;
}

function createSvgBlob(markup) {
  return new Blob([markup], {
    type: 'image/svg+xml;charset=utf-8'
  });
}

function createVisualAsset(blob, width, height) {
  return {
    blob,
    width: Math.max(1, Math.ceil(width || 1)),
    height: Math.max(1, Math.ceil(height || 1))
  };
}

function serializeWrapperToSvg(wrapper, width, height) {
  const serialized = new XMLSerializer().serializeToString(wrapper);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">${serialized}</foreignObject>` +
    `</svg>`
  );
}

async function renderWrapperToSvgAsset(wrapper, width, height) {
  return createVisualAsset(createSvgBlob(serializeWrapperToSvg(wrapper, width, height)), width, height);
}

async function measureDetachedWrapper(wrapper, width) {
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-100000px';
  host.style.top = '0';
  host.style.opacity = '0';
  host.style.pointerEvents = 'none';
  host.style.zIndex = '-1';
  host.style.overflow = 'visible';
  host.style.width = `${width}px`;
  host.appendChild(wrapper);
  document.body.appendChild(host);

  try {
    await waitForNextPaints(2);
    const rect = wrapper.getBoundingClientRect();
    return {
      width: Math.max(1, Math.ceil(rect.width || width)),
      height: Math.max(1, Math.ceil(rect.height || wrapper.scrollHeight || 1))
    };
  } finally {
    host.remove();
  }
}

function createBaseWrapper(width, height, background) {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.style.boxSizing = 'border-box';
  wrapper.style.background = background;
  wrapper.style.overflow = 'hidden';
  return wrapper;
}

async function renderElementAsStyledSvgAsset(element) {
  if (!element) {
    throw new Error('Nothing to export as image.');
  }

  const rect = element.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));
  const background = resolveExportBackground();
  const clone = await createStyledClone(element);
  const wrapper = createBaseWrapper(width, height, background);
  wrapper.appendChild(clone);

  return renderWrapperToSvgAsset(wrapper, width, height);
}

function getVisibleConversationSections() {
  const main = document.querySelector('main');
  if (!main) {
    return [];
  }

  return getAllMessageContainers(main).filter(section => {
    const rect = section.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

function splitConversationSections(sections) {
  const groups = [];
  let currentGroup = [];
  let currentHeight = EXPORT_PADDING * 2;

  sections.forEach(section => {
    const sectionHeight = Math.ceil(section.getBoundingClientRect().height);
    const nextHeight =
      currentHeight + sectionHeight + (currentGroup.length > 0 ? EXPORT_GAP : 0);

    if (currentGroup.length > 0 && nextHeight > MAX_SECTION_HEIGHT) {
      groups.push(currentGroup);
      currentGroup = [];
      currentHeight = EXPORT_PADDING * 2;
    }

    currentGroup.push(section);
    currentHeight += sectionHeight + (currentGroup.length > 1 ? EXPORT_GAP : 0);
  });

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

async function renderConversationSectionsAsStyledSvgAssets() {
  const sections = getVisibleConversationSections();
  if (sections.length === 0) {
    throw new Error('No conversation content found on the page.');
  }

  const sectionGroups = splitConversationSections(sections);
  const background = resolveExportBackground();
  const maxWidth = Math.max(...sections.map(section => Math.ceil(section.getBoundingClientRect().width)));
  const outputWidth = maxWidth + EXPORT_PADDING * 2;
  const assets = [];

  for (const group of sectionGroups) {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    wrapper.style.width = `${outputWidth}px`;
    wrapper.style.boxSizing = 'border-box';
    wrapper.style.padding = `${EXPORT_PADDING}px`;
    wrapper.style.background = background;
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = `${EXPORT_GAP}px`;

    let outputHeight = EXPORT_PADDING * 2;
    for (const section of group) {
      outputHeight += Math.ceil(section.getBoundingClientRect().height);
      wrapper.appendChild(await createStyledClone(section));
    }
    outputHeight += Math.max(0, group.length - 1) * EXPORT_GAP;

    assets.push(await renderWrapperToSvgAsset(wrapper, outputWidth, outputHeight));
  }

  return assets;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<span class="cg-export-md-image">[$1]($2)</span>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return html;
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim());
}

function isMarkdownTable(lines, index) {
  if (index + 1 >= lines.length) {
    return false;
  }

  const header = lines[index];
  const separator = lines[index + 1];
  return header.includes('|') && /^[\s|:-]+$/.test(separator.trim());
}

function renderMarkdownTable(lines, startIndex) {
  const headerCells = splitTableRow(lines[startIndex]);
  const bodyRows = [];
  let index = startIndex + 2;

  while (index < lines.length && lines[index].trim().includes('|')) {
    bodyRows.push(splitTableRow(lines[index]));
    index += 1;
  }

  const headerHtml = headerCells.map(cell => `<th>${renderInlineMarkdown(cell)}</th>`).join('');
  const bodyHtml = bodyRows
    .map(row => `<tr>${row.map(cell => `<td>${renderInlineMarkdown(cell)}</td>`).join('')}</tr>`)
    .join('');

  return {
    html: `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`,
    nextIndex: index
  };
}

function isHorizontalRule(line) {
  return /^(\s*)([-*_])(\s*\2){2,}\s*$/.test(line);
}

function isUnorderedList(line) {
  return /^[-*+]\s+/.test(line);
}

function isOrderedList(line) {
  return /^\d+\.\s+/.test(line);
}

function isHeading(line) {
  return /^#{1,6}\s+/.test(line);
}

function isBlockQuote(line) {
  return /^>\s?/.test(line);
}

function isBlockStart(lines, index) {
  const line = lines[index] || '';
  return (
    line.startsWith('```') ||
    isHeading(line) ||
    isBlockQuote(line) ||
    isHorizontalRule(line) ||
    isUnorderedList(line) ||
    isOrderedList(line) ||
    isMarkdownTable(lines, index)
  );
}

function renderMarkdownToHtml(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const fenceMatch = trimmed.match(/^```([\w-]+)?\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || '';
      index += 1;
      const codeLines = [];
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(
        `<pre><code${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}>${escapeHtml(
          codeLines.join('\n')
        )}</code></pre>`
      );
      continue;
    }

    if (isHeading(line)) {
      const [, hashes, text] = line.match(/^(#{1,6})\s+(.*)$/);
      const level = hashes.length;
      blocks.push(`<h${level}>${renderInlineMarkdown(text)}</h${level}>`);
      index += 1;
      continue;
    }

    if (isBlockQuote(line)) {
      const quoteLines = [];
      while (index < lines.length && isBlockQuote(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push(`<blockquote><p>${renderInlineMarkdown(quoteLines.join('<br/>'))}</p></blockquote>`);
      continue;
    }

    if (isHorizontalRule(line)) {
      blocks.push('<hr />');
      index += 1;
      continue;
    }

    if (isMarkdownTable(lines, index)) {
      const table = renderMarkdownTable(lines, index);
      blocks.push(table.html);
      index = table.nextIndex;
      continue;
    }

    if (isUnorderedList(line) || isOrderedList(line)) {
      const ordered = isOrderedList(line);
      const items = [];
      while (index < lines.length) {
        const current = lines[index];
        if (ordered ? !isOrderedList(current) : !isUnorderedList(current)) {
          break;
        }
        items.push(current.replace(ordered ? /^\d+\.\s+/ : /^[-*+]\s+/, ''));
        index += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      blocks.push(
        `<${tag}>${items.map(item => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${tag}>`
      );
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push(`<p>${renderInlineMarkdown(paragraphLines.join(' '))}</p>`);
  }

  return blocks.join('');
}

function createMarkdownWrapper({ title, subtitle = '', markdown }) {
  const background = resolveExportBackground();
  const wrapper = document.createElement('div');
  wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  wrapper.style.width = `${FALLBACK_RENDER_WIDTH}px`;
  wrapper.style.boxSizing = 'border-box';
  wrapper.style.padding = '32px';
  wrapper.style.background = background;
  wrapper.innerHTML = `
    <style>
      .cg-export-md-card {
        box-sizing: border-box;
        width: 100%;
        border-radius: 24px;
        padding: 28px 32px;
        background: #ffffff;
        color: #0f172a;
        border: 1px solid rgba(148, 163, 184, 0.22);
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.12);
        font-family: "SF Pro Display", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
        line-height: 1.7;
      }
      .cg-export-md-header h1 {
        margin: 0;
        font-size: 28px;
        line-height: 1.2;
      }
      .cg-export-md-header p {
        margin: 10px 0 0;
        color: #475569;
        font-size: 14px;
      }
      .cg-export-md-body {
        margin-top: 24px;
        font-size: 16px;
      }
      .cg-export-md-body h1,
      .cg-export-md-body h2,
      .cg-export-md-body h3,
      .cg-export-md-body h4,
      .cg-export-md-body h5,
      .cg-export-md-body h6 {
        margin: 1.3em 0 0.5em;
        line-height: 1.25;
      }
      .cg-export-md-body p,
      .cg-export-md-body ul,
      .cg-export-md-body ol,
      .cg-export-md-body blockquote,
      .cg-export-md-body table,
      .cg-export-md-body pre {
        margin: 0 0 1em;
      }
      .cg-export-md-body ul,
      .cg-export-md-body ol {
        padding-left: 1.5em;
      }
      .cg-export-md-body code {
        font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
        font-size: 0.92em;
        background: rgba(148, 163, 184, 0.16);
        padding: 0.15em 0.4em;
        border-radius: 6px;
      }
      .cg-export-md-body pre {
        overflow: hidden;
        padding: 16px 18px;
        border-radius: 16px;
        background: #0f172a;
        color: #e2e8f0;
      }
      .cg-export-md-body pre code {
        background: transparent;
        padding: 0;
        color: inherit;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .cg-export-md-body blockquote {
        padding: 0.75em 1em;
        border-left: 4px solid #38bdf8;
        background: rgba(56, 189, 248, 0.08);
        color: #0f172a;
        border-radius: 0 12px 12px 0;
      }
      .cg-export-md-body hr {
        border: 0;
        border-top: 1px solid rgba(148, 163, 184, 0.3);
      }
      .cg-export-md-body table {
        width: 100%;
        border-collapse: collapse;
        overflow: hidden;
        border-radius: 14px;
        border: 1px solid rgba(148, 163, 184, 0.3);
      }
      .cg-export-md-body th,
      .cg-export-md-body td {
        padding: 10px 12px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.18);
        text-align: left;
        vertical-align: top;
      }
      .cg-export-md-body th {
        background: rgba(241, 245, 249, 0.9);
        font-weight: 600;
      }
      .cg-export-md-body a {
        color: #0369a1;
        text-decoration: none;
      }
      .cg-export-md-body .cg-export-md-image {
        color: #64748b;
        font-style: italic;
      }
    </style>
    <div class="cg-export-md-card">
      <div class="cg-export-md-header">
        <h1>${escapeHtml(title || 'Untitled')}</h1>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
      </div>
      <div class="cg-export-md-body">${renderMarkdownToHtml(markdown)}</div>
    </div>
  `;
  return wrapper;
}

function buildConversationSubtitle(rawData) {
  const parts = [];
  if (rawData?.create_time) {
    parts.push(`Created: ${new Date(rawData.create_time * 1000).toLocaleString()}`);
  }
  if (rawData?.update_time) {
    parts.push(`Updated: ${new Date(rawData.update_time * 1000).toLocaleString()}`);
  }
  const conversationId = getConversationId(rawData);
  if (conversationId) {
    parts.push(`Conversation: ${conversationId}`);
  }
  return parts.join(' | ');
}

function buildMessageSubtitle(record) {
  return [
    `Role: ${record.role || 'assistant'}`,
    `Model: ${record.model_slug || '-'}`,
    `Message: ${record.message_id}`,
    `Exported: ${record.exported_at}`
  ].join(' | ');
}

function plainTextFromInlineMarkdown(text) {
  return String(text || '')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1 [$2]')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1');
}

function parseMarkdownBlocks(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const fenceMatch = trimmed.match(/^```([\w-]+)?\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || '';
      index += 1;
      const codeLines = [];
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({
        type: 'code',
        lang,
        text: codeLines.join('\n')
      });
      continue;
    }

    if (isHeading(line)) {
      const [, hashes, text] = line.match(/^(#{1,6})\s+(.*)$/);
      blocks.push({
        type: 'heading',
        level: hashes.length,
        text
      });
      index += 1;
      continue;
    }

    if (isBlockQuote(line)) {
      const quoteLines = [];
      while (index < lines.length && isBlockQuote(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({
        type: 'quote',
        text: quoteLines.join('\n')
      });
      continue;
    }

    if (isHorizontalRule(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (isMarkdownTable(lines, index)) {
      const headerCells = splitTableRow(lines[index]);
      const bodyRows = [];
      index += 2;
      while (index < lines.length && lines[index].trim().includes('|')) {
        bodyRows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push({
        type: 'table',
        headerCells,
        bodyRows
      });
      continue;
    }

    if (isUnorderedList(line) || isOrderedList(line)) {
      const ordered = isOrderedList(line);
      const items = [];
      while (index < lines.length) {
        const current = lines[index];
        if (ordered ? !isOrderedList(current) : !isUnorderedList(current)) {
          break;
        }
        items.push(current.replace(ordered ? /^\d+\.\s+/ : /^[-*+]\s+/, ''));
        index += 1;
      }
      blocks.push({
        type: 'list',
        ordered,
        items
      });
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push({
      type: 'paragraph',
      text: paragraphLines.join(' ')
    });
  }

  return blocks;
}

function getMarkdownPngStyles() {
  return {
    title: {
      font: `700 28px ${MARKDOWN_FONT_FAMILY}`,
      lineHeight: 36,
      color: '#0f172a'
    },
    subtitle: {
      font: `400 14px ${MARKDOWN_FONT_FAMILY}`,
      lineHeight: 20,
      color: '#475569'
    },
    paragraph: {
      font: `400 16px ${MARKDOWN_FONT_FAMILY}`,
      lineHeight: 28,
      color: '#0f172a'
    },
    heading: {
      1: { font: `700 28px ${MARKDOWN_FONT_FAMILY}`, lineHeight: 36, color: '#0f172a' },
      2: { font: `700 24px ${MARKDOWN_FONT_FAMILY}`, lineHeight: 32, color: '#0f172a' },
      3: { font: `700 20px ${MARKDOWN_FONT_FAMILY}`, lineHeight: 28, color: '#0f172a' },
      4: { font: `600 18px ${MARKDOWN_FONT_FAMILY}`, lineHeight: 26, color: '#0f172a' },
      5: { font: `600 16px ${MARKDOWN_FONT_FAMILY}`, lineHeight: 24, color: '#0f172a' },
      6: { font: `600 15px ${MARKDOWN_FONT_FAMILY}`, lineHeight: 22, color: '#0f172a' }
    },
    quote: {
      font: `400 16px ${MARKDOWN_FONT_FAMILY}`,
      lineHeight: 28,
      color: '#0f172a',
      backgroundColor: 'rgba(56, 189, 248, 0.08)',
      borderColor: '#38bdf8',
      borderWidth: 4,
      paddingX: 16,
      paddingY: 12,
      contentInsetLeft: 12,
      radius: 12
    },
    code: {
      font: `400 14px ${MARKDOWN_CODE_FONT_FAMILY}`,
      lineHeight: 22,
      color: '#e2e8f0',
      backgroundColor: '#0f172a',
      borderColor: 'rgba(15, 23, 42, 0.18)',
      borderWidth: 1,
      paddingX: 18,
      paddingY: 16,
      contentInsetLeft: 0,
      radius: 16
    },
    table: {
      font: `400 14px ${MARKDOWN_CODE_FONT_FAMILY}`,
      lineHeight: 22,
      color: '#0f172a',
      backgroundColor: '#f8fafc',
      borderColor: 'rgba(148, 163, 184, 0.3)',
      borderWidth: 1,
      paddingX: 16,
      paddingY: 14,
      contentInsetLeft: 0,
      radius: 14
    },
    card: {
      backgroundColor: '#ffffff',
      borderColor: 'rgba(148, 163, 184, 0.22)'
    },
    rule: {
      height: 18,
      color: 'rgba(148, 163, 184, 0.3)'
    }
  };
}

function createMeasureContext() {
  const canvas = document.createElement('canvas');
  return canvas.getContext('2d');
}

function wrapTextToWidth(context, text, maxWidth) {
  const source = String(text || '');
  if (!source) {
    return [''];
  }

  const lines = [];
  let currentLine = '';

  for (const char of source) {
    const trialLine = currentLine + char;
    if (currentLine && context.measureText(trialLine).width > maxWidth) {
      lines.push(currentLine.trimEnd());
      currentLine = char.trimStart();
      continue;
    }
    currentLine = trialLine;
  }

  if (currentLine || lines.length === 0) {
    lines.push(currentLine.trimEnd());
  }

  return lines;
}

function measureTextLines(context, text, font, maxWidth) {
  context.font = font;
  const rawLines = String(text || '').split('\n');
  const lines = [];

  rawLines.forEach(rawLine => {
    const wrapped = wrapTextToWidth(context, rawLine, maxWidth);
    if (wrapped.length === 0) {
      lines.push('');
      return;
    }
    lines.push(...wrapped);
  });

  return lines.length > 0 ? lines : [''];
}

function formatTableAsMonospaceText(block) {
  const rows = [block.headerCells || [], ...(block.bodyRows || [])].map(row =>
    row.map(cell => plainTextFromInlineMarkdown(cell || ''))
  );

  if (rows.length === 0) {
    return '';
  }

  const widths = rows[0].map((_, columnIndex) =>
    Math.max(...rows.map(row => (row[columnIndex] || '').length), 3)
  );

  const renderRow = row =>
    widths
      .map((width, columnIndex) => String(row[columnIndex] || '').padEnd(width, ' '))
      .join(' | ');

  const separator = widths.map(width => '-'.repeat(width)).join('-|-');
  return [renderRow(rows[0]), separator, ...rows.slice(1).map(renderRow)].join('\n');
}

function prepareMarkdownPngSegments(markdown, context, contentWidth, styles) {
  return parseMarkdownBlocks(markdown).map(block => {
    if (block.type === 'rule') {
      return {
        kind: 'rule',
        height: styles.rule.height,
        color: styles.rule.color
      };
    }

    if (block.type === 'heading') {
      const headingStyle = styles.heading[block.level] || styles.heading[6];
      const lines = measureTextLines(
        context,
        plainTextFromInlineMarkdown(block.text),
        headingStyle.font,
        contentWidth
      );
      return {
        kind: 'text',
        font: headingStyle.font,
        lineHeight: headingStyle.lineHeight,
        color: headingStyle.color,
        lines,
        blockHeight: lines.length * headingStyle.lineHeight
      };
    }

    if (block.type === 'quote') {
      const lines = measureTextLines(
        context,
        plainTextFromInlineMarkdown(block.text),
        styles.quote.font,
        contentWidth - styles.quote.paddingX * 2 - styles.quote.contentInsetLeft
      );
      return {
        kind: 'boxText',
        font: styles.quote.font,
        lineHeight: styles.quote.lineHeight,
        color: styles.quote.color,
        backgroundColor: styles.quote.backgroundColor,
        borderColor: styles.quote.borderColor,
        borderWidth: styles.quote.borderWidth,
        paddingX: styles.quote.paddingX,
        paddingY: styles.quote.paddingY,
        contentInsetLeft: styles.quote.contentInsetLeft,
        radius: styles.quote.radius,
        lines,
        blockHeight: styles.quote.paddingY * 2 + lines.length * styles.quote.lineHeight
      };
    }

    if (block.type === 'code') {
      const codeText = block.text || '';
      const lines = measureTextLines(
        context,
        codeText,
        styles.code.font,
        contentWidth - styles.code.paddingX * 2
      );
      return {
        kind: 'boxText',
        font: styles.code.font,
        lineHeight: styles.code.lineHeight,
        color: styles.code.color,
        backgroundColor: styles.code.backgroundColor,
        borderColor: styles.code.borderColor,
        borderWidth: styles.code.borderWidth,
        paddingX: styles.code.paddingX,
        paddingY: styles.code.paddingY,
        contentInsetLeft: styles.code.contentInsetLeft,
        radius: styles.code.radius,
        lines,
        blockHeight: styles.code.paddingY * 2 + lines.length * styles.code.lineHeight
      };
    }

    if (block.type === 'table') {
      const tableText = formatTableAsMonospaceText(block);
      const lines = measureTextLines(
        context,
        tableText,
        styles.table.font,
        contentWidth - styles.table.paddingX * 2
      );
      return {
        kind: 'boxText',
        font: styles.table.font,
        lineHeight: styles.table.lineHeight,
        color: styles.table.color,
        backgroundColor: styles.table.backgroundColor,
        borderColor: styles.table.borderColor,
        borderWidth: styles.table.borderWidth,
        paddingX: styles.table.paddingX,
        paddingY: styles.table.paddingY,
        contentInsetLeft: styles.table.contentInsetLeft,
        radius: styles.table.radius,
        lines,
        blockHeight: styles.table.paddingY * 2 + lines.length * styles.table.lineHeight
      };
    }

    const text =
      block.type === 'list'
        ? block.items
            .map((item, itemIndex) =>
              `${block.ordered ? `${itemIndex + 1}.` : '•'} ${plainTextFromInlineMarkdown(item)}`
            )
            .join('\n')
        : plainTextFromInlineMarkdown(block.text);

    const lines = measureTextLines(context, text, styles.paragraph.font, contentWidth);
    return {
      kind: 'text',
      font: styles.paragraph.font,
      lineHeight: styles.paragraph.lineHeight,
      color: styles.paragraph.color,
      lines,
      blockHeight: lines.length * styles.paragraph.lineHeight
    };
  });
}

function getMarkdownSegmentHeight(segment) {
  if (!segment) {
    return 0;
  }

  if (segment.kind === 'rule') {
    return segment.height || 0;
  }

  return segment.blockHeight || 0;
}

function splitSegmentForPage(segment, maxLines) {
  const lines = segment.lines || [];
  const nextLines = lines.slice(0, maxLines);
  return {
    part: {
      ...segment,
      lines: nextLines,
      blockHeight:
        segment.kind === 'boxText'
          ? segment.paddingY * 2 + nextLines.length * segment.lineHeight
          : nextLines.length * segment.lineHeight
    },
    remaining:
      lines.length > maxLines
        ? {
            ...segment,
            lines: lines.slice(maxLines),
            blockHeight:
              segment.kind === 'boxText'
                ? segment.paddingY * 2 + (lines.length - maxLines) * segment.lineHeight
                : (lines.length - maxLines) * segment.lineHeight
          }
        : null
  };
}

function paginateMarkdownPngSegments(segments, maxBodyHeight) {
  const pages = [];
  let currentPage = [];
  let usedHeight = 0;

  const startNewPage = () => {
    if (currentPage.length > 0) {
      pages.push(currentPage);
    }
    currentPage = [];
    usedHeight = 0;
  };

  for (const segment of segments) {
    let remainingSegment = segment;

    while (remainingSegment) {
      const gapBefore = currentPage.length > 0 ? MARKDOWN_PNG_BLOCK_GAP : 0;
      const availableHeight = maxBodyHeight - usedHeight - gapBefore;

      if (remainingSegment.kind === 'rule') {
        if (availableHeight < remainingSegment.height) {
          startNewPage();
          continue;
        }

        currentPage.push(remainingSegment);
        usedHeight += gapBefore + remainingSegment.height;
        remainingSegment = null;
        continue;
      }

      const boxExtraHeight =
        remainingSegment.kind === 'boxText' ? remainingSegment.paddingY * 2 : 0;
      const maxLines = Math.floor((availableHeight - boxExtraHeight) / remainingSegment.lineHeight);

      if (maxLines <= 0) {
        startNewPage();
        continue;
      }

      if (remainingSegment.lines.length <= maxLines) {
        currentPage.push(remainingSegment);
        usedHeight += gapBefore + remainingSegment.blockHeight;
        remainingSegment = null;
        continue;
      }

      const { part, remaining } = splitSegmentForPage(remainingSegment, maxLines);
      currentPage.push(part);
      usedHeight += gapBefore + part.blockHeight;
      remainingSegment = remaining;
      startNewPage();
    }
  }

  if (currentPage.length > 0 || pages.length === 0) {
    pages.push(currentPage);
  }

  return pages;
}

function buildMarkdownPageHeaderLayout(context, title, subtitle, pageIndex, totalPages, contentWidth, styles) {
  const titleLines = measureTextLines(context, title || 'Untitled', styles.title.font, contentWidth);
  const subtitleText =
    totalPages > 1
      ? [subtitle, `Page ${pageIndex + 1}/${totalPages}`].filter(Boolean).join(' | ')
      : subtitle || '';
  const subtitleLines = subtitleText
    ? measureTextLines(context, subtitleText, styles.subtitle.font, contentWidth)
    : [];
  const headerHeight =
    titleLines.length * styles.title.lineHeight +
    (subtitleLines.length > 0 ? 8 + subtitleLines.length * styles.subtitle.lineHeight : 0);

  return {
    titleLines,
    subtitleLines,
    height: headerHeight
  };
}

function addRoundedRectPath(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function renderMarkdownPageToCanvas(pageSegments, title, subtitle, pageIndex, totalPages) {
  const styles = getMarkdownPngStyles();
  const background = resolveExportBackground();
  const measureContext = createMeasureContext();
  if (!measureContext) {
    throw new Error('Canvas rendering is unavailable for PNG export.');
  }

  const width = FALLBACK_RENDER_WIDTH;
  const cardWidth = width - MARKDOWN_PNG_OUTER_PADDING * 2;
  const contentWidth = cardWidth - MARKDOWN_PNG_CARD_PADDING_X * 2;
  const header = buildMarkdownPageHeaderLayout(
    measureContext,
    title,
    subtitle,
    pageIndex,
    totalPages,
    contentWidth,
    styles
  );
  const bodyHeight = pageSegments.reduce((total, segment, index) => {
    return total + getMarkdownSegmentHeight(segment) + (index > 0 ? MARKDOWN_PNG_BLOCK_GAP : 0);
  }, 0);
  const bodyGap = pageSegments.length > 0 ? MARKDOWN_PNG_HEADER_GAP : 0;
  const height =
    MARKDOWN_PNG_OUTER_PADDING * 2 +
    MARKDOWN_PNG_CARD_PADDING_Y * 2 +
    header.height +
    bodyGap +
    bodyHeight;
  const scale = getRasterScale(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width * scale));
  canvas.height = Math.max(1, Math.ceil(height * scale));

  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    throw new Error('Canvas rendering is unavailable for PNG export.');
  }

  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const cardX = MARKDOWN_PNG_OUTER_PADDING;
  const cardY = MARKDOWN_PNG_OUTER_PADDING;
  const cardHeight = height - MARKDOWN_PNG_OUTER_PADDING * 2;

  addRoundedRectPath(context, cardX, cardY, cardWidth, cardHeight, MARKDOWN_PNG_CARD_RADIUS);
  context.fillStyle = styles.card.backgroundColor;
  context.fill();
  context.strokeStyle = styles.card.borderColor;
  context.lineWidth = 1;
  context.stroke();

  const contentX = cardX + MARKDOWN_PNG_CARD_PADDING_X;
  let cursorY = cardY + MARKDOWN_PNG_CARD_PADDING_Y;
  context.textBaseline = 'top';

  context.font = styles.title.font;
  context.fillStyle = styles.title.color;
  header.titleLines.forEach((line, index) => {
    context.fillText(line, contentX, cursorY + index * styles.title.lineHeight);
  });
  cursorY += header.titleLines.length * styles.title.lineHeight;

  if (header.subtitleLines.length > 0) {
    cursorY += 8;
    context.font = styles.subtitle.font;
    context.fillStyle = styles.subtitle.color;
    header.subtitleLines.forEach((line, index) => {
      context.fillText(line, contentX, cursorY + index * styles.subtitle.lineHeight);
    });
    cursorY += header.subtitleLines.length * styles.subtitle.lineHeight;
  }

  if (pageSegments.length > 0) {
    cursorY += MARKDOWN_PNG_HEADER_GAP;
  }

  pageSegments.forEach((segment, index) => {
    if (index > 0) {
      cursorY += MARKDOWN_PNG_BLOCK_GAP;
    }

    if (segment.kind === 'rule') {
      context.beginPath();
      context.strokeStyle = segment.color;
      context.lineWidth = 1;
      context.moveTo(contentX, cursorY + segment.height / 2);
      context.lineTo(contentX + contentWidth, cursorY + segment.height / 2);
      context.stroke();
      cursorY += segment.height;
      return;
    }

    if (segment.kind === 'boxText') {
      addRoundedRectPath(context, contentX, cursorY, contentWidth, segment.blockHeight, segment.radius);
      context.fillStyle = segment.backgroundColor;
      context.fill();
      context.strokeStyle = segment.borderColor;
      context.lineWidth = segment.borderWidth;
      context.stroke();

      if (segment.contentInsetLeft > 0) {
        context.fillStyle = segment.borderColor;
        context.fillRect(
          contentX,
          cursorY,
          Math.max(segment.borderWidth, 4),
          segment.blockHeight
        );
      }

      context.font = segment.font;
      context.fillStyle = segment.color;
      const textX = contentX + segment.paddingX + segment.contentInsetLeft;
      const textY = cursorY + segment.paddingY;
      segment.lines.forEach((line, lineIndex) => {
        context.fillText(line, textX, textY + lineIndex * segment.lineHeight);
      });
      cursorY += segment.blockHeight;
      return;
    }

    context.font = segment.font;
    context.fillStyle = segment.color;
    segment.lines.forEach((line, lineIndex) => {
      context.fillText(line, contentX, cursorY + lineIndex * segment.lineHeight);
    });
    cursorY += segment.blockHeight;
  });

  return {
    canvas,
    width,
    height
  };
}

async function renderMarkdownDocumentAsPngAssets({ title, subtitle, markdown }) {
  const styles = getMarkdownPngStyles();
  const context = createMeasureContext();
  if (!context) {
    throw new Error('Canvas rendering is unavailable for PNG export.');
  }

  const contentWidth =
    FALLBACK_RENDER_WIDTH -
    MARKDOWN_PNG_OUTER_PADDING * 2 -
    MARKDOWN_PNG_CARD_PADDING_X * 2;
  const preparedSegments = prepareMarkdownPngSegments(markdown, context, contentWidth, styles);
  const headerLayout = buildMarkdownPageHeaderLayout(
    context,
    title || 'Untitled',
    subtitle,
    0,
    1,
    contentWidth,
    styles
  );
  const maxBodyHeight =
    MARKDOWN_PNG_PAGE_HEIGHT -
    MARKDOWN_PNG_OUTER_PADDING * 2 -
    MARKDOWN_PNG_CARD_PADDING_Y * 2 -
    headerLayout.height -
    MARKDOWN_PNG_HEADER_GAP;
  const pages = paginateMarkdownPngSegments(preparedSegments, maxBodyHeight);
  const assets = [];

  for (let index = 0; index < pages.length; index += 1) {
    const pageCanvas = renderMarkdownPageToCanvas(
      pages[index],
      title || 'Untitled',
      subtitle,
      index,
      pages.length
    );
    assets.push(createVisualAsset(await canvasToPngBlob(pageCanvas.canvas), pageCanvas.width, pageCanvas.height));
  }

  return assets;
}

async function renderMarkdownDocumentAsSvgAsset({ title, subtitle, markdown }) {
  const wrapper = createMarkdownWrapper({ title, subtitle, markdown });
  const { width, height } = await measureDetachedWrapper(wrapper, FALLBACK_RENDER_WIDTH);
  wrapper.style.width = `${width}px`;
  return renderWrapperToSvgAsset(wrapper, width, height);
}

async function renderConversationAsSvgAssets(rawData) {
  try {
    return await renderConversationSectionsAsStyledSvgAssets();
  } catch (error) {
    console.warn('[Export] Styled DOM conversation export failed, falling back to Markdown SVG.', error);
    return [
      await renderMarkdownDocumentAsSvgAsset({
        title: rawData?.title || 'Untitled',
        subtitle: buildConversationSubtitle(rawData),
        markdown: convertToMarkdown(rawData)
      })
    ];
  }
}

async function renderMessageAsSvgAssets(article, record) {
  if (article) {
    try {
      return [await renderElementAsStyledSvgAsset(article)];
    } catch (error) {
      console.warn('[Export] Styled DOM answer export failed, falling back to Markdown SVG.', error);
    }
  }

  return [
    await renderMarkdownDocumentAsSvgAsset({
      title: record.conversation_title || 'Untitled',
      subtitle: buildMessageSubtitle(record),
      markdown: convertMessageToMarkdown(record)
    })
  ];
}

async function renderConversationAsPngAssets(rawData) {
  try {
    const svgAssets = await renderConversationAsSvgAssets(rawData);
    return await rasterizeSvgAssetsToPngAssets(svgAssets);
  } catch (error) {
    console.warn('[Export] Styled DOM conversation PNG export failed, falling back to Markdown PNG.', error);
    return renderMarkdownDocumentAsPngAssets({
      title: rawData?.title || 'Untitled',
      subtitle: buildConversationSubtitle(rawData),
      markdown: convertToMarkdown(rawData)
    });
  }
}

async function renderMessageAsPngAssets(article, record) {
  try {
    const svgAssets = await renderMessageAsSvgAssets(article, record);
    return await rasterizeSvgAssetsToPngAssets(svgAssets);
  } catch (error) {
    console.warn('[Export] Styled DOM answer PNG export failed, falling back to Markdown PNG.', error);
    return renderMarkdownDocumentAsPngAssets({
      title: record.conversation_title || 'Untitled',
      subtitle: buildMessageSubtitle(record),
      markdown: convertMessageToMarkdown(record)
    });
  }
}

function normalizeExportFormat(format) {
  return format === 'image' ? 'svg' : format;
}

function isVisualFormat(format) {
  return format === 'svg' || format === 'png';
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode exported image.'));
    };

    image.src = url;
  });
}

function encodeCanvasToPngBlobOnce(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(blob => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error('Failed to encode PNG image.'));
      }, 'image/png');
    } catch (error) {
      reject(error);
    }
  });
}

function isCanvasSecurityError(error) {
  const message = String(error?.message || error || '');
  return error?.name === 'SecurityError' || message.includes('Tainted canvases may not be exported');
}

function createResizedCanvas(sourceCanvas, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));

  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    throw new Error('Canvas rendering is unavailable for PNG export.');
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function getNextPngEncodingCanvas(canvas) {
  if (!canvas?.width || !canvas?.height) {
    return null;
  }

  const nextWidth = Math.max(1, Math.floor(canvas.width * PNG_RETRY_SHRINK_FACTOR));
  const nextHeight = Math.max(1, Math.floor(canvas.height * PNG_RETRY_SHRINK_FACTOR));

  if (nextWidth === canvas.width && nextHeight === canvas.height) {
    return null;
  }

  return createResizedCanvas(canvas, nextWidth, nextHeight);
}

async function canvasToPngBlob(canvas) {
  let candidateCanvas = canvas;
  let lastError = null;
  const attempts = [];

  while (candidateCanvas) {
    attempts.push(`${candidateCanvas.width}x${candidateCanvas.height}`);

    try {
      return await encodeCanvasToPngBlobOnce(candidateCanvas);
    } catch (error) {
      if (isCanvasSecurityError(error)) {
        throw error;
      }

      lastError = error;
      candidateCanvas = getNextPngEncodingCanvas(candidateCanvas);
    }
  }

  if (lastError?.message === 'Failed to encode PNG image.' && attempts.length > 0) {
    throw new Error(`Failed to encode PNG image. Attempts: ${attempts.join(' -> ')}`);
  }

  throw lastError || new Error('Failed to encode PNG image.');
}

function getRasterScale(width, height) {
  const requestedScale = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_PNG_SCALE);
  let scale = requestedScale;

  while (scale > 1) {
    const canvasWidth = Math.ceil(width * scale);
    const canvasHeight = Math.ceil(height * scale);
    if (
      canvasWidth <= MAX_PNG_CANVAS_DIMENSION &&
      canvasHeight <= MAX_PNG_CANVAS_DIMENSION &&
      canvasWidth * canvasHeight <= MAX_PNG_CANVAS_PIXELS
    ) {
      break;
    }

    scale = Math.max(1, scale - 0.25);
  }

  return scale;
}

function getMaxChunkHeight(width, scale) {
  const canvasWidth = Math.max(1, Math.ceil(width * scale));
  const maxCanvasHeightByArea = Math.max(1, Math.floor(MAX_PNG_CANVAS_PIXELS / canvasWidth));
  const maxCanvasHeight = Math.max(1, Math.min(MAX_PNG_CANVAS_DIMENSION, maxCanvasHeightByArea));
  return Math.max(1, Math.floor(maxCanvasHeight / scale));
}

async function rasterizeSvgAssetToPngAssets(svgAsset) {
  const image = await loadImageFromBlob(svgAsset.blob);
  const width = Math.max(1, Math.ceil(svgAsset.width || image.naturalWidth || 1));
  const height = Math.max(1, Math.ceil(svgAsset.height || image.naturalHeight || 1));
  const scale = getRasterScale(width, height);
  const chunkHeight = getMaxChunkHeight(width, scale);
  const assets = [];

  for (let offsetY = 0; offsetY < height; offsetY += chunkHeight) {
    const sliceHeight = Math.min(chunkHeight, height - offsetY);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width * scale));
    canvas.height = Math.max(1, Math.ceil(sliceHeight * scale));

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('Canvas rendering is unavailable for PNG export.');
    }

    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.clearRect(0, 0, width, sliceHeight);
    context.drawImage(image, 0, offsetY, width, sliceHeight, 0, 0, width, sliceHeight);

    assets.push(createVisualAsset(await canvasToPngBlob(canvas), width, sliceHeight));
  }

  return assets;
}

async function rasterizeSvgAssetsToPngAssets(svgAssets) {
  const pngAssets = [];

  for (const svgAsset of svgAssets) {
    pngAssets.push(...(await rasterizeSvgAssetToPngAssets(svgAsset)));
  }

  return pngAssets;
}

async function downloadSvgAssets(svgAssets, baseName) {
  if (svgAssets.length === 1) {
    downloadBlob(svgAssets[0].blob, `${baseName}.svg`);
    return;
  }

  await downloadZip(
    svgAssets.map((asset, index) => ({
      name: `${baseName}_part-${index + 1}.svg`,
      content: asset.blob
    })),
    `${baseName}_images.zip`
  );
}

async function downloadPngAssets(pngAssets, baseName) {
  if (pngAssets.length === 1) {
    downloadBlob(pngAssets[0].blob, `${baseName}.png`);
    return;
  }

  await downloadZip(
    pngAssets.map((asset, index) => ({
      name: `${baseName}_part-${index + 1}.png`,
      content: asset.blob
    })),
    `${baseName}_images.zip`
  );
}

async function exportConversationFiles(rawData, conversationId, format) {
  const normalizedFormat = normalizeExportFormat(format);
  const baseName = buildBaseName(rawData, conversationId);

  if (normalizedFormat === 'json') {
    downloadBlob(createJsonBlob(rawData), `${baseName}.json`);
    return;
  }

  if (normalizedFormat === 'md') {
    downloadBlob(createTextBlob(convertToMarkdown(rawData), 'text/markdown;charset=utf-8'), `${baseName}.md`);
    return;
  }

  if (normalizedFormat === 'both') {
    await downloadZip(
      [
        { name: `${baseName}.json`, content: JSON.stringify(rawData, null, 2) },
        { name: `${baseName}.md`, content: convertToMarkdown(rawData) }
      ],
      `${baseName}.zip`
    );
    return;
  }

  if (isVisualFormat(normalizedFormat)) {
    if (conversationId !== extractConversationId()) {
      throw new Error('Image export is only available for the conversation currently open on the page.');
    }

    if (normalizedFormat === 'svg') {
      const svgAssets = await renderConversationAsSvgAssets(rawData);
      await downloadSvgAssets(svgAssets, baseName);
      return;
    }

    const pngAssets = await renderConversationAsPngAssets(rawData);
    await downloadPngAssets(pngAssets, baseName);
    return;
  }

  throw new Error(`Unsupported export format: ${normalizedFormat}`);
}

async function exportMessageFiles(rawData, messageId, format) {
  const normalizedFormat = normalizeExportFormat(format);
  const record = buildMessageRecord(rawData, messageId);
  const conversationId = getConversationId(rawData);
  const baseName = buildBaseName(rawData, conversationId, `message_${record.message_id.substring(0, 8)}`);

  if (normalizedFormat === 'json') {
    downloadBlob(createJsonBlob(record), `${baseName}.json`);
    return;
  }

  if (normalizedFormat === 'md') {
    downloadBlob(
      createTextBlob(convertMessageToMarkdown(record), 'text/markdown;charset=utf-8'),
      `${baseName}.md`
    );
    return;
  }

  if (normalizedFormat === 'both') {
    await downloadZip(
      [
        { name: `${baseName}.json`, content: JSON.stringify(record, null, 2) },
        { name: `${baseName}.md`, content: convertMessageToMarkdown(record) }
      ],
      `${baseName}.zip`
    );
    return;
  }

  if (isVisualFormat(normalizedFormat)) {
    const article = findArticleByMessageId(messageId);

    if (normalizedFormat === 'svg') {
      const svgAssets = await renderMessageAsSvgAssets(article, record);
      await downloadSvgAssets(svgAssets, baseName);
      return;
    }

    const pngAssets = await renderMessageAsPngAssets(article, record);
    await downloadPngAssets(pngAssets, baseName);
    return;
  }

  throw new Error(`Unsupported export format: ${normalizedFormat}`);
}

export function canExportContextAsImage(context) {
  if (!context) {
    return false;
  }

  if (context.kind === 'assistantMessage') {
    return true;
  }

  if (context.kind === 'conversation') {
    return context.conversationId === extractConversationId();
  }

  return false;
}

export async function runExport(context, format) {
  if (!context?.conversationId) {
    throw new Error('Conversation context is missing.');
  }

  const rawData = await loadConversationRaw(context.conversationId);
  if (context.kind === 'assistantMessage') {
    if (!context.messageId) {
      throw new Error('Message context is missing.');
    }

    return exportMessageFiles(rawData, context.messageId, format);
  }

  return exportConversationFiles(rawData, context.conversationId, format);
}
