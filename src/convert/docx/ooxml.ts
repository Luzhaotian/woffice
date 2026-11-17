/**
 * OOXML XML 辅助
 */

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
export const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
export const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'

export function parseXml(text: string): Document {
  const dom = new DOMParser().parseFromString(text, 'application/xml')
  if (dom.getElementsByTagName('parsererror').length > 0) {
    throw new Error('XML 解析失败')
  }
  return dom
}

export function createXmlDocument(rootName: string): Document {
  return document.implementation.createDocument(W_NS, rootName, null)
}

/** 按 localName 深度遍历（部分 DOM 实现不支持 getElementsByTagNameNS） */
export function elementsByLocalName(root: Document | Element, name: string): Element[] {
  const result: Element[] = []
  const visit = (el: Element): void => {
    if (el.localName === name) result.push(el)
    for (const node of Array.from(el.children)) visit(node)
  }
  if (root.nodeType === 9) {
    for (const node of Array.from(root.children)) visit(node)
  } else {
    visit(root as Element)
  }
  return result
}

export function elementByLocalName(root: Document | Element, name: string): Element | undefined {
  return elementsByLocalName(root, name)[0]
}

export function child(el: Element | undefined, name: string): Element | undefined {
  if (!el) return undefined
  for (const node of Array.from(el.children)) {
    if (node.localName === name) return node
  }
  return undefined
}

export function children(el: Element | undefined, name: string): Element[] {
  if (!el) return []
  return Array.from(el.children).filter((node) => node.localName === name)
}

/** 读取 w:xxx 子元素的 w:val 属性 */
export function val(el: Element | undefined, name: string): string | undefined {
  if (!el) return undefined
  const node = child(el, name)
  if (!node) return undefined
  return node.getAttribute('w:val') ?? node.getAttribute('val') ?? undefined
}

export function has(el: Element | undefined, name: string): boolean {
  return !!el && !!child(el, name)
}

/** 创建带 w: 命名空间的元素 */
export function w(el: Document, name: string, attrs?: Record<string, string>): Element {
  const node = el.createElementNS(W_NS, `w:${name}`)
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(`w:${key}`, value)
  }
  return node
}

/** 序列化 XML（带声明头） */
export function serializeXml(dom: Document): string {
  const body = new XMLSerializer().serializeToString(dom)
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`
}
