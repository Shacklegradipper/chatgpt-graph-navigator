/**
 * 类型定义（使用 JSDoc）
 */

/**
 * 对话节点
 * @typedef {Object} ConversationNode
 * @property {string} id - 节点 ID
 * @property {Object} message - 消息对象
 * @property {Object} message.author - 作者信息
 * @property {'user'|'assistant'|'system'} message.author.role - 角色
 * @property {Object} message.content - 内容
 * @property {string[]} message.content.parts - 内容片段
 * @property {number} message.create_time - 创建时间
 * @property {string|null} parent - 父节点 ID
 * @property {string[]} children - 子节点 ID 数组
 */

/**
 * 解析后的消息节点
 * @typedef {Object} ParsedNode
 * @property {string} id - 节点 ID
 * @property {string} conversationId - 对话 ID
 * @property {'user'|'assistant'|'system'} role - 角色
 * @property {string} content - 消息内容
 * @property {number} createTime - 创建时间
 * @property {string|null} parent - 父节点 ID
 * @property {string[]} children - 子节点 ID 数组
 * @property {Object} metadata - 元数据
 */

/**
 * 对话轮次
 * @typedef {Object} Round
 * @property {string} id - 轮次 ID
 * @property {string} conversationId - 对话 ID
 * @property {string} userMessageId - 用户消息 ID
 * @property {string|null} assistantMessageId - AI 回复 ID
 * @property {string|null} parentRoundId - 父轮次 ID
 * @property {number} createTime - 创建时间
 */

/**
 * 分支信息
 * @typedef {Object} Branch
 * @property {string} id - 分支 ID（叶子节点 ID）
 * @property {ParsedNode[]} path - 从根到叶子的完整路径
 * @property {number} messageCount - 消息数量
 * @property {number} depth - 深度
 */

/**
 * 对话数据
 * @typedef {Object} ConversationData
 * @property {string} id - 对话 ID
 * @property {string} title - 对话标题
 * @property {number} createTime - 创建时间
 * @property {number} updateTime - 更新时间
 * @property {Object} mapping - 原始 mapping 对象
 * @property {ParsedNode[]} nodes - 解析后的节点数组
 * @property {Round[]} rounds - 轮次数组
 * @property {Branch[]} branches - 分支数组
 */

/**
 * 分支点
 * @typedef {Object} BranchPoint
 * @property {string} nodeId - 分支点节点 ID
 * @property {'user'|'assistant'} role - 角色
 * @property {string} content - 内容摘要
 * @property {number} childrenCount - 子节点数量
 * @property {string[]} childrenIds - 子节点 ID 数组
 */

/**
 * 扩展消息
 * @typedef {Object} ExtensionMessage
 * @property {string} type - 消息类型
 * @property {Object} payload - 消息负载
 * @property {number} timestamp - 时间戳
 */

/**
 * API 响应
 * @typedef {Object} APIResponse
 * @property {boolean} success - 是否成功
 * @property {Object} [data] - 数据
 * @property {string} [error] - 错误信息
 */

// 导出空对象以避免警告
export default {};
