/**
 * 文档数据模型 —— 节点类型与基础工具
 *
 * 设计见 docs/design-plan.md 第 4 章。模型是一棵 JSON 树：
 *
 *   Document → (ElementNode | VoidNode)[] → ... → TextNode
 *
 * 说明：块（block）与行内（inline）的区分由 Schema 的 role 决定，
 * 模型层统一用 ElementNode 表达，不重复建模。
 */

export type Attrs = Record<string, unknown>

/** 文档格式版本 */
export const DOC_VERSION = 1

/** 行内标记（加粗、斜体、链接等） */
export interface Mark {
  type: string
  attrs?: Attrs
}

/** 文本节点（行内叶子） */
export interface TextNode {
  type: 'text'
  text: string
  marks?: Mark[]
}

/** 元素节点（可包含子节点；块 / 行内容器统一） */
export interface ElementNode {
  type: string
  attrs?: Attrs
  children: Node[]
}

/** 空节点（图片、分割线、分页符等：无子节点、无文本） */
export interface VoidNode {
  type: string
  attrs?: Attrs
  void: true
}

export type Node = TextNode | ElementNode | VoidNode

export interface Document {
  type: 'doc'
  version: number
  children: Node[]
}

// ---------------------------------------------------------------------------
// 类型守卫
// ---------------------------------------------------------------------------

export function isText(node: Node): node is TextNode {
  return node.type === 'text'
}

export function isVoid(node: Node): node is VoidNode {
  return node.type !== 'text' && (node as VoidNode).void === true
}

export function isElement(node: Node): node is ElementNode {
  return node.type !== 'text' && !isVoid(node)
}

// ---------------------------------------------------------------------------
// 工厂函数
// ---------------------------------------------------------------------------

export function createText(text: string, marks?: Mark[]): TextNode {
  return marks && marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text }
}

export function createElement(type: string, children: Node[] = [], attrs?: Attrs): ElementNode {
  return attrs ? { type, attrs, children } : { type, children }
}

export function createVoid(type: string, attrs?: Attrs): VoidNode {
  return attrs ? { type, attrs, void: true } : { type, void: true }
}

export function createDocument(children: Node[] = []): Document {
  return { type: 'doc', version: DOC_VERSION, children }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 递归获取节点的纯文本内容（void 节点为空串） */
export function getTextOf(node: Node): string {
  if (isText(node)) return node.text
  if (isVoid(node)) return ''
  return node.children.map(getTextOf).join('')
}

/** 深拷贝节点 */
export function cloneNode<T extends Node>(node: T): T {
  if (isText(node)) {
    return (node.marks ? { ...node, marks: node.marks.map(cloneMark) } : { ...node }) as T
  }
  if (isVoid(node)) {
    return (node.attrs ? { ...node, attrs: { ...node.attrs } } : { ...node }) as T
  }
  return {
    ...node,
    ...(node.attrs ? { attrs: { ...node.attrs } } : {}),
    children: node.children.map(cloneNode),
  } as T
}

function cloneMark(mark: Mark): Mark {
  return mark.attrs ? { ...mark, attrs: { ...mark.attrs } } : { ...mark }
}

/** 比较两个 marks 列表（要求已规范化：同序、无重复） */
export function marksEqual(a?: Mark[], b?: Mark[]): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].type !== b[i].type) return false
    if (!attrsEqual(a[i].attrs, b[i].attrs)) return false
  }
  return true
}

export function attrsEqual(a?: Attrs, b?: Attrs): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return stableStringify(a) === stableStringify(b)
}

/** 键序无关的稳定序列化，用于 attrs / marks 比较 */
export function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'number':
    case 'boolean':
    case 'string':
      return JSON.stringify(value)
    case 'undefined':
      return 'null'
    case 'object':
      break
    default:
      return JSON.stringify(String(value))
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']'
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + stableStringify(record[key])).join(',') + '}'
}
