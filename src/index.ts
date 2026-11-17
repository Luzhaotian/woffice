/**
 * woffice — Word 文档编辑服务库
 */

export const WOFFICE_VERSION = '0.1.0'

// M0：文档数据模型（节点 / Path / 遍历 / 规范化 / 序列化 / Schema）
export * from '@/model/index'

// M1：编辑引擎（状态 / 步骤 / 事务 / 历史 / 选区 / 命令）
export * from '@/engine/index'

// M2：渲染 + 输入
export * from '@/render/renderer'
export * from '@/render/view'
export * from '@/input/backend'

// M3：插件系统 + 内置插件
export * from '@/engine/registry'
export * from '@/plugins/index'

// M4：docx 导入导出（自研 zip + OOXML）
export * from '@/convert/index'

export * from '@/editor'

// 内置 UI 外壳（顶栏 + 工具栏 + 画布 + 状态栏）
export * from '@/app/editor-app'
export * from '@/app/icons'
