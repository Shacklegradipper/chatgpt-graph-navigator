/**
 * Export utilities for backup manager
 * Handles JSON→Markdown conversion, ZIP packaging, and file downloads
 */

import JSZip from 'jszip';

const PDF_PAGE_WIDTH = 794;
const PDF_PAGE_HEIGHT = 1123;
const PDF_MARGIN = 56;
const PDF_RENDER_SCALE = 2;
const PDF_FONT_FAMILY = '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
const PDF_MONO_FONT_FAMILY = '"Cascadia Code", Consolas, monospace';
const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Walk the mapping tree from root to leaf following children[0]
 * to produce an ordered list of messages.
 * @param {Object} mapping - ChatGPT conversation mapping
 * @returns {Array<{role: string, content: string, model_slug?: string}>}
 */
function walkMapping(mapping) {
  const messages = [];
  if (!mapping) return messages;

  // Find root node (one with no parent or parent not in mapping)
  let rootId = null;
  for (const [id, node] of Object.entries(mapping)) {
    if (!node.parent || !mapping[node.parent]) {
      rootId = id;
      break;
    }
  }

  if (!rootId) return messages;

  // Walk down following children[0]
  let currentId = rootId;
  while (currentId) {
    const node = mapping[currentId];
    if (!node) break;

    const msg = node.message;
    if (msg && msg.author?.role && msg.content) {
      // Skip system messages, weight === 0, and visually hidden messages
      if (
        msg.author.role !== 'system' &&
        msg.weight !== 0 &&
        !msg.metadata?.is_visually_hidden_from_conversation
      ) {
        const parts = msg.content.parts || [];
        const text = parts
          .filter(p => typeof p === 'string')
          .join('\n');

        if (text.trim()) {
          messages.push({
            role: msg.author.role,
            content: text,
            model_slug: msg.metadata?.model_slug || ''
          });
        }
      }
    }

    // Follow first child
    const children = node.children || [];
    currentId = children.length > 0 ? children[0] : null;
  }

  return messages;
}

/**
 * Convert raw ChatGPT conversation data to Markdown
 * @param {Object} rawData - Raw API JSON
 * @returns {string} Markdown text
 */
export function convertToMarkdown(rawData) {
  const title = rawData.title || 'Untitled';
  const createDate = rawData.create_time
    ? new Date(rawData.create_time * 1000).toISOString().split('T')[0]
    : '—';
  const updateDate = rawData.update_time
    ? new Date(rawData.update_time * 1000).toISOString().split('T')[0]
    : '—';

  const messages = walkMapping(rawData.mapping);

  // Detect model from first assistant message
  const modelSlug = messages.find(m => m.role === 'assistant')?.model_slug || '—';

  const lines = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`> Created: ${createDate} | Updated: ${updateDate} | Model: ${modelSlug}`);
  lines.push('');

  for (const msg of messages) {
    lines.push('---');
    lines.push('');
    const roleLabel = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
    lines.push(`### ${roleLabel}`);
    lines.push('');
    lines.push(msg.content);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Sanitize a string for use as a filename
 * @param {string} name
 * @returns {string}
 */
function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').substring(0, 80);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderInlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<span>$1 [$2]</span>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return html;
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

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim());
}

function isMarkdownTable(lines, index) {
  if (index + 1 >= lines.length) return false;
  return lines[index].includes('|') && /^[\s|:-]+$/.test(lines[index + 1].trim());
}

function isHeading(line) {
  return /^#{1,6}\s+/.test(line);
}

function isBlockQuote(line) {
  return /^>\s?/.test(line);
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
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', lang, text: codeLines.join('\n') });
      continue;
    }

    if (isHeading(line)) {
      const [, hashes, text] = line.match(/^(#{1,6})\s+(.*)$/);
      blocks.push({ type: 'heading', level: hashes.length, text });
      index += 1;
      continue;
    }

    if (isBlockQuote(line)) {
      const quoteLines = [];
      while (index < lines.length && isBlockQuote(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', text: quoteLines.join('\n') });
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
      blocks.push({ type: 'table', headerCells, bodyRows });
      continue;
    }

    if (isUnorderedList(line) || isOrderedList(line)) {
      const ordered = isOrderedList(line);
      const items = [];
      while (index < lines.length) {
        const current = lines[index];
        if (ordered ? !isOrderedList(current) : !isUnorderedList(current)) break;
        items.push(current.replace(ordered ? /^\d+\.\s+/ : /^[-*+]\s+/, ''));
        index += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') });
  }

  return blocks;
}

export function renderMarkdownToHtml(markdown) {
  const blocks = parseMarkdownBlocks(markdown);
  return blocks.map(block => {
    if (block.type === 'heading') {
      const level = Math.min(Math.max(block.level, 1), 6);
      return `<h${level}>${renderInlineMarkdown(block.text)}</h${level}>`;
    }
    if (block.type === 'quote') {
      return `<blockquote>${block.text
        .split('\n')
        .map(line => `<p>${renderInlineMarkdown(line)}</p>`)
        .join('')}</blockquote>`;
    }
    if (block.type === 'rule') {
      return '<hr />';
    }
    if (block.type === 'code') {
      return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
    }
    if (block.type === 'table') {
      const head = block.headerCells.map(cell => `<th>${renderInlineMarkdown(cell)}</th>`).join('');
      const rows = block.bodyRows
        .map(row => `<tr>${row.map(cell => `<td>${renderInlineMarkdown(cell)}</td>`).join('')}</tr>`)
        .join('');
      return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    }
    if (block.type === 'list') {
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag}>${block.items.map(item => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${tag}>`;
    }
    return `<p>${renderInlineMarkdown(block.text)}</p>`;
  }).join('\n');
}

function buildDocumentSubtitle(rawData) {
  const parts = [];
  if (rawData?.create_time) {
    parts.push(`Created: ${new Date(rawData.create_time * 1000).toLocaleString()}`);
  }
  if (rawData?.update_time) {
    parts.push(`Updated: ${new Date(rawData.update_time * 1000).toLocaleString()}`);
  }
  if (rawData?.conversation_id || rawData?.id) {
    parts.push(`Conversation: ${rawData.conversation_id || rawData.id}`);
  }
  return parts.join(' | ');
}

function wrapCanvasText(context, text, maxWidth) {
  const source = String(text || '');
  if (!source) return [''];

  const result = [];
  for (const rawLine of source.split('\n')) {
    let current = '';
    for (const char of rawLine) {
      const next = current + char;
      if (current && context.measureText(next).width > maxWidth) {
        result.push(current.trimEnd());
        current = char.trimStart();
      } else {
        current = next;
      }
    }
    result.push(current.trimEnd());
  }

  return result.length ? result : [''];
}

function formatTableAsText(block) {
  const rows = [block.headerCells || [], ...(block.bodyRows || [])].map(row =>
    row.map(cell => plainTextFromInlineMarkdown(cell))
  );
  if (!rows.length) return '';

  const widths = rows[0].map((_, index) =>
    Math.max(...rows.map(row => String(row[index] || '').length), 3)
  );
  const rowText = row => widths.map((width, index) => String(row[index] || '').padEnd(width, ' ')).join(' | ');
  return [rowText(rows[0]), widths.map(width => '-'.repeat(width)).join('-|-'), ...rows.slice(1).map(rowText)].join('\n');
}

function createPdfCanvasPage() {
  const canvas = document.createElement('canvas');
  canvas.width = PDF_PAGE_WIDTH * PDF_RENDER_SCALE;
  canvas.height = PDF_PAGE_HEIGHT * PDF_RENDER_SCALE;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    throw new Error('Canvas rendering is unavailable for PDF export.');
  }
  context.setTransform(PDF_RENDER_SCALE, 0, 0, PDF_RENDER_SCALE, 0, 0);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT);
  return { canvas, context };
}

function renderMarkdownToPdfCanvases({ title = 'Untitled', subtitle = '', markdown = '' }) {
  const canvases = [];
  let page = createPdfCanvasPage();
  let y = PDF_MARGIN;
  const contentWidth = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
  const bottom = PDF_PAGE_HEIGHT - PDF_MARGIN;

  const commitPage = () => {
    canvases.push(page.canvas);
    page = createPdfCanvasPage();
    y = PDF_MARGIN;
  };

  const ensureSpace = (height) => {
    if (y + height > bottom && y > PDF_MARGIN) {
      commitPage();
    }
  };

  const drawTextLines = (lines, {
    font,
    color = '#111827',
    lineHeight,
    before = 0,
    after = 10,
    indent = 0
  }) => {
    ensureSpace(before + lineHeight);
    y += before;
    page.context.font = font;
    page.context.fillStyle = color;
    page.context.textBaseline = 'top';
    for (const line of lines) {
      ensureSpace(lineHeight);
      page.context.fillText(line, PDF_MARGIN + indent, y);
      y += lineHeight;
    }
    y += after;
  };

  const drawBoxLines = (lines, {
    font,
    color,
    background,
    lineHeight,
    paddingX = 14,
    paddingY = 10,
    after = 12
  }) => {
    let index = 0;
    page.context.font = font;
    while (index < lines.length) {
      const maxLines = Math.max(1, Math.floor((bottom - y - paddingY * 2) / lineHeight));
      if (maxLines < 2 && y > PDF_MARGIN) {
        commitPage();
        continue;
      }
      const chunk = lines.slice(index, index + maxLines);
      const boxHeight = paddingY * 2 + chunk.length * lineHeight;
      ensureSpace(boxHeight);
      page.context.fillStyle = background;
      page.context.fillRect(PDF_MARGIN, y, contentWidth, boxHeight);
      page.context.font = font;
      page.context.fillStyle = color;
      page.context.textBaseline = 'top';
      chunk.forEach((line, lineIndex) => {
        page.context.fillText(line, PDF_MARGIN + paddingX, y + paddingY + lineIndex * lineHeight);
      });
      y += boxHeight + after;
      index += chunk.length;
    }
  };

  const drawRule = () => {
    ensureSpace(24);
    page.context.strokeStyle = '#d1d5db';
    page.context.lineWidth = 1;
    page.context.beginPath();
    page.context.moveTo(PDF_MARGIN, y + 8);
    page.context.lineTo(PDF_PAGE_WIDTH - PDF_MARGIN, y + 8);
    page.context.stroke();
    y += 24;
  };

  page.context.font = `700 28px ${PDF_FONT_FAMILY}`;
  drawTextLines(wrapCanvasText(page.context, title, contentWidth), {
    font: `700 28px ${PDF_FONT_FAMILY}`,
    lineHeight: 36,
    after: subtitle ? 4 : 18
  });

  if (subtitle) {
    page.context.font = `400 12px ${PDF_FONT_FAMILY}`;
    drawTextLines(wrapCanvasText(page.context, subtitle, contentWidth), {
      font: `400 12px ${PDF_FONT_FAMILY}`,
      color: '#6b7280',
      lineHeight: 18,
      after: 20
    });
  }

  for (const block of parseMarkdownBlocks(markdown)) {
    if (block.type === 'heading') {
      const size = block.level === 1 ? 24 : block.level === 2 ? 21 : block.level === 3 ? 18 : 16;
      page.context.font = `700 ${size}px ${PDF_FONT_FAMILY}`;
      drawTextLines(wrapCanvasText(page.context, plainTextFromInlineMarkdown(block.text), contentWidth), {
        font: `700 ${size}px ${PDF_FONT_FAMILY}`,
        lineHeight: Math.ceil(size * 1.35),
        before: 8,
        after: 8
      });
    } else if (block.type === 'quote') {
      page.context.font = `400 14px ${PDF_FONT_FAMILY}`;
      drawBoxLines(wrapCanvasText(page.context, plainTextFromInlineMarkdown(block.text), contentWidth - 28), {
        font: `400 14px ${PDF_FONT_FAMILY}`,
        color: '#374151',
        background: '#f3f4f6',
        lineHeight: 22
      });
    } else if (block.type === 'code') {
      page.context.font = `400 12px ${PDF_MONO_FONT_FAMILY}`;
      drawBoxLines(wrapCanvasText(page.context, block.text, contentWidth - 28), {
        font: `400 12px ${PDF_MONO_FONT_FAMILY}`,
        color: '#f9fafb',
        background: '#111827',
        lineHeight: 18
      });
    } else if (block.type === 'table') {
      page.context.font = `400 11px ${PDF_MONO_FONT_FAMILY}`;
      drawBoxLines(wrapCanvasText(page.context, formatTableAsText(block), contentWidth - 28), {
        font: `400 11px ${PDF_MONO_FONT_FAMILY}`,
        color: '#111827',
        background: '#f9fafb',
        lineHeight: 17
      });
    } else if (block.type === 'list') {
      page.context.font = `400 14px ${PDF_FONT_FAMILY}`;
      block.items.forEach((item, index) => {
        const prefix = block.ordered ? `${index + 1}. ` : '- ';
        drawTextLines(
          wrapCanvasText(page.context, `${prefix}${plainTextFromInlineMarkdown(item)}`, contentWidth - 20),
          {
            font: `400 14px ${PDF_FONT_FAMILY}`,
            lineHeight: 22,
            after: 2,
            indent: 12
          }
        );
      });
      y += 8;
    } else if (block.type === 'rule') {
      drawRule();
    } else {
      page.context.font = `400 14px ${PDF_FONT_FAMILY}`;
      drawTextLines(wrapCanvasText(page.context, plainTextFromInlineMarkdown(block.text), contentWidth), {
        font: `400 14px ${PDF_FONT_FAMILY}`,
        lineHeight: 22,
        after: 10
      });
    }
  }

  canvases.push(page.canvas);
  return canvases;
}

function dataUrlToBytes(dataUrl) {
  const base64 = String(dataUrl).split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function buildPdfFromJpegPages(pages) {
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [0];
  let byteOffset = 0;

  const push = value => {
    const chunk = typeof value === 'string' ? encoder.encode(value) : value;
    chunks.push(chunk);
    byteOffset += chunk.byteLength;
  };

  const objectCount = 2 + pages.length * 3;
  const addObject = (id, writer) => {
    offsets[id] = byteOffset;
    push(`${id} 0 obj\n`);
    writer();
    push('\nendobj\n');
  };

  push('%PDF-1.4\n');
  addObject(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  addObject(2, () => {
    const kids = pages.map((_, index) => `${3 + index * 3} 0 R`).join(' ');
    push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  });

  pages.forEach((page, index) => {
    const pageId = 3 + index * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const imageName = `Im${index + 1}`;
    const content = `q\n${PDF_PAGE_WIDTH} 0 0 ${PDF_PAGE_HEIGHT} 0 0 cm\n/${imageName} Do\nQ`;

    addObject(pageId, () => {
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] ` +
          `/Resources << /XObject << /${imageName} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`
      );
    });
    addObject(contentId, () => {
      push(`<< /Length ${encoder.encode(content).byteLength} >>\nstream\n${content}\nendstream`);
    });
    addObject(imageId, () => {
      push(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.byteLength} >>\nstream\n`
      );
      push(page.bytes);
      push('\nendstream');
    });
  });

  const xrefOffset = byteOffset;
  push(`xref\n0 ${objectCount + 1}\n`);
  push('0000000000 65535 f \n');
  for (let id = 1; id <= objectCount; id += 1) {
    push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return new Blob(chunks, { type: 'application/pdf' });
}

export async function createPdfBlobFromMarkdown(markdown, { title = 'Untitled', subtitle = '' } = {}) {
  const canvases = renderMarkdownToPdfCanvases({ title, subtitle, markdown });
  const pages = canvases.map(canvas => ({
    width: canvas.width,
    height: canvas.height,
    bytes: dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.92))
  }));
  return buildPdfFromJpegPages(pages);
}

function wordTextRun(text, options = {}) {
  const props = [];
  if (options.bold) props.push('<w:b/>');
  if (options.italic) props.push('<w:i/>');
  if (options.monospace) props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');
  if (options.color) props.push(`<w:color w:val="${options.color}"/>`);
  return `<w:r>${props.length ? `<w:rPr>${props.join('')}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function wordParagraph(text, options = {}) {
  const props = [];
  if (options.style) props.push(`<w:pStyle w:val="${options.style}"/>`);
  if (options.indent) props.push(`<w:ind w:left="${options.indent}"/>`);
  if (options.spacing) props.push(`<w:spacing w:after="${options.spacing}"/>`);
  return `<w:p>${props.length ? `<w:pPr>${props.join('')}</w:pPr>` : ''}${wordTextRun(text, options)}</w:p>`;
}

function markdownBlocksToWordXml(markdown) {
  const xml = [];
  for (const block of parseMarkdownBlocks(markdown)) {
    if (block.type === 'heading') {
      xml.push(wordParagraph(plainTextFromInlineMarkdown(block.text), {
        style: `Heading${Math.min(block.level, 3)}`,
        bold: true,
        spacing: 160
      }));
    } else if (block.type === 'quote') {
      xml.push(wordParagraph(plainTextFromInlineMarkdown(block.text), {
        indent: 360,
        italic: true,
        color: '4B5563',
        spacing: 160
      }));
    } else if (block.type === 'code') {
      block.text.split('\n').forEach(line => {
        xml.push(wordParagraph(line, { monospace: true, spacing: 40 }));
      });
    } else if (block.type === 'table') {
      xml.push(wordParagraph(formatTableAsText(block), { monospace: true, spacing: 160 }));
    } else if (block.type === 'list') {
      block.items.forEach((item, index) => {
        const prefix = block.ordered ? `${index + 1}. ` : '- ';
        xml.push(wordParagraph(`${prefix}${plainTextFromInlineMarkdown(item)}`, {
          indent: 360,
          spacing: 80
        }));
      });
    } else if (block.type === 'rule') {
      xml.push(wordParagraph('---', { spacing: 160 }));
    } else {
      xml.push(wordParagraph(plainTextFromInlineMarkdown(block.text), { spacing: 160 }));
    }
  }
  return xml.join('');
}

function buildDocumentXml({ title = 'Untitled', subtitle = '', markdown = '' }) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${wordParagraph(title, { style: 'Title', bold: true, spacing: 160 })}
    ${subtitle ? wordParagraph(subtitle, { color: '6B7280', spacing: 240 }) : ''}
    ${markdownBlocksToWordXml(markdown)}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

function buildDocxStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI" w:eastAsia="Microsoft YaHei"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:rPr><w:b/><w:sz w:val="36"/><w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI" w:eastAsia="Microsoft YaHei"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:rPr><w:b/><w:sz w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:rPr><w:b/><w:sz w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:rPr><w:b/><w:sz w:val="24"/></w:rPr>
  </w:style>
</w:styles>`;
}

export async function createWordBlobFromMarkdown(markdown, { title = 'Untitled', subtitle = '' } = {}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
  zip.folder('word').file('document.xml', buildDocumentXml({ title, subtitle, markdown }));
  zip.folder('word').file('styles.xml', buildDocxStylesXml());
  zip.folder('word').folder('_rels').file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
  const exportedAt = new Date().toISOString();
  zip.folder('docProps').file('core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(title)}</dc:title>
  <dc:creator>ChatGPT Graph</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${exportedAt}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${exportedAt}</dcterms:modified>
</cp:coreProperties>`);
  zip.folder('docProps').file('app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>ChatGPT Graph</Application>
</Properties>`);

  return zip.generateAsync({ type: 'blob', mimeType: DOCX_CONTENT_TYPE });
}

/**
 * Export backups as a ZIP file
 * @param {Object[]} backups - Array of full backup records (with raw)
 * @param {Object} options
 * @param {'json'|'md'|'both'|'pdf'|'word'} options.format
 */
export async function exportAsZip(backups, { format = 'both' } = {}) {
  const zip = new JSZip();
  const CHUNK_SIZE = 20;

  for (let i = 0; i < backups.length; i += CHUNK_SIZE) {
    const chunk = backups.slice(i, i + CHUNK_SIZE);

    for (const backup of chunk) {
      const raw = backup.raw;
      if (!raw) continue;

      const title = sanitizeFilename(raw.title || 'Untitled');
      const idPrefix = (raw.conversation_id || backup.conversation_id || '').substring(0, 8);
      const baseName = `${title}_${idPrefix}`;
      const markdown = convertToMarkdown(raw);
      const documentOptions = {
        title: raw.title || 'Untitled',
        subtitle: buildDocumentSubtitle(raw)
      };

      if (format === 'json' || format === 'both') {
        zip.file(`${baseName}.json`, JSON.stringify(raw, null, 2));
      }

      if (format === 'md' || format === 'both') {
        zip.file(`${baseName}.md`, markdown);
      }

      if (format === 'pdf') {
        zip.file(`${baseName}.pdf`, await createPdfBlobFromMarkdown(markdown, documentOptions));
      }

      if (format === 'word') {
        zip.file(`${baseName}.docx`, await createWordBlobFromMarkdown(markdown, documentOptions));
      }
    }

    // Yield to main thread between chunks
    if (i + CHUNK_SIZE < backups.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  const dateStr = new Date().toISOString().split('T')[0];
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `chatgpt-backups-${dateStr}.zip`);
}

/**
 * Trigger a browser download for a Blob
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
