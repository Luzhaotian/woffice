/**
 * Schema：声明文档允许的节点 / 标记，以及渲染方式
 *
 * M2：提供基础 schema（tagName / dynamicTag）
 * M3：支持插件注册（render 函数、content 表达式等）
 */

import type { Node as ModelNode } from '@/model/node'

export type NodeRole = 'block' | 'inline' | 'void'

export interface NodeSpec {
  type: string
  role: NodeRole
  /** 默认渲染标签（无 render 时使用） */
  tagName?: string
  /** 根据 attrs 动态决定标签（如 heading 的 level） */
  dynamicTag?: (attrs?: Record<string, unknown>) => string
  /** 自定义渲染：返回 DOM 节点；子节点通过 renderChildren 渲染后自行插入 */
  render?: (node: ModelNode, renderChildren: () => Node[]) => Node
  /** 内容约束（M3 声明，校验在后续版本） */
  content?: string
  /** 允许的 marks（空 = 全部） */
  marks?: string[]
}

export interface MarkSpec {
  type: string
  tagName: string
  attrs?: Record<string, unknown>
  /** 渲染时的 CSS 类名（可选） */
  className?: string
}

export interface Schema {
  nodes: NodeSpec[]
  marks: MarkSpec[]
}

export function createSchema(schema: Schema): Schema {
  return schema
}

/** 从插件集合构建 schema */
export function buildSchema(plugins: { nodes?: NodeSpec[]; marks?: MarkSpec[] }[]): Schema {
  const nodes: NodeSpec[] = []
  const marks: MarkSpec[] = []
  for (const plugin of plugins) {
    nodes.push(...(plugin.nodes ?? []))
    marks.push(...(plugin.marks ?? []))
  }
  return createSchema({ nodes, marks })
}

/** 默认基础 schema（不启用插件系统时的兜底） */
export const basicSchema: Schema = createSchema({
  nodes: [
    { type: 'paragraph', role: 'block', tagName: 'p' },
    { type: 'heading', role: 'block', tagName: 'h1', dynamicTag: (attrs) => `h${(attrs?.level as number) ?? 1}` },
    { type: 'bullet_list', role: 'block', tagName: 'ul' },
    { type: 'ordered_list', role: 'block', tagName: 'ol' },
    { type: 'list_item', role: 'block', tagName: 'li' },
    { type: 'hard_break', role: 'inline', tagName: 'br' },
    { type: 'image', role: 'inline', tagName: 'img' },
  ],
  marks: [
    { type: 'bold', tagName: 'strong' },
    { type: 'italic', tagName: 'em' },
    { type: 'underline', tagName: 'u' },
    { type: 'strikethrough', tagName: 's' },
    { type: 'code', tagName: 'code' },
  ],
})
