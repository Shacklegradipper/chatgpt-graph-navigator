/**
 * IndexedDB 操作封装
 */

import { DB_NAME, DB_VERSION, OBJECT_STORES, upgradeDatabase } from './schema.js';

/**
 * 数据库管理类
 */
export class Database {
  constructor() {
    this.db = null;
    this.openPromise = null;
  }

  _hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  /**
   * 打开数据库
   * @returns {Promise<IDBDatabase>}
   */
  async open() {
    if (this.db) {
      return this.db;
    }

    if (!this.openPromise) {
      this.openPromise = this._openWithRecovery().finally(() => {
        this.openPromise = null;
      });
    }

    return this.openPromise;
  }

  async _openWithRecovery(hasRetried = false) {
    try {
      return await this._openDatabase();
    } catch (error) {
      if (!hasRetried && this._shouldResetDatabase(error)) {
        console.warn('[DB] Open failed, resetting database and retrying:', error);
        await this._resetDatabase();
        return this._openWithRecovery(true);
      }

      throw error;
    }
  }

  _shouldResetDatabase(error) {
    const message = error?.message || '';
    return (
      message.includes('Missing object stores') ||
      error?.name === 'VersionError' ||
      error?.name === 'InvalidStateError' ||
      error?.name === 'NotFoundError'
    );
  }

  _openDatabase() {
    return new Promise((resolve, reject) => {
      console.log(`[DB] Opening database: ${DB_NAME} v${DB_VERSION}`);
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[DB] Failed to open database:', {
          name: request.error?.name,
          message: request.error?.message,
          error: request.error
        });
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[DB] Database opened successfully');
        console.log('[DB] Object stores:', Array.from(this.db.objectStoreNames));

        // 验证对象存储是否存在
        const requiredStores = Object.keys(OBJECT_STORES);
        const missingStores = requiredStores.filter(store => !this.db.objectStoreNames.contains(store));

        if (missingStores.length > 0) {
          console.error('[DB] Missing object stores:', missingStores);
          console.error('[DB] Database structure is invalid. Attempting recovery.');
          this.db.close();
          this.db = null;
          reject(new Error(`Missing object stores: ${missingStores.join(', ')}`));
          return;
        }

        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        console.log('[DB] onupgradeneeded triggered');
        const db = event.target.result;
        try {
          upgradeDatabase(db, event);
        } catch (error) {
          console.error('[DB] Error during upgrade:', error);
          reject(error);
        }
      };

      request.onblocked = () => {
        console.warn('[DB] Database upgrade blocked. Close all tabs using this database.');
      };
    });
  }

  async _resetDatabase() {
    this.close();

    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);

      request.onsuccess = () => {
        console.warn('[DB] Database reset completed');
        resolve();
      };

      request.onerror = () => {
        console.error('[DB] Failed to reset database:', request.error);
        reject(request.error);
      };

      request.onblocked = () => {
        const error = new Error('Database reset blocked');
        console.error('[DB] Database reset blocked. Close other extension contexts and retry.');
        reject(error);
      };
    });
  }

  /**
   * 保存对话
   * @param {Object} conversation - 对话数据
   * @returns {Promise<void>}
   */
  async saveConversation(conversation) {
    const db = await this.open();
    const tx = db.transaction('conversations', 'readwrite');
    const store = tx.objectStore('conversations');

    return new Promise((resolve, reject) => {
      const request = store.put(conversation);

      request.onsuccess = () => {
        console.log(`[DB] Conversation saved: ${conversation.id}`);
        resolve();
      };

      request.onerror = () => {
        console.error('[DB] Failed to save conversation:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 更新对话
   * @param {string} id - 对话 ID
   * @param {Object} updates - 更新的字段
   * @returns {Promise<void>}
   */
  async updateConversation(id, updates) {
    const db = await this.open();

    // 获取现有对话
    const existing = await this.getConversation(id);
    if (!existing) {
      throw new Error(`Conversation not found: ${id}`);
    }

    // 合并更新
    const updated = { ...existing, ...updates };

    // 保存更新后的对话
    await this.saveConversation(updated);

    // 节点/边/轮次/分支是整会话快照，不是 append-only 日志。
    // 先清掉该会话的旧图数据，再写入最新快照，避免脏节点残留。
    await this.replaceConversationGraphData(id, updates);

    console.log(`[DB] ✓ Conversation updated: ${id}`);
  }

  async replaceConversationGraphData(conversationId, data = {}) {
    const replacements = [
      { key: 'nodes', storeName: 'nodes', saver: items => this.saveNodes(items) },
      { key: 'edges', storeName: 'edges', saver: items => this.saveEdges(items) },
      { key: 'rounds', storeName: 'rounds', saver: items => this.saveRounds(items) },
      { key: 'branches', storeName: 'branches', saver: items => this.saveBranches(items) }
    ];

    for (const { key, storeName, saver } of replacements) {
      if (!this._hasOwn(data, key)) {
        continue;
      }

      const items = Array.isArray(data[key]) ? data[key] : [];
      await this.deleteRecordsByConversation(storeName, conversationId);

      if (items.length > 0) {
        await saver(items);
      } else {
        console.log(`[DB] Cleared ${storeName} for conversation: ${conversationId}`);
      }
    }
  }

  async deleteRecordsByConversation(storeName, conversationId) {
    const db = await this.open();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const index = store.index('conversationId');
      let deletedCount = 0;
      let settled = false;

      const finishError = (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      tx.oncomplete = () => {
        if (!settled) {
          settled = true;
          if (deletedCount > 0) {
            console.log(`[DB] Deleted ${deletedCount} ${storeName} record(s) for conversation: ${conversationId}`);
          }
          resolve(deletedCount);
        }
      };

      tx.onerror = () => finishError(tx.error || new Error(`Failed to delete ${storeName} records`));
      tx.onabort = () => finishError(tx.error || new Error(`Aborted deleting ${storeName} records`));

      const request = index.openCursor(IDBKeyRange.only(conversationId));
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          return;
        }

        store.delete(cursor.primaryKey);
        deletedCount++;
        cursor.continue();
      };

      request.onerror = () => finishError(request.error);
    });
  }

  /**
   * 获取对话
   * @param {string} id - 对话 ID
   * @returns {Promise<Object|null>}
   */
  async getConversation(id) {
    const db = await this.open();
    const tx = db.transaction('conversations', 'readonly');
    const store = tx.objectStore('conversations');

    return new Promise((resolve, reject) => {
      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * 批量保存节点
   * @param {Array} nodes - 节点数组
   * @returns {Promise<void>}
   */
  async saveNodes(nodes) {
    const db = await this.open();
    const tx = db.transaction('nodes', 'readwrite');
    const store = tx.objectStore('nodes');

    const promises = nodes.map(node => {
      return new Promise((resolve, reject) => {
        const request = store.put(node);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });

    await Promise.all(promises);
    console.log(`[DB] Saved ${nodes.length} nodes`);
  }

  /**
   * 获取对话的所有节点
   * @param {string} conversationId - 对话 ID
   * @returns {Promise<Array>}
   */
  async getNodes(conversationId) {
    const db = await this.open();
    const tx = db.transaction('nodes', 'readonly');
    const store = tx.objectStore('nodes');
    const index = store.index('conversationId');

    return new Promise((resolve, reject) => {
      const request = index.getAll(conversationId);

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * 批量保存边
   * @param {Array} edges - 边数组
   * @returns {Promise<void>}
   */
  async saveEdges(edges) {
    const db = await this.open();
    const tx = db.transaction('edges', 'readwrite');
    const store = tx.objectStore('edges');

    const promises = edges.map(edge => {
      return new Promise((resolve, reject) => {
        const request = store.put(edge);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });

    await Promise.all(promises);
    console.log(`[DB] Saved ${edges.length} edges`);
  }

  /**
   * 获取对话的所有边
   * @param {string} conversationId - 对话 ID
   * @returns {Promise<Array>}
   */
  async getEdges(conversationId) {
    const db = await this.open();
    const tx = db.transaction('edges', 'readonly');
    const store = tx.objectStore('edges');
    const index = store.index('conversationId');

    return new Promise((resolve, reject) => {
      const request = index.getAll(conversationId);

      request.onsuccess = () => {
        // 按 orderKey 排序
        const edges = request.result || [];
        edges.sort((a, b) => (a.orderKey || 0) - (b.orderKey || 0));
        resolve(edges);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * 获取对话的所有轮次
   * @param {string} conversationId - 对话 ID
   * @returns {Promise<Array>}
   */
  async getRounds(conversationId) {
    const db = await this.open();
    const tx = db.transaction('rounds', 'readonly');
    const store = tx.objectStore('rounds');
    const index = store.index('conversationId');

    return new Promise((resolve, reject) => {
      const request = index.getAll(conversationId);

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * 批量保存轮次
   * @param {Array} rounds - 轮次数组
   * @returns {Promise<void>}
   */
  async saveRounds(rounds) {
    const db = await this.open();
    const tx = db.transaction('rounds', 'readwrite');
    const store = tx.objectStore('rounds');

    const promises = rounds.map(round => {
      return new Promise((resolve, reject) => {
        const request = store.put(round);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });

    await Promise.all(promises);
    console.log(`[DB] Saved ${rounds.length} rounds`);
  }

  /**
   * 批量保存分支
   * @param {Array} branches - 分支数组
   * @returns {Promise<void>}
   */
  async saveBranches(branches) {
    const db = await this.open();
    const tx = db.transaction('branches', 'readwrite');
    const store = tx.objectStore('branches');

    // 为每个分支添加 conversationId（从 path 中获取）
    const branchesWithConvId = branches.map(branch => ({
      ...branch,
      conversationId: branch.path[0]?.conversationId || 'unknown'
    }));

    const promises = branchesWithConvId.map(branch => {
      return new Promise((resolve, reject) => {
        const request = store.put(branch);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });

    await Promise.all(promises);
    console.log(`[DB] Saved ${branches.length} branches`);
  }

  /**
   * 保存完整对话数据
   * @param {Object} conversationData - 完整对话数据
   * @returns {Promise<void>}
   */
  async saveFullConversation(conversationData) {
    console.log(`[DB] Saving full conversation: ${conversationData.id}`);

    // 保存对话基本信息
    await this.saveConversation({
      id: conversationData.id,
      title: conversationData.title,
      createTime: conversationData.createTime,
      updateTime: conversationData.updateTime,
      nodeCount: conversationData.nodes?.length || 0,
      edgeCount: conversationData.edges?.length || 0,
      roundCount: conversationData.rounds?.length || 0,
      branchCount: conversationData.branches?.length || 0
    });

    await this.replaceConversationGraphData(conversationData.id, {
      nodes: conversationData.nodes,
      edges: conversationData.edges,
      rounds: conversationData.rounds,
      branches: conversationData.branches
    });

    console.log(`[DB] ✓ Full conversation saved: ${conversationData.id}`);
  }

  /**
   * 获取所有对话列表
   * @returns {Promise<Array>}
   */
  async getAllConversations() {
    const db = await this.open();
    const tx = db.transaction('conversations', 'readonly');
    const store = tx.objectStore('conversations');

    return new Promise((resolve, reject) => {
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * 删除对话及其相关数据
   * @param {string} conversationId - 对话 ID
   * @returns {Promise<void>}
   */
  async deleteConversation(conversationId) {
    const db = await this.open();

    await this.replaceConversationGraphData(conversationId, {
      nodes: [],
      edges: [],
      rounds: [],
      branches: []
    });

    // 删除对话
    const tx1 = db.transaction('conversations', 'readwrite');
    await new Promise((resolve, reject) => {
      const request = tx1.objectStore('conversations').delete(conversationId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    console.log(`[DB] Conversation deleted: ${conversationId}`);
  }

  // ==================== Backup CRUD ====================

  /**
   * 保存对话备份（原始 API JSON）
   * @param {Object} rawData - API 返回的完整 JSON
   * @returns {Promise<void>}
   */
  async saveBackup(rawData) {
    const db = await this.open();
    const tx = db.transaction('conversation_backups', 'readwrite');
    const store = tx.objectStore('conversation_backups');

    // Extract metadata from raw mapping
    let message_count = 0;
    let content_preview = '';
    let model_slug = '';
    let workspace_name = 'Personal';
    let workspace_id = rawData.workspace_id || null;

    if (workspace_id) {
      // Use resolved name from accounts API if available, otherwise fallback to 'Team'
      workspace_name = rawData._workspace_name || 'Team';
    }

    if (rawData.mapping) {
      const nodes = Object.values(rawData.mapping);
      for (const node of nodes) {
        const role = node.message?.author?.role;
        if (role === 'user' || role === 'assistant') {
          message_count++;
        }
        if (!content_preview && role === 'user') {
          const parts = node.message?.content?.parts;
          if (parts && parts.length > 0) {
            const text = parts.filter(p => typeof p === 'string').join(' ');
            content_preview = text.substring(0, 200);
          }
        }
        if (!model_slug && role === 'assistant') {
          model_slug = node.message?.metadata?.model_slug || '';
        }
      }
    }

    const record = {
      conversation_id: rawData.conversation_id,
      title: rawData.title || '',
      create_time: rawData.create_time || 0,
      update_time: rawData.update_time || 0,
      backup_time: Date.now(),
      message_count,
      content_preview,
      model_slug,
      workspace_id,
      workspace_name,
      raw: rawData
    };

    return new Promise((resolve, reject) => {
      const request = store.put(record);
      request.onsuccess = () => {
        console.log(`[DB] Backup saved: ${record.conversation_id}`);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 获取单个备份
   * @param {string} conversationId
   * @returns {Promise<Object|null>}
   */
  async getBackup(conversationId) {
    const db = await this.open();
    const tx = db.transaction('conversation_backups', 'readonly');
    const store = tx.objectStore('conversation_backups');

    return new Promise((resolve, reject) => {
      const request = store.get(conversationId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 获取所有备份的元数据（不含 raw，用于列表展示）
   * @returns {Promise<Array>}
   */
  async getAllBackupsMeta() {
    const db = await this.open();
    const tx = db.transaction('conversation_backups', 'readonly');
    const store = tx.objectStore('conversation_backups');

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const results = (request.result || []).map(({ raw, ...meta }) => meta);
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 删除备份
   * @param {string} conversationId
   * @returns {Promise<void>}
   */
  async deleteBackup(conversationId) {
    const db = await this.open();
    const tx = db.transaction('conversation_backups', 'readwrite');
    const store = tx.objectStore('conversation_backups');

    return new Promise((resolve, reject) => {
      const request = store.delete(conversationId);
      request.onsuccess = () => {
        console.log(`[DB] Backup deleted: ${conversationId}`);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 获取所有备份 ID
   * @returns {Promise<Set<string>>}
   */
  async getAllBackupIds() {
    const db = await this.open();
    const tx = db.transaction('conversation_backups', 'readonly');
    const store = tx.objectStore('conversation_backups');

    return new Promise((resolve, reject) => {
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(new Set(request.result || []));
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 批量删除备份
   * @param {string[]} ids - conversation_id 数组
   * @returns {Promise<void>}
   */
  async deleteBackups(ids) {
    const db = await this.open();
    const tx = db.transaction('conversation_backups', 'readwrite');
    const store = tx.objectStore('conversation_backups');

    const promises = ids.map(id => {
      return new Promise((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });

    await Promise.all(promises);
    console.log(`[DB] Batch deleted ${ids.length} backups`);
  }

  /**
   * 批量获取备份（含 raw 数据，用于导出）
   * @param {string[]} ids - conversation_id 数组
   * @returns {Promise<Object[]>}
   */
  async getBackups(ids) {
    const db = await this.open();
    const tx = db.transaction('conversation_backups', 'readonly');
    const store = tx.objectStore('conversation_backups');

    const promises = ids.map(id => {
      return new Promise((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    });

    const results = await Promise.all(promises);
    return results.filter(r => r !== null);
  }

  /**
   * 更新备份的 mapping 和 current_node（用于备份对话继续聊天）
   * @param {string} conversationId
   * @param {Object} mapping - 更新后的完整 mapping
   * @param {string} currentNode - 新的 current_node ID
   * @returns {Promise<void>}
   */
  async updateBackupMapping(conversationId, mapping, currentNode) {
    const existing = await this.getBackup(conversationId);
    if (!existing) throw new Error(`Backup not found: ${conversationId}`);

    existing.raw.mapping = mapping;
    existing.raw.current_node = currentNode;
    existing.raw.update_time = Date.now() / 1000;

    await this.saveBackup(existing.raw);
  }

  /**
   * 关闭数据库
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('[DB] Database closed');
    }
  }
}

// 导出单例实例
export const db = new Database();
