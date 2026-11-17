/**
 * docx 导出：内部 Document → OOXML (document.xml)
 *
 * 生成字符串形式的 XML（便于精确控制命名空间与结构），文本做 XML 转义。
 * 同时收集 hyperlink / image 关系，供打包成 zip。
 */

import type { Document, Mark, Node } from '@/model/node'
import { isElement, isText, isVoid } from '@/model/node'
import { R_NS, W_NS } from '@/convert/docx/ooxml'

export interface DocxRelationship {
  type: 'hyperlink' | 'image'
  target: string
}

export interface ExportResult {
  documentXml: string
  relationships: DocxRelationship[]
  /** media 文件名 → 字节内容 */
  images: Map<string, Uint8Array>
  /** 批注 id → 内容 */
  comments: Map<string, { id: string; text: string; author: string }>
}

const EMU_PER_PIXEL = 9525

export function serializeDocument(doc: Document): ExportResult {
  const serializer = new Serializer()
  const body = doc.children.map((block) => serializer.block(block)).join('')
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${body}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>` +
    `</w:body></w:document>`
  return {
    documentXml: xml,
    relationships: serializer.relationships,
    images: serializer.images,
    comments: serializer.comments,
  }
}

class Serializer {
  readonly relationships: DocxRelationship[] = []
  readonly images = new Map<string, Uint8Array>()
  readonly comments = new Map<string, { id: string; text: string; author: string }>()

  block(node: Node): string {
    if (isElement(node) && (node.type === 'bullet_list' || node.type === 'ordered_list')) {
      return this.list(node, node.type === 'bullet_list' ? '1' : '2', 0)
    }
    if (isElement(node) && node.type === 'table') return this.table(node)
    if (!isText(node) && node.type === 'horizontal_rule') {
      return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>'
    }
    if (isVoid(node) && node.type === 'image') return `<w:p>${this.image(node)}</w:p>`
    return this.paragraph(node)
  }

  /** 递归序列化列表（支持多级嵌套） */
  private list(node: Node, numId: string, depth: number): string {
    if (!isElement(node)) return ''
    let xml = ''
    for (const item of node.children) {
      if (!isElement(item) || item.type !== 'list_item') continue
      for (const child of item.children) {
        if (child.type === 'paragraph') xml += this.paragraph(child, numId, depth)
        else if (child.type === 'bullet_list' || child.type === 'ordered_list') {
          xml += this.list(child, numId, depth + 1)
        }
      }
    }
    return xml
  }

  private paragraph(node: Node, numId?: string, level = 0): string {
    const attrs = attrsOf(node)
    const pPr: string[] = []
    if (node.type === 'heading') pPr.push(`<w:pStyle w:val="Heading${attrs?.level ?? 1}"/>`)
    else if (node.type === 'blockquote') pPr.push('<w:pStyle w:val="Quote"/>')
    else if (node.type === 'code_block') pPr.push('<w:pStyle w:val="Code"/>')
    const align = attrs?.align
    if (align) pPr.push(`<w:jc w:val="${align}"/>`)
    if (numId) pPr.push(`<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`)
    const pPrXml = pPr.length > 0 ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''
    return `<w:p>${pPrXml}${this.inline(isElement(node) ? node.children : [])}</w:p>`
  }

  private inline(children: Node[]): string {
    let xml = ''
    for (const child of children) {
      if (isText(child)) {
        const marks = child.marks ?? []
        const link = marks.find((mark) => mark.type === 'link')
        const comment = marks.find((mark) => mark.type === 'comment')
        const track = marks.find(
          (mark) => mark.type === 'track_insert' || mark.type === 'track_delete',
        )
        const run = `<w:r>${this.rPr(marks)}<w:t xml:space="preserve">${escapeXml(child.text)}</w:t></w:r>`

        if (comment) {
          const id = String(comment.attrs?.id ?? '0')
          this.comments.set(id, {
            id,
            text: String(comment.attrs?.text ?? ''),
            author: String(comment.attrs?.author ?? ''),
          })
          xml += `<w:commentRangeStart w:id="${id}"/>${run}<w:commentRangeEnd w:id="${id}"/>`
          xml += `<w:r><w:commentReference w:id="${id}"/></w:r>`
        } else if (track) {
          const tag = track.type === 'track_insert' ? 'ins' : 'del'
          const author = escapeXml(String(track.attrs?.author ?? ''))
          const date = escapeXml(String(track.attrs?.date ?? ''))
          xml += `<w:${tag} w:author="${author}" w:date="${date}">${run}</w:${tag}>`
        } else if (link) {
          const href = (link.attrs?.href as string) ?? ''
          xml += `<w:hyperlink r:id="${this.addRelationship('hyperlink', href)}">${run}</w:hyperlink>`
        } else {
          xml += run
        }
      } else if (child.type === 'hard_break') {
        xml += '<w:r><w:br/></w:r>'
      } else if (child.type === 'image') {
        xml += `<w:r>${this.image(child)}</w:r>`
      } else if (child.type === 'field') {
        const instr = escapeXml(String(attrsOf(child)?.instr ?? ''))
        const result = this.inline(isElement(child) ? child.children : [])
        xml += `<w:fldSimple w:instr="${instr}">${result || '<w:r><w:t/></w:r>'}</w:fldSimple>`
      } else if (isElement(child)) {
        xml += this.inline(child.children)
      }
    }
    return xml
  }

  private rPr(marks?: Mark[]): string {
    const parts: string[] = []
    for (const mark of marks ?? []) {
      switch (mark.type) {
        case 'bold':
          parts.push('<w:b/>')
          break
        case 'italic':
          parts.push('<w:i/>')
          break
        case 'underline':
          parts.push('<w:u w:val="single"/>')
          break
        case 'strikethrough':
          parts.push('<w:strike/>')
          break
        case 'highlight':
          parts.push(`<w:highlight w:val="${mark.attrs?.color ?? 'yellow'}"/>`)
          break
        case 'font_color':
          parts.push(`<w:color w:val="${mark.attrs?.color ?? '000000'}"/>`)
          break
        case 'font_size':
          parts.push(`<w:sz w:val="${Math.round((mark.attrs?.size as number) ?? 12) * 2}"/>`)
          break
        // comment / track_* 是结构性标记，不参与 rPr
        default:
          break
      }
    }
    return parts.length > 0 ? `<w:rPr>${parts.join('')}</w:rPr>` : ''
  }

  private table(table: Node): string {
    if (!isElement(table)) return ''
    const rows = table.children.filter((row) => isElement(row))
    const continuation = '<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>'

    // 列 → 被上方 rowspan 占用到的行号
    const occupiedUntil = new Map<number, number>()

    const xml = rows
      .map((row, r) => {
        let cellsXml = ''
        let col = 0
        for (const cell of row.children) {
          if (!isElement(cell)) continue
          const attrs = attrsOf(cell)
          const colspan = (attrs?.colspan as number) ?? 1
          const rowspan = (attrs?.rowspan as number) ?? 1

          // 上方 rowspan 占用的列 → 补延续格
          while ((occupiedUntil.get(col) ?? -1) >= r) {
            cellsXml += continuation
            col++
          }

          const tcPr: string[] = ['<w:tcW w:w="0" w:type="auto"/>']
          if (colspan > 1) tcPr.push(`<w:gridSpan w:val="${colspan}"/>`)
          if (rowspan > 1) tcPr.push('<w:vMerge w:val="restart"/>')

          const paragraphs = cell.children.map((p) => this.paragraph(p)).join('')
          cellsXml += `<w:tc><w:tcPr>${tcPr.join('')}</w:tcPr>${paragraphs || '<w:p/>'}</w:tc>`

          if (rowspan > 1) {
            for (let c = col; c < col + colspan; c++) occupiedUntil.set(c, r + rowspan - 1)
          }
          col += colspan
        }

        // 行尾仍被占用的列
        const maxOccupied = Math.max(
          -1,
          ...[...occupiedUntil.entries()]
            .filter(([c, until]) => until >= r && c >= col)
            .map(([c]) => c),
        )
        for (let c = col; c <= maxOccupied; c++) cellsXml += continuation

        return `<w:tr>${cellsXml}</w:tr>`
      })
      .join('')
    const borders =
      '<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
      '<w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
      '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
      '<w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
    return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr>${xml}</w:tbl>`
  }

  private image(image: Node): string {
    const attrs = attrsOf(image)
    const src = (attrs?.src as string) ?? ''
    const data = dataUrlToBytes(src)
    if (!data) return ''
    const name = `image${this.images.size + 1}.png`
    this.images.set(name, data)
    const rid = this.addRelationship('image', `media/${name}`)
    const width = (attrs?.width as number) || 100
    const height = (attrs?.height as number) || 100
    const cx = width * EMU_PER_PIXEL
    const cy = height * EMU_PER_PIXEL
    return (
      '<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${this.images.size}" name="${name}"/>` +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<pic:nvPicPr><pic:cNvPr id="${this.images.size}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>'
    )
  }

  private addRelationship(type: 'hyperlink' | 'image', target: string): string {
    this.relationships.push({ type, target })
    return `rId${this.relationships.length}`
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function attrsOf(node: Node): Record<string, unknown> | undefined {
  return isText(node) ? undefined : node.attrs
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function dataUrlToBytes(dataUrl: string): Uint8Array | undefined {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
  if (!match) return undefined
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
