import {
  ASSISTANT_STREAM_OUTPUT_MODES,
  DEFAULT_ASSISTANT_STREAM_SETTINGS
} from '../../shared/constants.js';

function getStreamPartIndex(node) {
  const index = Number(node?.metadata?.stream_group_part_index);
  return Number.isFinite(index) ? index : Number.MAX_SAFE_INTEGER;
}

function getNodeTime(node) {
  const metadataTime = Number(node?.metadata?.timestamp);
  if (Number.isFinite(metadataTime)) return metadataTime;
  const createTime = Number(node?.createTime);
  return Number.isFinite(createTime) ? createTime * 1000 : 0;
}

function getSortKey(node) {
  return getStreamPartIndex(node) === Number.MAX_SAFE_INTEGER
    ? getNodeTime(node)
    : getStreamPartIndex(node);
}

function compareByFallbackOrder(a, b) {
  const sortDiff = getSortKey(a) - getSortKey(b);
  if (sortDiff !== 0) return sortDiff;

  const timeDiff = getNodeTime(a) - getNodeTime(b);
  if (timeDiff !== 0) return timeDiff;

  return String(a.id).localeCompare(String(b.id));
}

function orderGroupByParentChain(group) {
  const ids = new Set(group.map(node => node.id));
  const childrenByParent = new Map();

  for (const node of group) {
    if (!node.parent || !ids.has(node.parent)) continue;
    if (!childrenByParent.has(node.parent)) {
      childrenByParent.set(node.parent, []);
    }
    childrenByParent.get(node.parent).push(node);
  }

  for (const children of childrenByParent.values()) {
    children.sort(compareByFallbackOrder);
  }

  const roots = group
    .filter(node => !node.parent || !ids.has(node.parent))
    .sort(compareByFallbackOrder);
  const ordered = [];
  const visited = new Set();

  const visit = (node) => {
    if (!node || visited.has(node.id)) return;
    visited.add(node.id);
    ordered.push(node);

    for (const child of childrenByParent.get(node.id) || []) {
      visit(child);
    }
  };

  roots.forEach(visit);

  group
    .slice()
    .sort(compareByFallbackOrder)
    .forEach(node => {
      if (!visited.has(node.id)) {
        visit(node);
      }
    });

  return ordered;
}

function isAssistant(node) {
  return node?.role === 'assistant';
}

function isThinkingPreamble(node) {
  return isAssistant(node) && node.metadata?.is_thinking_preamble_message === true;
}

function getTurnExchangeId(node) {
  return node?.metadata?.turn_exchange_id || null;
}

function mergeStreamContent(nodes) {
  return nodes.reduce((merged, node) => {
    const text = (node.content || '').trim();
    if (!text) return merged;
    if (!merged) return text;
    if (merged.includes(text)) return merged;
    if (text.includes(merged)) return text;
    return `${merged}\n\n${text}`;
  }, '');
}

function buildEdgesFromNodes(nodes, conversationId) {
  const nodeMap = new Map(nodes.map(node => [node.id, node]));

  return nodes
    .filter(node => node.parent && nodeMap.has(node.parent))
    .map(node => {
      const parent = nodeMap.get(node.parent);
      return {
        id: `${conversationId}:${node.parent}->${node.id}`,
        conversationId,
        source: node.parent,
        target: node.id,
        sourceRole: parent?.role,
        targetRole: node.role,
        orderKey: node.createTime || parent?.createTime || Date.now() / 1000
      };
    });
}

function getExternalParent(group) {
  const ids = new Set(group.map(node => node.id));
  const ordered = orderGroupByParentChain(group);
  return ordered.find(node => node.parent && !ids.has(node.parent))?.parent || null;
}

function chooseKeepNode(group, mode) {
  const ordered = orderGroupByParentChain(group);

  if (mode === ASSISTANT_STREAM_OUTPUT_MODES.MERGE_ALL) {
    return ordered[0];
  }

  const nonPreamble = ordered.filter(node => !isThinkingPreamble(node));
  return nonPreamble[nonPreamble.length - 1] || ordered[ordered.length - 1];
}

function buildIncrementalGroups(nodes) {
  const groups = new Map();

  for (const node of nodes) {
    if (!isAssistant(node) || node.metadata?.is_incremental !== true) {
      continue;
    }

    const key = node.metadata?.stream_group_key || `incremental-parent:${node.parent || 'root'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(node);
  }

  return Array.from(groups.values()).filter(group => group.length > 1);
}

function buildThinkingPreambleGroups(nodes) {
  const byTurnExchange = new Map();

  for (const node of nodes) {
    if (!isAssistant(node)) continue;

    const turnExchangeId = getTurnExchangeId(node);
    if (!turnExchangeId) continue;

    if (!byTurnExchange.has(turnExchangeId)) {
      byTurnExchange.set(turnExchangeId, []);
    }
    byTurnExchange.get(turnExchangeId).push(node);
  }

  return Array.from(byTurnExchange.values())
    .filter(group => group.length > 1 && group.some(isThinkingPreamble));
}

function applyGroup(normalizedById, group, mode) {
  const liveGroup = group
    .map(node => normalizedById.get(node.id))
    .filter(Boolean);

  if (liveGroup.length <= 1) return;

  const keep = chooseKeepNode(liveGroup, mode);
  const orderedGroup = orderGroupByParentChain(liveGroup);
  const groupIds = new Set(liveGroup.map(node => node.id));
  const externalParent = getExternalParent(liveGroup);
  const externalChildren = [];

  for (const node of liveGroup) {
    for (const childId of node.children || []) {
      if (!groupIds.has(childId) && normalizedById.has(childId) && !externalChildren.includes(childId)) {
        externalChildren.push(childId);
      }
    }
  }

  for (const node of liveGroup) {
    if (node.id !== keep.id) {
      normalizedById.delete(node.id);
    }
  }

  const nextKeep = {
    ...keep,
    parent: externalParent,
    children: externalChildren,
    metadata: {
      ...keep.metadata,
      stream_part_ids: orderedGroup.map(node => node.id),
      stream_group_part_count: Math.max(
        keep.metadata?.stream_group_part_count || 0,
        liveGroup.length
      )
    }
  };

  if (mode === ASSISTANT_STREAM_OUTPUT_MODES.MERGE_ALL) {
    nextKeep.content = mergeStreamContent(orderedGroup);
  }

  normalizedById.set(keep.id, nextKeep);

  for (const node of normalizedById.values()) {
    if (groupIds.has(node.parent) && node.id !== keep.id) {
      node.parent = keep.id;
    }
  }
}

export function normalizeAssistantStreamNodes(
  nodes,
  options = {}
) {
  const mode = options.mode || DEFAULT_ASSISTANT_STREAM_SETTINGS.mode;
  const conversationId = options.conversationId || 'unknown';

  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const normalizedById = new Map(nodes.map(node => [
    node.id,
    {
      ...node,
      children: Array.isArray(node.children) ? [...node.children] : []
    }
  ]));

  for (const node of Array.from(normalizedById.values())) {
    if (isAssistant(node) && !(node.content || '').trim()) {
      normalizedById.delete(node.id);
    }
  }

  const sourceNodes = Array.from(normalizedById.values());
  const groups = [
    ...buildThinkingPreambleGroups(sourceNodes),
    ...buildIncrementalGroups(sourceNodes)
  ];

  for (const group of groups) {
    applyGroup(normalizedById, group, mode);
  }

  const normalizedNodes = Array.from(normalizedById.values());
  const normalizedNodeMap = new Map(normalizedNodes.map(node => [node.id, node]));

  normalizedNodes.forEach(node => {
    node.children = [];
  });

  normalizedNodes
    .filter(node => node.parent && normalizedNodeMap.has(node.parent))
    .sort((a, b) => (a.createTime || 0) - (b.createTime || 0))
    .forEach(node => {
      const parent = normalizedNodeMap.get(node.parent);
      if (!parent.children.includes(node.id)) {
        parent.children.push(node.id);
      }
    });

  return {
    nodes: normalizedNodes,
    edges: buildEdgesFromNodes(normalizedNodes, conversationId)
  };
}
