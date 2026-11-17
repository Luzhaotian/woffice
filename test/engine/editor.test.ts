import { describe, expect, it } from 'vitest'
import { createDocument, createElement, createText } from '@/model/node'
import { Editor } from '@/editor'
import { ReplaceTextStep } from '@/engine/step'

describe('Editor', () => {
  it('插入文本 + 撤销/重做', () => {
    const editor = new Editor(createDocument([createElement('paragraph', [createText('a')])]))
    editor.insertText([0, 0], 1, 'bc')
    expect(editor.doc).toEqual(createDocument([createElement('paragraph', [createText('abc')])]))
    expect(editor.undo()).toBe(true)
    expect(editor.doc).toEqual(createDocument([createElement('paragraph', [createText('a')])]))
    expect(editor.redo()).toBe(true)
    expect(editor.doc).toEqual(createDocument([createElement('paragraph', [createText('abc')])]))
  })

  it('连续输入合并：一次撤销回退全部', () => {
    const editor = new Editor(createDocument([createElement('paragraph', [createText('')])]))
    editor.insertText([0, 0], 0, 'H')
    editor.insertText([0, 0], 1, 'i')
    expect(editor.doc).toEqual(createDocument([createElement('paragraph', [createText('Hi')])]))
    editor.undo()
    // 空文本节点会被 normalize 删除，得到一个空段落
    expect(editor.doc).toEqual(createDocument([createElement('paragraph')]))
  })

  it('删除文本', () => {
    const editor = new Editor(createDocument([createElement('paragraph', [createText('abc')])]))
    editor.deleteText([0, 0], 1, 3)
    expect(editor.doc).toEqual(createDocument([createElement('paragraph', [createText('a')])]))
    editor.undo()
    expect(editor.doc).toEqual(createDocument([createElement('paragraph', [createText('abc')])]))
  })

  it('结构操作：插入 / 删除段落', () => {
    const editor = new Editor(createDocument([createElement('paragraph', [createText('a')])]))
    editor.insertNodes([], 1, [createElement('paragraph', [createText('b')])])
    expect(editor.doc.children).toHaveLength(2)
    editor.undo()
    expect(editor.doc.children).toHaveLength(1)
  })

  it('选区跟随插入', () => {
    const editor = new Editor(createDocument([createElement('paragraph', [createText('ab')])]))
    const tr = editor.transaction()
    tr.addStep(new ReplaceTextStep([0, 0], 0, 0, 'X', ''))
    editor.dispatch(tr)
    expect(editor.selection).toEqual({
      type: 'text',
      anchor: { path: [0, 0], offset: 1 },
      head: { path: [0, 0], offset: 1 },
    })
  })

  it('setNodeAttrs / setMarks 与撤销', () => {
    const editor = new Editor(createDocument([createElement('heading', [createText('t')], { level: 1 })]))
    editor.setNodeAttrs([0], { level: 3 })
    expect(editor.doc.children[0]).toMatchObject({ type: 'heading', attrs: { level: 3 } })
    editor.undo()
    expect(editor.doc.children[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } })

    editor.setMarks([0, 0], [{ type: 'bold' }])
    expect(editor.doc).toMatchObject({
      children: [{ type: 'heading', children: [{ type: 'text', marks: [{ type: 'bold' }] }] }],
    })
  })
})
