/**
 * Export utilities for backup manager
 * Handles JSON→Markdown conversion, ZIP packaging, and file downloads
 */

import JSZip from 'jszip';

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

/**
 * Export backups as a ZIP file
 * @param {Object[]} backups - Array of full backup records (with raw)
 * @param {Object} options
 * @param {'json'|'md'|'both'} options.format
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

      if (format === 'json' || format === 'both') {
        zip.file(`${baseName}.json`, JSON.stringify(raw, null, 2));
      }

      if (format === 'md' || format === 'both') {
        zip.file(`${baseName}.md`, convertToMarkdown(raw));
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
