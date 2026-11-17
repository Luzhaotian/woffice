// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type { Document } from '@/model/node'
import { createDocument, createElement, createText, createVoid } from '@/model/node'
import { normalize } from '@/model/normalize'
import { exportDocx, importDocx } from '@/convert/docx/index'
import { ZipReader, ZipWriter, utf8Encode } from '@/convert/docx/zip'
import { parseXml } from '@/convert/docx/ooxml'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

describe('docx 导入导出', () => {
  it('round-trip：段落 + 标题 + 字符样式', async () => {
    const doc = normalize(
      createDocument([
        createElement('heading', [createText('标题')], { level: 2 }),
        createElement('paragraph', [
          createText('普通段落，'),
          createText('加粗', [{ type: 'bold' }]),
          createText('和'),
          createText('斜体', [{ type: 'italic' }]),
          createText('。'),
        ]),
        createElement('paragraph', [createText('第二段')], { align: 'center' }),
      ]),
    )
    const imported = await importDocx(await exportDocx(doc))
    expect(imported).toEqual(doc)
  })

  it('round-trip：无序列表', async () => {
    const doc = normalize(
      createDocument([
        createElement('bullet_list', [
          createElement('list_item', [createElement('paragraph', [createText('第一项')])]),
          createElement('list_item', [createElement('paragraph', [createText('第二项')])]),
        ]),
      ]),
    )
    const imported = await importDocx(await exportDocx(doc))
    expect(imported).toEqual(doc)
  })

  it('round-trip：有序列表', async () => {
    const doc = normalize(
      createDocument([
        createElement('ordered_list', [
          createElement('list_item', [createElement('paragraph', [createText('第一步')])]),
        ]),
      ]),
    )
    const imported = await importDocx(await exportDocx(doc))
    expect(imported).toEqual(doc)
  })

  it('round-trip：表格', async () => {
    const doc = normalize(
      createDocument([
        createElement('table', [
          createElement('table_row', [
            createElement('table_cell', [createElement('paragraph', [createText('A1')])]),
            createElement('table_cell', [createElement('paragraph', [createText('B1')])]),
          ]),
          createElement('table_row', [
            createElement('table_cell', [createElement('paragraph', [createText('A2')])]),
            createElement('table_cell', [createElement('paragraph', [createText('B2')])]),
          ]),
        ]),
      ]),
    )
    const imported = await importDocx(await exportDocx(doc))
    expect(imported).toEqual(doc)
  })

  it('round-trip：多级列表（嵌套）', async () => {
    const doc = normalize(
      createDocument([
        createElement('bullet_list', [
          createElement('list_item', [
            createElement('paragraph', [createText('一级')]),
            createElement('bullet_list', [
              createElement('list_item', [createElement('paragraph', [createText('二级 A')])]),
              createElement('list_item', [createElement('paragraph', [createText('二级 B')])]),
            ]),
          ]),
        ]),
      ]),
    )
    const imported = await importDocx(await exportDocx(doc))
    expect(imported).toEqual(doc)
  })

  it('round-trip：合并单元格（横向 + 纵向）', async () => {
    const doc = normalize(
      createDocument([
        createElement('table', [
          createElement('table_row', [
            createElement('table_cell', [createElement('paragraph', [createText('跨两列')])], { colspan: 2 }),
          ]),
          createElement('table_row', [
            createElement('table_cell', [createElement('paragraph', [createText('跨行')])], { rowspan: 2 }),
            createElement('table_cell', [createElement('paragraph', [createText('右 1')])]),
          ]),
          createElement('table_row', [createElement('table_cell', [createElement('paragraph', [createText('右 2')])])]),
        ]),
      ]),
    )
    const imported = await importDocx(await exportDocx(doc))
    expect(imported).toEqual(doc)
  })

  it('导入多级列表 XML', async () => {
    const documentXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<w:document xmlns:w="${W_NS}"><w:body>` +
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>一级</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>二级</w:t></w:r></w:p>' +
      '</w:body></w:document>'
    const writer = new ZipWriter()
    writer.add('word/document.xml', documentXml)
    const doc = await importDocx(await writer.generate())
    expect(doc).toEqual(
      normalize(
        createDocument([
          createElement('bullet_list', [
            createElement('list_item', [
              createElement('paragraph', [createText('一级')]),
              createElement('bullet_list', [
                createElement('list_item', [createElement('paragraph', [createText('二级')])]),
              ]),
            ]),
          ]),
        ]),
      ),
    )
  })

  it('round-trip：图片（data URL）', async () => {
    const png = utf8Encode('fake-png-bytes')
    const src = `data:image/png;base64,${btoa(String.fromCharCode(...png))}`
    const doc = normalize(
      createDocument([createElement('paragraph', [createVoid('image', { src, width: 10, height: 10 })])]),
    )
    const blob = await exportDocx(doc)
    const reader = await ZipReader.parse(await blob.arrayBuffer())
    expect(reader.entries.has('word/media/image1.png')).toBe(true)
    const imported = await importDocx(blob)
    expect(imported).toEqual(doc)
  })

  it('导出包含必要部件，且 document.xml 是合法 XML', async () => {
    const blob = await exportDocx(createDocument([createElement('paragraph', [createText('a')])]))
    const reader = await ZipReader.parse(await blob.arrayBuffer())
    expect(reader.getString('word/document.xml')).toContain('<w:p>')
    expect(reader.getString('[Content_Types].xml')).toBeDefined()
    expect(reader.getString('_rels/.rels')).toBeDefined()
    expect(reader.getString('word/styles.xml')).toBeDefined()
    expect(reader.getString('word/numbering.xml')).toBeDefined()
    expect(reader.getString('word/_rels/document.xml.rels')).toBeDefined()
    // 能解析说明 XML 合法
    parseXml(reader.getString('word/document.xml')!)
  })

  it('导入手工构造的 docx（含样式与列表）', async () => {
    const documentXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<w:document xmlns:w="${W_NS}"><w:body>` +
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>标题</w:t></w:r></w:p>' +
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>加粗</w:t></w:r></w:p>' +
      '</w:body></w:document>'
    const writer = new ZipWriter()
    writer.add('word/document.xml', documentXml)
    const doc = await importDocx(await writer.generate())

    expect(doc).toEqual(
      normalize(
        createDocument([
          createElement('heading', [createText('标题')], { level: 1 }),
          createElement('paragraph', [createText('加粗', [{ type: 'bold' }])]),
        ]),
      ),
    )
  })

  it('导入超链接', async () => {
    const documentXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>` +
      '<w:p><w:hyperlink r:id="rId1"><w:r><w:t>示例</w:t></w:r></w:hyperlink></w:p>' +
      '</w:body></w:document>'
    const rels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>' +
      '</Relationships>'
    const writer = new ZipWriter()
    writer.add('word/document.xml', documentXml)
    writer.add('word/_rels/document.xml.rels', rels)
    const doc = await importDocx(await writer.generate())
    expect(doc).toEqual(
      normalize(
        createDocument([
          createElement('paragraph', [
            createText('示例', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
          ]),
        ]),
      ),
    )
  })

  it('round-trip：批注', async () => {
    const doc = normalize(
      createDocument([
        createElement('paragraph', [
          createText('这是一段'),
          createText('带批注', [{ type: 'comment', attrs: { id: '0', text: '这里需要修改', author: '张三' } }]),
          createText('的文字'),
        ]),
      ]),
    )
    const imported = await importDocx(await exportDocx(doc))
    expect(imported).toEqual(doc)
  })

  it('导入批注（comments.xml + 范围标记）', async () => {
    const documentXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<w:document xmlns:w="${W_NS}"><w:body><w:p>` +
      '<w:r><w:t>这是一段</w:t></w:r>' +
      '<w:commentRangeStart w:id="0"/>' +
      '<w:r><w:t>带批注</w:t></w:r>' +
      '<w:commentRangeEnd w:id="0"/>' +
      '<w:r><w:commentReference w:id="0"/></w:r>' +
      '</w:p></w:body></w:document>'
    const commentsXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<w:comments xmlns:w="${W_NS}">` +
      '<w:comment w:id="0" w:author="张三"><w:p><w:r><w:t>这里需要修改</w:t></w:r></w:p></w:comment>' +
      '</w:comments>'
    const writer = new ZipWriter()
    writer.add('word/document.xml', documentXml)
    writer.add('word/comments.xml', commentsXml)
    const doc = await importDocx(await writer.generate())
    expect(doc).toEqual(
      normalize(
        createDocument([
          createElement('paragraph', [
            createText('这是一段'),
            createText('带批注', [{ type: 'comment', attrs: { id: '0', text: '这里需要修改', author: '张三' } }]),
          ]),
        ]),
      ),
    )
  })

  it('round-trip：修订（w:ins / w:del）', async () => {
    const doc = normalize(
      createDocument([
        createElement('paragraph', [
          createText('原文'),
          createText('新增', [{ type: 'track_insert', attrs: { author: '李四', date: '' } }]),
          createText('删除', [{ type: 'track_delete', attrs: { author: '李四', date: '' } }]),
        ]),
      ]),
    )
    const imported = await importDocx(await exportDocx(doc))
    expect(imported).toEqual(doc)
  })

  it('导入修订（w:ins / w:del）', async () => {
    const documentXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<w:document xmlns:w="${W_NS}"><w:body><w:p>` +
      '<w:r><w:t>原文</w:t></w:r>' +
      '<w:ins w:author="李四"><w:r><w:t>新增</w:t></w:r></w:ins>' +
      '<w:del w:author="李四"><w:r><w:delText>删除</w:delText></w:r></w:del>' +
      '</w:p></w:body></w:document>'
    const writer = new ZipWriter()
    writer.add('word/document.xml', documentXml)
    const doc = await importDocx(await writer.generate())
    expect(doc).toEqual(
      normalize(
        createDocument([
          createElement('paragraph', [
            createText('原文'),
            createText('新增', [{ type: 'track_insert', attrs: { author: '李四', date: '' } }]),
            createText('删除', [{ type: 'track_delete', attrs: { author: '李四', date: '' } }]),
          ]),
        ]),
      ),
    )
  })

  it('round-trip：域（fldSimple，含引号 instr）', async () => {
    const doc = normalize(
      createDocument([
        createElement('paragraph', [
          { type: 'field', attrs: { instr: 'TOC \\o "1-3"' }, children: [createText('目录')] },
        ]),
      ]),
    )
    const imported = await importDocx(await exportDocx(doc))
    expect(imported).toEqual(doc)
  })

  it('导入域（fldSimple）', async () => {
    const documentXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<w:document xmlns:w="${W_NS}"><w:body>` +
      '<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>' +
      '</w:body></w:document>'
    const writer = new ZipWriter()
    writer.add('word/document.xml', documentXml)
    const doc = await importDocx(await writer.generate())
    expect(doc).toEqual(
      normalize(
        createDocument([
          createElement('paragraph', [
            { type: 'field', attrs: { instr: 'PAGE' }, children: [createText('1')] },
          ]),
        ]),
      ),
    )
  })

  it('导入域（fldChar 序列）', async () => {
    const documentXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<w:document xmlns:w="${W_NS}"><w:body>` +
      '<w:p>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText>TOC</w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>结果</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '</w:p></w:body></w:document>'
    const writer = new ZipWriter()
    writer.add('word/document.xml', documentXml)
    const doc = await importDocx(await writer.generate())
    expect(doc).toEqual(
      normalize(
        createDocument([
          createElement('paragraph', [
            { type: 'field', attrs: { instr: 'TOC' }, children: [createText('结果')] },
          ]),
        ]),
      ),
    )
  })

  it('缺 word/document.xml 时抛错', async () => {
    const writer = new ZipWriter()
    writer.add('other.txt', 'x')
    await expect(importDocx(await writer.generate())).rejects.toThrow()
  })
})

// 供测试断言使用的类型
export type { Document }
