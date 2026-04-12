/**
 * IndexedDB Schema 定义
 */

export const DB_NAME = 'ChatGPTGraphDB';
// Keep the hotfix branch forward-compatible with the backup feature branch.
// The browser may already contain a v5 database with the backup store.
export const DB_VERSION = 5;  // v5: add conversation_backups store

/**
 * 对象存储定义
 */
export const OBJECT_STORES = {
  // 对话表
  conversations: {
    keyPath: 'id',
    indexes: [
      { name: 'updateTime', keyPath: 'updateTime', unique: false },
      { name: 'createTime', keyPath: 'createTime', unique: false }
    ]
  },

  // 节点表
  nodes: {
    keyPath: 'id',
    indexes: [
      { name: 'conversationId', keyPath: 'conversationId', unique: false },
      { name: 'role', keyPath: 'role', unique: false },
      { name: 'createTime', keyPath: 'createTime', unique: false }
    ]
  },

  // 边表（节点之间的父子关系）
  edges: {
    keyPath: 'id',  // 格式: ${conversationId}:${source}->${target}
    indexes: [
      { name: 'conversationId', keyPath: 'conversationId', unique: false },
      { name: 'source', keyPath: 'source', unique: false },
      { name: 'target', keyPath: 'target', unique: false },
      { name: 'orderKey', keyPath: 'orderKey', unique: false }
    ]
  },

  // 轮次表
  rounds: {
    keyPath: 'id',
    indexes: [
      { name: 'conversationId', keyPath: 'conversationId', unique: false },
      { name: 'createTime', keyPath: 'createTime', unique: false }
    ]
  },

  // 分支表
  branches: {
    keyPath: 'id',
    indexes: [
      { name: 'conversationId', keyPath: 'conversationId', unique: false }
    ]
  },

  // 对话备份表（存储原始 API JSON）
  conversation_backups: {
    keyPath: 'conversation_id',
    indexes: [
      { name: 'title', keyPath: 'title', unique: false },
      { name: 'create_time', keyPath: 'create_time', unique: false },
      { name: 'update_time', keyPath: 'update_time', unique: false },
      { name: 'backup_time', keyPath: 'backup_time', unique: false }
    ]
  }
};

/**
 * 创建或升级数据库
 * @param {IDBDatabase} db - 数据库实例
 * @param {IDBVersionChangeEvent} event - 版本变更事件
 */
export function upgradeDatabase(db, event) {
  const oldVersion = event.oldVersion;
  const newVersion = event.newVersion;

  console.log(`[DB] Upgrading database from v${oldVersion} to v${newVersion}`);
  console.log(`[DB] Existing object stores:`, Array.from(db.objectStoreNames));

  try {
    // 创建对象存储
    for (const [storeName, config] of Object.entries(OBJECT_STORES)) {
      if (!db.objectStoreNames.contains(storeName)) {
        console.log(`[DB] Creating object store: ${storeName}`);

        const store = db.createObjectStore(storeName, { keyPath: config.keyPath });

        // 创建索引
        if (config.indexes) {
          for (const index of config.indexes) {
            console.log(`[DB]   Creating index: ${index.name}`);
            store.createIndex(index.name, index.keyPath, { unique: index.unique });
          }
        }

        console.log(`[DB] ✓ Created object store: ${storeName}`);
      } else {
        console.log(`[DB] Object store already exists: ${storeName}`);
      }
    }

    console.log(`[DB] ✓ Database upgrade completed`);
  } catch (error) {
    console.error(`[DB] Error during database upgrade:`, error);
    throw error;
  }
}
