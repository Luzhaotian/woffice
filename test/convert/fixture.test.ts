// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { isText, type Node } from '@/model/node'
import { importDocx } from '@/convert/docx/index'

describe('fixture：rich.docx', () => {
  it('导入并保留标题 / 列表 / 表格 / 批注 / 域', async () => {
    const bytes = await readFile('test/fixtures/rich.docx')
    const doc = await importDocx(bytes)

    expect(doc.children.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'bullet_list',
      'table',
      'paragraph',
      'paragraph',
    ])

    // 标题
    expect(doc.children[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } })

    // 字符样式
    const firstParagraph = doc.children[1]
    expect(JSON.stringify(firstParagraph)).toContain('"type":"bold"')
    expect(JSON.stringify(firstParagraph)).toContain('"type":"italic"')

    // 嵌套列表
    const list = doc.children[2]
    expect(list).toMatchObject({ type: 'bullet_list' })
    const item = (list as { children: { children: unknown[] }[] }).children[0]
    expect(item.children.some((c) => (c as { type: string }).type === 'bullet_list')).toBe(true)

    // 合并单元格
    const table = doc.children[3]
    expect(JSON.stringify(table)).toContain('"rowspan":2')
    expect(JSON.stringify(table)).toContain('"colspan":2')

    // 批注
    const commentParagraph = doc.children[4]
    expect(JSON.stringify(commentParagraph)).toContain('"type":"comment"')

    // 域（行内节点，位于段落内）
    expect(JSON.stringify(doc.children[5])).toContain('"type":"field"')
  })

  it('纯文本内容正确', async () => {
    const bytes = await readFile('test/fixtures/rich.docx')
    const doc = await importDocx(bytes)
    const texts: string[] = []
    const collect = (node: unknown): void => {
      const n = node as { type: string; text?: string; children?: unknown[] }
      if (n.type === 'text') texts.push(n.text ?? '')
      for (const child of n.children ?? []) collect(child)
    }
    for (const child of doc.children) collect(child)
    expect(texts.join('')).toContain('季度报告')
    expect(texts.join('')).toContain('需要复核')
  })

  it('无 mark 的文本节点不被误加标记', async () => {
    const bytes = await readFile('test/fixtures/rich.docx')
    const doc = await importDocx(bytes)
    let checked = 0
    const walk = (node: unknown): void => {
      const n = node as { type: string; children?: unknown[] }
      if (isText(node as Node)) checked++
      for (const child of n.children ?? []) walk(child)
    }
    for (const child of doc.children) walk(child)
    expect(checked).toBeGreaterThan(0)
  })
})
