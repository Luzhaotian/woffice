/**
 * 文档树遍历与查询（纯函数，不修改文档）
 */

import type { Document, Node } from '@/model/node'
import { getTextOf, isElement } from '@/model/node'
import type { Path } from '@/model/path'
import { parent } from '@/model/path'

export interface NodeEntry {
  node: Node
  path: Path
}

/** 取 path 处的节点；不存在返回 undefined（顶层节点的"父"是文档根，故返回 undefined） */
export function getNodeAt(doc: Document, path: Path): Node | undefined {
  let node: Node | undefined
  let children: Node[] | undefined = doc.children
  for (const index of path) {
    if (!children) return undefined
    node = children[index]
    if (!node) return undefined
    children = isElement(node) ? node.children : undefined
  }
  return node
}

/** 取 path 处节点的父节点；顶层节点没有父节点（返回 undefined） */
export function getParentAt(doc: Document, path: Path): Node | undefined {
  return getNodeAt(doc, parent(path))
}

/**
 * 深度优先遍历整篇文档（含顶层节点），visitor 返回 false 可跳过当前节点的子节点。
 */
export function traverse(doc: Document, visit: (entry: NodeEntry) => void | false): void {
  const walk = (node: Node, path: Path): void => {
    if (visit({ node, path }) === false) return
    if (isElement(node)) {
      for (let i = 0; i < node.children.length; i++) {
        walk(node.children[i], [...path, i])
      }
    }
  }
  for (let i = 0; i < doc.children.length; i++) {
    walk(doc.children[i], [i])
  }
}

/** 找到第一个满足条件的节点（找到后其余访问会被跳过） */
export function findNode(doc: Document, predicate: (node: Node) => boolean): NodeEntry | undefined {
  let found: NodeEntry | undefined
  traverse(doc, (entry) => {
    if (found) return false
    if (predicate(entry.node)) {
      found = entry
      return false
    }
    return undefined
  })
  return found
}

export function findAll(doc: Document, predicate: (node: Node) => boolean): NodeEntry[] {
  const results: NodeEntry[] = []
  traverse(doc, (entry) => {
    if (predicate(entry.node)) results.push(entry)
    return undefined
  })
  return results
}

/** 整篇文档的纯文本内容 */
export function getTextContent(doc: Document): string {
  return doc.children.map(getTextOf).join('')
}

/** 取 path 处节点的子节点数组；path 为空时取文档根的子节点；非元素节点返回 undefined */
export function getChildrenAt(doc: Document, path: Path): Node[] | undefined {
  if (path.length === 0) return doc.children
  const node = getNodeAt(doc, path)
  return node && isElement(node) ? node.children : undefined
}

/**
 * 返回把 path 处节点替换为 newNode 后的新文档（结构共享，未受影响的分支保持原引用）。
 * path 必须非空且存在。
 */
export function updateNodeAt(doc: Document, path: Path, newNode: Node): Document {
  if (path.length === 0) throw new Error('不能替换文档根节点')
  return { ...doc, children: updateChildren(doc.children, path, newNode) }
}

function updateChildren(children: Node[], path: Path, newNode: Node): Node[] {
  const [index, ...rest] = path
  if (index < 0 || index >= children.length) throw new Error(`路径不存在: ${path.join('.')}`)
  return children.map((node, i) => {
    if (i !== index) return node
    if (rest.length === 0) return newNode
    if (!isElement(node)) throw new Error(`路径经过叶子节点: ${path.join('.')}`)
    return { ...node, children: updateChildren(node.children, rest, newNode) }
  })
}
