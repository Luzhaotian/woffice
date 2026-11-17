/**
 * docx 适配器：自研 zip + OOXML 的导入 / 导出
 *
 * 导入：.docx → 解析 document.xml / numbering.xml / rels / media → 内部 Document
 * 导出：内部 Document → document.xml + 关系 / 媒体 → 打包 zip → .docx
 */

import type { Document } from '@/model/node'
import { importDocument, type CommentInfo } from '@/convert/docx/import'
import { escapeXml, serializeDocument, type DocxRelationship } from '@/convert/docx/export'
import { NumberingInfo } from '@/convert/docx/numbering'
import { elementsByLocalName, parseXml, REL_NS } from '@/convert/docx/ooxml'
import { ZipReader, ZipWriter } from '@/convert/docx/zip'

export class OoxmlDocxAdapter {
  async import(source: Blob | Uint8Array | ArrayBuffer): Promise<Document> {
    const buffer = source instanceof Blob ? await source.arrayBuffer() : source
    const reader = await ZipReader.parse(buffer)
    const documentXml = reader.getString('word/document.xml')
    if (!documentXml) throw new Error('docx 缺少 word/document.xml')

    const numbering = new NumberingInfo(reader.getString('word/numbering.xml'))
    const rels = parseRels(reader.getString('word/_rels/document.xml.rels') ?? '')
    const comments = parseComments(reader.getString('word/comments.xml') ?? '')
    const media = new Map<string, Uint8Array>()
    for (const [name, entry] of reader.entries) {
      // 关系里的 Target 是相对 word/ 的路径（如 media/image1.png）
      if (name.startsWith('word/media/')) media.set(name.slice('word/'.length), entry.data)
    }
    return importDocument(documentXml, { numbering, rels, media, comments })
  }

  async export(doc: Document): Promise<Blob> {
    const { documentXml, relationships, images, comments } = serializeDocument(doc)
    const zip = new ZipWriter()
    zip.add('[Content_Types].xml', CONTENT_TYPES_XML)
    zip.add('_rels/.rels', PACKAGE_RELS_XML)
    zip.add('word/document.xml', documentXml)
    zip.add('word/styles.xml', STYLES_XML)
    zip.add('word/numbering.xml', NUMBERING_XML)
    zip.add('word/_rels/document.xml.rels', documentRelsXml(relationships))
    if (comments.size > 0) zip.add('word/comments.xml', commentsXml(comments))
    for (const [name, data] of images) zip.add(`word/media/${name}`, data)
    return zip.generate()
  }
}

// ---------------------------------------------------------------------------
// 批注
// ---------------------------------------------------------------------------

export function parseComments(xml: string): Map<string, CommentInfo> {
  const map = new Map<string, CommentInfo>()
  if (!xml) return map
  const dom = parseXml(xml)
  for (const comment of elementsByLocalName(dom, 'comment')) {
    const id = comment.getAttribute('w:id') ?? ''
    const author = comment.getAttribute('w:author') ?? ''
    const paragraphs = elementsByLocalName(comment, 'p')
    const text = paragraphs
      .map((p) =>
        elementsByLocalName(p, 't')
          .map((t) => t.textContent ?? '')
          .join(''),
      )
      .join('\n')
    map.set(id, { id, text, author })
  }
  return map
}

function commentsXml(comments: Map<string, { id: string; text: string; author: string }>): string {
  const items = [...comments.values()]
    .map((comment) => {
      const paragraphs = comment.text
        .split('\n')
        .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`)
        .join('')
      return (
        `<w:comment w:id="${escapeXml(comment.id)}" w:author="${escapeXml(comment.author)}" w:date="">` +
        `${paragraphs || '<w:p/>'}</w:comment>`
      )
    })
    .join('')
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${items}</w:comments>`
  )
}

export async function importDocx(source: Blob | Uint8Array | ArrayBuffer): Promise<Document> {
  return new OoxmlDocxAdapter().import(source)
}

export async function exportDocx(doc: Document): Promise<Blob> {
  return new OoxmlDocxAdapter().export(doc)
}

// ---------------------------------------------------------------------------
// 关系解析 / 生成
// ---------------------------------------------------------------------------

export function parseRels(xml: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!xml) return map
  const dom = parseXml(xml)
  for (const rel of elementsByLocalName(dom, 'Relationship')) {
    map.set(rel.getAttribute('Id') ?? '', rel.getAttribute('Target') ?? '')
  }
  return map
}

function documentRelsXml(relationships: DocxRelationship[]): string {
  const items = relationships
    .map((rel, index) => {
      const type =
        rel.type === 'hyperlink'
          ? 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'
          : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
      const external = rel.type === 'hyperlink' ? ' TargetMode="External"' : ''
      return `<Relationship Id="rId${index + 1}" Type="${type}" Target="${escapeXml(rel.target)}"${external}/>`
    })
    .join('')
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<Relationships xmlns="${REL_NS}">${items}</Relationships>`
  )
}

// ---------------------------------------------------------------------------
// 固定部件
// ---------------------------------------------------------------------------

const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Default Extension="png" ContentType="image/png"/>' +
  '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
  '<Default Extension="gif" ContentType="image/gif"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
  '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' +
  '</Types>'

const PACKAGE_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  `<Relationships xmlns="${REL_NS}">` +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>'

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  `<w:styles xmlns:w="${'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}">` +
  '<w:docDefaults><w:rPrDefault><w:rPr>' +
  '<w:rFonts w:ascii="Calibri" w:eastAsia="宋体" w:hAnsi="Calibri"/>' +
  '<w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>' +
  '<w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>' +
  '<w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/>' +
  '<w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/>' +
  '<w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/>' +
  '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr></w:style>' +
  '</w:styles>'

function numberingLevel(ilvl: number, fmt: string, text: string): string {
  return (
    `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/>` +
    `<w:lvlText w:val="${escapeXml(text)}"/><w:lvlJc w:val="left"/>` +
    '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>'
  )
}

const NUMBERING_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:abstractNum w:abstractNumId="0">' +
  Array.from({ length: 9 }, (_, i) => numberingLevel(i, 'bullet', '•')).join('') +
  '</w:abstractNum>' +
  '<w:abstractNum w:abstractNumId="1">' +
  Array.from({ length: 9 }, (_, i) => numberingLevel(i, 'decimal', `%${i + 1}.`)).join('') +
  '</w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
  '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
  '</w:numbering>'
