/**
 * docx 导入：OOXML (document.xml) → 内部 Document
 *
 * M4 兼容范围：段落 / 标题 / 列表 / 表格（基础）/ 字符格式 / 链接 / 图片（嵌入）
 */

import type { Attrs, Document, Mark, Node } from '@/model/node'
import {
  createDocument,
  createElement,
  createText,
  createVoid,
  isElement,
  isText,
} from '@/model/node'
import { normalize } from '@/model/normalize'
import {
  child,
  children,
  elementByLocalName,
  elementsByLocalName,
  has,
  parseXml,
  val,
} from '@/convert/docx/ooxml'
import type { NumberingInfo } from '@/convert/docx/numbering'

export interface ImportOptions {
  numbering?: NumberingInfo
  /** rId → 目标（外部链接或 media 路径） */
  rels?: Map<string, string>
  /** media 路径 → 字节内容 */
  media?: Map<string, Uint8Array>
  /** 批注 id → 内容 */
  comments?: Map<string, CommentInfo>
}

export interface CommentInfo {
  id: string
  text: string
  author: string
}

interface ParsedParagraph {
  node: Node
  numbering?: { numId: string; level: number }
}

export function importDocument(xml: string, options: ImportOptions = {}): Document {
  const dom = parseXml(xml)
  const body = elementByLocalName(dom, 'body')
  if (!body) throw new Error('document.xml 缺少 w:body')

  const parsed: ParsedParagraph[] = []
  for (const node of Array.from(body.children)) {
    if (node.localName === 'p') parsed.push(parseParagraph(node, options))
    else if (node.localName === 'tbl') parsed.push({ node: parseTable(node, options) })
  }

  return normalize(createDocument(buildBlocks(parsed, options)))
}

/**
 * 把解析后的块序列组装成文档块：支持多级列表嵌套
 * （按 numId 分组、按 ilvl 决定层级）
 */
function buildBlocks(parsed: ParsedParagraph[], options: ImportOptions): Node[] {
  const result: Node[] = []
  const stack: { numId: string; type: 'bullet_list' | 'ordered_list'; items: Node[] }[] = []
  let lastNumId: string | undefined

  // 关闭到指定层级（保留 0..level 层）；level 传 -1 表示全部关闭
  const closeTo = (level: number): void => {
    while (stack.length > level + 1) {
      const top = stack.pop()!
      const list = createElement(top.type, top.items)
      if (stack.length === 0) {
        result.push(list)
      } else {
        const parent = stack[stack.length - 1]
        const last = parent.items[parent.items.length - 1]
        if (last) parent.items[parent.items.length - 1] = appendChild(last, list)
        else result.push(list)
      }
    }
  }

  for (const block of parsed) {
    if (block.numbering) {
      const { numId, level } = block.numbering
      const type = options.numbering?.typeOf(numId) === 'order' ? 'ordered_list' : 'bullet_list'

      if (lastNumId !== undefined && numId !== lastNumId) {
        closeTo(-1)
        lastNumId = undefined
      }
      lastNumId = numId

      closeTo(level)
      while (stack.length <= level) {
        stack.push({ numId, type, items: [] })
      }
      stack[level].items.push(createElement('list_item', [block.node]))
    } else {
      closeTo(-1)
      lastNumId = undefined
      result.push(block.node)
    }
  }
  closeTo(-1)
  return result
}

function appendChild(item: Node, child: Node): Node {
  if (!isElement(item)) return item
  return { ...item, children: [...item.children, child] }
}

// ---------------------------------------------------------------------------
// 段落
// ---------------------------------------------------------------------------

function parseParagraph(el: Element, options: ImportOptions): ParsedParagraph {
  const pPr = child(el, 'pPr')
  const style = val(pPr, 'pStyle')
  const jc = val(pPr, 'jc')
  const numPr = child(pPr, 'numPr')

  let numbering: { numId: string; level: number } | undefined
  if (numPr) {
    const numId = val(numPr, 'numId') ?? '0'
    const level = Number(val(numPr, 'ilvl') ?? '0')
    numbering = { numId, level }
  }

  const inline: Node[] = []
  const activeComments = new Set<string>()
  let fieldDepth = 0
  let fieldInstr = ''
  let fieldChildren: Node[] = []

  for (const node of Array.from(el.children)) {
    if (node.localName === 'r') {
      const fldChar = child(node, 'fldChar')
      if (fldChar) {
        const type = fldChar.getAttribute('w:fldCharType')
        if (type === 'begin') {
          fieldDepth = 1
          fieldInstr = ''
          fieldChildren = []
          continue
        }
        if (type === 'separate') {
          fieldDepth = 2
          continue
        }
        if (type === 'end') {
          inline.push({ type: 'field', attrs: { instr: fieldInstr }, children: fieldChildren })
          fieldDepth = 0
          continue
        }
      }
      const instrText = child(node, 'instrText')
      if (instrText && fieldDepth >= 1) {
        fieldInstr += instrText.textContent ?? ''
        continue
      }
      if (fieldDepth === 2) {
        // 域结果（separate 与 end 之间）
        fieldChildren.push(...parseRun(node, options, activeComments))
      } else {
        inline.push(...parseRun(node, options, activeComments))
      }
      continue
    }
    if (node.localName === 'fldSimple') {
      inline.push(parseFieldSimple(node, options))
      continue
    }
    if (node.localName === 'hyperlink') {
      inline.push(...parseHyperlink(node, options, activeComments))
      continue
    }
    if (node.localName === 'ins' || node.localName === 'del') {
      // 修订（M7）：w:ins / w:del 包裹的运行
      const type = node.localName === 'ins' ? 'track_insert' : 'track_delete'
      const extraMark: Mark = {
        type,
        attrs: {
          author: node.getAttribute('w:author') ?? '',
          date: node.getAttribute('w:date') ?? '',
        },
      }
      for (const r of children(node, 'r'))
        inline.push(...parseRun(r, options, activeComments, extraMark))
    } else if (node.localName === 'commentRangeStart') {
      const id = node.getAttribute('w:id') ?? ''
      if (id) activeComments.add(id)
    } else if (node.localName === 'commentRangeEnd') {
      activeComments.delete(node.getAttribute('w:id') ?? '')
    }
    // commentReference 本身不渲染
  }

  const attrs: Attrs = {}
  let type = 'paragraph'
  if (style) {
    const heading = /^Heading([1-6])$/i.exec(style) ?? /^标题\s*([1-6])$/.exec(style)
    if (heading) {
      type = 'heading'
      attrs.level = Number(heading[1])
    } else if (style === 'Quote' || style === 'IntenseQuote') {
      type = 'blockquote'
    } else if (style === 'Code') {
      type = 'code_block'
    }
  }
  if (jc) attrs.align = jc

  const node = createElement(type, inline, Object.keys(attrs).length > 0 ? attrs : undefined)
  return { node, numbering }
}

// ---------------------------------------------------------------------------
// 运行 / 行内
// ---------------------------------------------------------------------------

function parseRun(
  r: Element,
  options: ImportOptions,
  activeComments?: Set<string>,
  extraMark?: Mark,
): Node[] {
  const rPr = child(r, 'rPr')
  const marks: Mark[] = []
  if (rPr) {
    if (has(rPr, 'b')) marks.push({ type: 'bold' })
    if (has(rPr, 'i')) marks.push({ type: 'italic' })
    if (has(rPr, 'u')) marks.push({ type: 'underline' })
    if (has(rPr, 'strike')) marks.push({ type: 'strikethrough' })
    const highlight = val(rPr, 'highlight')
    if (highlight && highlight !== 'none')
      marks.push({ type: 'highlight', attrs: { color: highlight } })
    const color = val(rPr, 'color')
    if (color && color !== 'auto') marks.push({ type: 'font_color', attrs: { color } })
    const sz = val(rPr, 'sz')
    if (sz) marks.push({ type: 'font_size', attrs: { size: Number(sz) / 2 } })
  }
  if (extraMark) marks.push(extraMark)

  // 批注标记
  if (activeComments) {
    for (const id of activeComments) {
      const info = options.comments?.get(id)
      marks.push({
        type: 'comment',
        attrs: { id, text: info?.text ?? '', author: info?.author ?? '' },
      })
    }
  }

  const nodes: Node[] = []
  for (const node of Array.from(r.children)) {
    if (node.localName === 't' || node.localName === 'delText') {
      nodes.push(createText(node.textContent ?? '', marks))
    } else if (node.localName === 'br') {
      nodes.push(createVoid('hard_break'))
    } else if (node.localName === 'tab') {
      nodes.push(createText('\t', marks))
    } else if (node.localName === 'drawing' || node.localName === 'pict') {
      const image = parseImage(node, options)
      if (image) nodes.push(image)
    }
  }
  return nodes
}

function parseFieldSimple(el: Element, options: ImportOptions): Node {
  const instr = el.getAttribute('w:instr') ?? ''
  const result: Node[] = []
  for (const r of children(el, 'r')) result.push(...parseRun(r, options))
  return { type: 'field', attrs: { instr }, children: result }
}

function parseHyperlink(el: Element, options: ImportOptions, activeComments?: Set<string>): Node[] {
  const rid = el.getAttribute('r:id') ?? ''
  const href = options.rels?.get(rid)
  const nodes: Node[] = []
  for (const r of children(el, 'r')) {
    for (const run of parseRun(r, options, activeComments)) {
      if (href && isText(run)) {
        nodes.push(createText(run.text, [...(run.marks ?? []), { type: 'link', attrs: { href } }]))
      } else {
        nodes.push(run)
      }
    }
  }
  return nodes
}

function parseImage(node: Element, options: ImportOptions): Node | undefined {
  if (!options.rels || !options.media) return undefined
  const blip = findFirstByLocalName(node, 'blip')
  const embed = blip?.getAttribute('r:embed') ?? blip?.getAttribute('embed')
  if (!embed) return undefined
  const mediaPath = options.rels.get(embed)
  if (!mediaPath) return undefined
  const data = options.media.get(mediaPath)
  if (!data) return undefined

  const ext = mediaPath.split('.').pop()?.toLowerCase() ?? 'png'
  const mime =
    ext === 'jpeg' || ext === 'jpg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : 'image/png'
  const attrs: Attrs = { src: `data:${mime};base64,${uint8ToBase64(data)}` }

  // 从 wp:extent 读回尺寸（EMU → 像素）
  const extent = findFirstByLocalName(node, 'extent')
  const cx = extent?.getAttribute('cx')
  const cy = extent?.getAttribute('cy')
  if (cx) attrs.width = Math.round(Number(cx) / EMU_PER_PIXEL)
  if (cy) attrs.height = Math.round(Number(cy) / EMU_PER_PIXEL)

  return { type: 'image', void: true, attrs }
}

const EMU_PER_PIXEL = 9525

function findFirstByLocalName(root: Element, name: string): Element | undefined {
  return elementsByLocalName(root, name)[0]
}

function uint8ToBase64(data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i])
  return btoa(binary)
}

// ---------------------------------------------------------------------------
// 表格
// ---------------------------------------------------------------------------

interface CellInfo {
  children: Node[]
  colspan: number
  vMerge: 'restart' | 'continue' | undefined
  rowspan: number
}

function parseTable(tbl: Element, options: ImportOptions): Node {
  const grid: CellInfo[][] = []
  for (const tr of children(tbl, 'tr')) {
    const row: CellInfo[] = []
    for (const tc of children(tr, 'tc')) {
      const tcPr = child(tc, 'tcPr')
      const colspan = Number(val(tcPr, 'gridSpan') ?? '1')
      // w:vMerge 不带 w:val 时默认是"继续"（continue）
      const vMergeEl = child(tcPr, 'vMerge')
      const vMerge = vMergeEl
        ? (vMergeEl.getAttribute('w:val') ?? vMergeEl.getAttribute('val')) === 'restart'
          ? 'restart'
          : 'continue'
        : undefined
      const paragraphs: Node[] = []
      for (const node of Array.from(tc.children)) {
        if (node.localName === 'p') paragraphs.push(parseParagraph(node, options).node)
      }
      row.push({
        children: paragraphs.length > 0 ? paragraphs : [createElement('paragraph')],
        colspan,
        vMerge,
        rowspan: 1,
      })
    }
    grid.push(row)
  }

  // 计算每个单元格的起始列（考虑横向合并）
  const colPositions: number[][] = grid.map((row) => {
    let col = 0
    return row.map((cell) => {
      const start = col
      col += cell.colspan
      return start
    })
  })

  // 计算纵向合并（vMerge）的 rowspan，并标记被合并的单元格
  const skipped = new Set<string>()
  for (let r = 0; r < grid.length; r++) {
    for (let i = 0; i < grid[r].length; i++) {
      const cell = grid[r][i]
      if (cell.vMerge !== 'restart') continue
      const startCol = colPositions[r][i]
      let rowspan = 1
      for (let rr = r + 1; rr < grid.length; rr++) {
        const idx = colPositions[rr].indexOf(startCol)
        if (idx === -1) break
        const below = grid[rr][idx]
        if (below.vMerge !== 'continue') break
        rowspan++
        skipped.add(`${rr},${idx}`)
      }
      cell.rowspan = rowspan
    }
  }

  const rows = grid.map((row, r) => {
    const cells: Node[] = []
    for (let i = 0; i < row.length; i++) {
      if (skipped.has(`${r},${i}`)) continue
      const cell = row[i]
      const attrs: Attrs = {}
      if (cell.colspan > 1) attrs.colspan = cell.colspan
      if (cell.rowspan > 1) attrs.rowspan = cell.rowspan
      cells.push(
        createElement(
          'table_cell',
          cell.children,
          Object.keys(attrs).length > 0 ? attrs : undefined,
        ),
      )
    }
    return createElement('table_row', cells)
  })
  return createElement('table', rows)
}
