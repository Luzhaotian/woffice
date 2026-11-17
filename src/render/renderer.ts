/**
 * DOM 渲染器：Document → DOM，维护 语义 path ↔ DOM 节点 映射
 *
 * M2：全量渲染
 * M5：视图模式（flow / page）+ 块级分页
 * M6：增量渲染——按模型节点对象 identity 做 keyed 复用（模型不可变，
 *     未改变的节点引用不变），只重建新增/变化的部分
 */

import type { Document as ModelDocument, Node as ModelNode, TextNode } from '@/model/node'
import { isElement, isText, isVoid } from '@/model/node'
import type { Path, Position } from '@/model/path'
import type { TextSelection } from '@/engine/selection'
import { basicSchema, type Schema } from '@/model/schema'

export type ViewMode = 'flow' | 'page'

export interface PageSettings {
  pageWidth: number
  pageHeight: number
  marginTop: number
  marginRight: number
  marginBottom: number
  marginLeft: number
}

/** A4，96dpi 下的像素尺寸（210mm × 297mm，1 英寸边距） */
export const A4_SETTINGS: PageSettings = {
  pageWidth: 794,
  pageHeight: 1123,
  marginTop: 96,
  marginRight: 96,
  marginBottom: 96,
  marginLeft: 96,
}

export function pathKey(path: Path): string {
  return path.join('.')
}

export function parsePathKey(key: string): Path {
  return key === '' ? [] : key.split('.').map(Number)
}

export class Renderer {
  private readonly schema: Schema
  private readonly root: HTMLElement
  /** 模型节点 → DOM 节点（文本节点存外层包裹元素） */
  private readonly domByNode = new WeakMap<ModelNode, Node>()
  /** 文本节点 → DOM Text */
  private readonly textByNode = new WeakMap<ModelNode, Text>()
  /** 语义 path → DOM 节点（文本节点存 DOM Text） */
  private readonly domByPath = new Map<string, Node>()
  /** DOM 节点 → 语义 path */
  private readonly pathByDom = new Map<Node, Path>()
  private readonly types = new Map<string, string>()
  /** 语义 path → void 节点（分割线 / 分页符等），光标不能落在这些节点上 */
  private readonly voidPaths = new Set<string>()
  private reconciled = false
  private viewMode: ViewMode = 'flow'
  private pageSettings: PageSettings = A4_SETTINGS

  constructor(root: HTMLElement, schema: Schema = basicSchema) {
    this.root = root
    this.schema = schema
  }

  setViewMode(mode: ViewMode, settings?: PageSettings): void {
    this.viewMode = mode
    if (settings) this.pageSettings = settings
  }

  getViewMode(): ViewMode {
    return this.viewMode
  }

  render(doc: ModelDocument): void {
    this.root.classList.toggle('view-page', this.viewMode === 'page')
    // 页面模式需要重新分页，统一全量重建；流式模式走增量渲染
    if (!this.reconciled || this.viewMode === 'page') {
      this.fullRender(doc)
    } else {
      this.reconcileChildren(this.root, doc.children, [])
    }
    if (this.viewMode === 'page') this.applyPagination()
  }

  private fullRender(doc: ModelDocument): void {
    this.root.replaceChildren()
    this.domByPath.clear()
    this.pathByDom.clear()
    this.voidPaths.clear()
    this.reconciled = true
    this.reconcileChildren(this.root, doc.children, [])
  }

  /** 按模型节点 identity 做 keyed 复用 */
  private reconcileChildren(parent: HTMLElement, children: ModelNode[], parentPath: Path): void {
    const expected: Node[] = []
    for (let i = 0; i < children.length; i++) {
      expected.push(this.reconcileNode(children[i], [...parentPath, i]))
    }
    syncChildren(parent, expected)
  }

  private reconcileNode(node: ModelNode, path: Path): Node {
    const key = pathKey(path)
    this.types.set(key, node.type)
    if (isVoid(node)) this.voidPaths.add(key)
    else this.voidPaths.delete(key)

    if (isText(node)) {
      const existingWrapper = this.domByNode.get(node)
      const existingText = this.textByNode.get(node)
      if (existingWrapper && existingText) {
        this.domByPath.set(key, existingText)
        this.pathByDom.set(existingText, path)
        return existingWrapper
      }
      const wrapper = this.createTextWrapper(node)
      const text = this.textByNode.get(node)
      if (text) {
        this.domByPath.set(key, text)
        this.pathByDom.set(text, path)
      }
      this.domByNode.set(node, wrapper)
      return wrapper
    }

    const existing = this.domByNode.get(node)
    if (existing) {
      this.domByPath.set(key, existing)
      this.pathByDom.set(existing, path)
      if (existing.nodeType === Node.ELEMENT_NODE) {
        ;(existing as HTMLElement).setAttribute('data-woffice-path', key)
      }
      if (isElement(node)) {
        this.reconcileChildren(existing as HTMLElement, node.children, path)
        // reconcileChildren 会移除占位 <br>，这里补回来：
        // 空块必须有高度，否则光标看不见、也点不中
        this.ensurePlaceholderBr(existing as HTMLElement, node)
      }
      return existing
    }

    const created = this.createNode(node, path)
    this.domByNode.set(node, created)
    this.domByPath.set(key, created)
    this.pathByDom.set(created, path)
    return created
  }

  private createTextWrapper(node: TextNode): Node {
    const doc = this.root.ownerDocument
    const text = doc.createTextNode(node.text)
    this.textByNode.set(node, text)
    let wrapper: Node = text
    for (const mark of node.marks ?? []) {
      const spec = this.schema.marks.find((m) => m.type === mark.type)
      const el = doc.createElement(spec?.tagName ?? 'span')
      if (spec?.className) el.className = spec.className
      // 把 mark attrs 中可安全落地的字段写到 DOM（如 link 的 href / title）
      if (typeof mark.attrs?.href === 'string') el.setAttribute('href', mark.attrs.href)
      if (typeof mark.attrs?.title === 'string') el.setAttribute('title', mark.attrs.title)
      el.appendChild(wrapper)
      wrapper = el
    }
    return wrapper
  }

  private createNode(node: ModelNode, path: Path): Node {
    const doc = this.root.ownerDocument
    const spec = this.schema.nodes.find((n) => n.type === node.type)
    const key = pathKey(path)

    // 插件自定义渲染
    if (spec?.render) {
      const children = isElement(node) ? node.children : []
      const rendered = spec.render(node, () =>
        children.map((child, index) => this.reconcileNode(child, [...path, index])),
      )
      if (rendered.nodeType === Node.ELEMENT_NODE) {
        ;(rendered as HTMLElement).setAttribute('data-woffice-path', key)
      }
      return rendered
    }

    const attrs = isText(node) ? undefined : node.attrs
    const tagName = spec?.dynamicTag ? spec.dynamicTag(attrs) : (spec?.tagName ?? 'div')
    const el = doc.createElement(tagName)
    el.setAttribute('data-woffice-path', key)

    if (isVoid(node)) {
      if (node.type === 'image' && typeof node.attrs?.src === 'string') {
        el.setAttribute('src', node.attrs.src)
      }
      return el
    }

    if (isElement(node)) {
      this.reconcileChildren(el, node.children, path)
      this.ensurePlaceholderBr(el, node)
    }
    return el
  }

  /** 空块补 <br> 占位，保证有高度、光标可见可点 */
  private ensurePlaceholderBr(el: HTMLElement, node: ModelNode): void {
    if (el.childNodes.length > 0) return
    const spec = this.schema.nodes.find((n) => n.type === node.type)
    if (spec?.role === 'block') {
      el.appendChild(this.root.ownerDocument.createElement('br'))
    }
  }

  // -------------------------------------------------------------------------
  // 分页（页面模式）
  // -------------------------------------------------------------------------

  /** 块级分页：按页面高度把块分配到不同页面（不拆分块），并加页码 */
  private applyPagination(): void {
    const settings = this.pageSettings
    const contentHeight = settings.pageHeight - settings.marginTop - settings.marginBottom
    const blocks = Array.from(this.root.children) as HTMLElement[]
    const heights = blocks.map((block) => block.offsetHeight)
    this.root.replaceChildren()

    let page = this.createPage()
    let used = 0
    let pageNumber = 1

    const finalizePage = (): void => {
      if (page.childNodes.length === 0) {
        page.remove()
        return
      }
      const number = this.root.ownerDocument.createElement('div')
      number.className = 'woffice-page-number'
      number.textContent = String(pageNumber)
      // 页码只是装饰，不参与编辑
      number.setAttribute('contenteditable', 'false')
      page.appendChild(number)
      this.root.appendChild(page)
      pageNumber++
    }

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]
      const path = block.getAttribute('data-woffice-path') ?? ''
      const isPageBreak = this.types.get(path) === 'page_break'

      if (isPageBreak) {
        if (page.childNodes.length > 0) {
          finalizePage()
          page = this.createPage()
          used = 0
        }
        continue
      }

      const height = heights[i]
      if (used + height > contentHeight && page.childNodes.length > 0) {
        finalizePage()
        page = this.createPage()
        used = 0
      }
      page.appendChild(block)
      used += height
    }
    finalizePage()
  }

  private createPage(): HTMLDivElement {
    const settings = this.pageSettings
    const page = this.root.ownerDocument.createElement('div')
    page.className = 'woffice-page'
    page.style.width = `${settings.pageWidth}px`
    page.style.height = `${settings.pageHeight}px`
    page.style.padding = `${settings.marginTop}px ${settings.marginRight}px ${settings.marginBottom}px ${settings.marginLeft}px`
    return page
  }

  // -------------------------------------------------------------------------
  // 光标 / 选区
  // -------------------------------------------------------------------------

  /** 设置光标到语义位置（路径不存在时向上回退到最近的祖先元素） */
  setCaret(position: Position): void {
    const resolved = this.resolveNode(position)
    if (!resolved) return
    const selection = this.getSelection()
    if (!selection) return
    const range = this.root.ownerDocument.createRange()
    range.setStart(resolved.node, resolved.offset)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  /** 设置选区（anchor / head） */
  setSelection(anchor: Position, head: Position): void {
    const a = this.resolveNode(anchor)
    const h = this.resolveNode(head)
    if (!a || !h) return
    const selection = this.getSelection()
    if (!selection) return
    const range = this.root.ownerDocument.createRange()
    range.setStart(a.node, a.offset)
    range.setEnd(h.node, h.offset)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  /** 把语义位置解析成 DOM 节点 + 偏移 */
  private resolveNode(position: Position): { node: Node; offset: number } | undefined {
    const key = pathKey(position.path)
    const direct = this.domByPath.get(key)
    if (direct) {
      if (direct.nodeType === Node.TEXT_NODE) {
        return { node: direct, offset: Math.min(position.offset, (direct as Text).data.length) }
      }
      // 光标不能落在 void 节点（分割线 / 分页符）上：回退到相邻文本
      if (this.voidPaths.has(key)) {
        const near = this.domTextNear(direct as HTMLElement)
        if (near) return near
      } else {
        return { node: direct, offset: Math.min(position.offset, direct.childNodes.length) }
      }
    }
    let path = position.path
    while (path.length > 0) {
      path = path.slice(0, -1)
      const fallback = this.domByPath.get(pathKey(path))
      if (fallback) return { node: fallback, offset: 0 }
    }
    return { node: this.root, offset: 0 }
  }

  /** 读取当前光标的语义位置 */
  getPosition(): Position | undefined {
    const selection = this.currentSelection()
    if (!selection) return undefined
    const range = selection.getRangeAt(0)
    return this.positionFromDOM(range.startContainer, range.startOffset)
  }

  /** 读取当前选区的语义表示 */
  getSelectionRange(): TextSelection | undefined {
    const selection = this.currentSelection()
    if (!selection) return undefined
    const range = selection.getRangeAt(0)
    const anchor = this.positionFromDOM(range.startContainer, range.startOffset)
    const head = this.positionFromDOM(range.endContainer, range.endOffset)
    if (!anchor || !head) return undefined
    return { type: 'text', anchor, head }
  }

  /** 取语义路径对应的 DOM 文本节点（IME 组合时读取组合结果） */
  getTextAt(path: Path): Text | undefined {
    const node = this.domByPath.get(pathKey(path))
    return node && node.nodeType === Node.TEXT_NODE ? (node as Text) : undefined
  }

  /** 取某块（元素路径）的 DOM 纯文本（空段落 IME 组合时用） */
  getBlockText(path: Path): string {
    return this.domByPath.get(pathKey(path))?.textContent ?? ''
  }

  /** void 节点（分割线等）附近最近的文本位置：优先前一个兄弟的末尾，其次后一个兄弟的开头 */
  private domTextNear(el: HTMLElement): { node: Text; offset: number } | undefined {
    const prev = el.previousElementSibling
    if (prev) {
      const text = findLastTextNode(prev)
      if (text) return { node: text, offset: text.data.length }
    }
    const next = el.nextElementSibling
    if (next) {
      const text = findFirstTextNode(next)
      if (text) return { node: text, offset: 0 }
    }
    return undefined
  }

  private getSelection(): Selection | null {
    const view = this.root.ownerDocument.defaultView
    return view?.getSelection() ?? null
  }

  private currentSelection(): Selection | null {
    const selection = this.getSelection()
    if (!selection || selection.rangeCount === 0) return null
    return selection
  }

  private positionFromDOM(node: Node, offset: number): Position | undefined {
    if (node.nodeType === Node.TEXT_NODE) {
      const path = this.pathByDom.get(node)
      return path ? { path, offset } : undefined
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      const key = el.getAttribute('data-woffice-path')
      if (key !== null) {
        // void 节点（分割线 / 分页符）不能作为光标位置：取相邻文本位置
        if (this.voidPaths.has(key)) {
          const near = this.domTextNear(el)
          if (near) {
            const nearPath = this.pathByDom.get(near.node)
            if (nearPath) return { path: nearPath, offset: near.offset }
          }
          return undefined
        }
        return { path: parsePathKey(key), offset }
      }
      // 无 path 但直接包含块级节点的容器（页面 div / 流式根）：按子节点下标落到相邻块
      const blockChildren = Array.from(el.children).filter((child) =>
        child.hasAttribute('data-woffice-path'),
      )
      if (blockChildren.length > 0) {
        const idx = offset > 0 ? Math.min(offset - 1, blockChildren.length - 1) : 0
        const target = blockChildren[idx] as HTMLElement
        const text = offset > 0 ? findLastTextNode(target) : findFirstTextNode(target)
        if (text) {
          const textPath = this.pathByDom.get(text)
          if (textPath) return { path: textPath, offset: offset > 0 ? text.data.length : 0 }
        }
        const targetKey = target.getAttribute('data-woffice-path')
        if (targetKey !== null) return { path: parsePathKey(targetKey), offset: 0 }
      }
      let current: HTMLElement | null = el.parentElement
      while (current) {
        const k = current.getAttribute('data-woffice-path')
        if (k !== null) {
          const child = el
          const idx = Array.from(current.children).indexOf(child)
          return { path: parsePathKey(k), offset: idx < 0 ? 0 : idx }
        }
        current = current.parentElement
      }
    }
    return undefined
  }
}

/** 深度优先找第一个文本节点 */
function findFirstTextNode(node: Node): Text | undefined {
  if (node.nodeType === Node.TEXT_NODE) return node as Text
  if (node.nodeType === Node.ELEMENT_NODE) {
    for (const child of Array.from((node as HTMLElement).childNodes)) {
      const found = findFirstTextNode(child)
      if (found) return found
    }
  }
  return undefined
}

/** 深度优先找最后一个文本节点 */
function findLastTextNode(node: Node): Text | undefined {
  if (node.nodeType === Node.TEXT_NODE) return node as Text
  if (node.nodeType === Node.ELEMENT_NODE) {
    const children = Array.from((node as HTMLElement).childNodes)
    for (let i = children.length - 1; i >= 0; i--) {
      const found = findLastTextNode(children[i])
      if (found) return found
    }
  }
  return undefined
}

/** 按期望顺序同步父节点的子节点（增 / 删 / 移动） */
function syncChildren(parent: HTMLElement, expected: Node[]): void {
  const set = new Set(expected)
  for (const child of Array.from(parent.childNodes)) {
    if (!set.has(child)) child.remove()
  }
  let previous: Node | null = null
  for (const node of expected) {
    if (previous === null) {
      if (parent.firstChild !== node) parent.insertBefore(node, parent.firstChild)
    } else if (previous.nextSibling !== node) {
      parent.insertBefore(node, previous.nextSibling)
    }
    previous = node
  }
}
