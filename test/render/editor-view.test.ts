// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { Editor } from '@/editor'
import { createDocument, createElement, createText } from '@/model/node'
import type { EditorView } from '@/render/view'

let container: HTMLElement
let editor: Editor
let view: EditorView
let content: HTMLElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  editor = new Editor(createDocument([createElement('paragraph', [createText('Hello')])]))
  view = editor.mount(container)
  content = container.querySelector('.woffice-editor-content') as HTMLElement
  content.focus()
})

function type(text: string, inputType = 'insertText'): void {
  const event = new InputEvent('beforeinput', {
    inputType,
    data: text,
    bubbles: true,
    cancelable: true,
  })
  content.dispatchEvent(event)
}

describe('EditorView 输入闭环', () => {
  it('挂载后渲染文档', () => {
    expect(content.textContent).toBe('Hello')
    expect(content.isContentEditable).toBe(true)
  })

  it('输入文本：文档更新 + 光标跟随', () => {
    view.renderer.setCaret({ path: [0, 0], offset: 5 })
    type(' World')
    expect(editor.doc).toEqual(
      createDocument([createElement('paragraph', [createText('Hello World')])]),
    )
    expect(view.renderer.getPosition()).toEqual({ path: [0, 0], offset: 11 })
  })

  it('退格删除', () => {
    view.renderer.setCaret({ path: [0, 0], offset: 5 })
    type('', 'deleteContentBackward')
    expect(editor.doc).toEqual(createDocument([createElement('paragraph', [createText('Hell')])]))
  })

  it('回车拆分段落', () => {
    view.renderer.setCaret({ path: [0, 0], offset: 5 })
    type('', 'insertParagraph')
    expect(editor.doc).toEqual(
      createDocument([
        createElement('paragraph', [createText('Hello')]),
        createElement('paragraph'),
      ]),
    )
  })

  it('选区加粗（formatBold）', () => {
    const textNode = content.querySelector('p')?.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 5)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    // 格式命令统一走 keymap（keydown），不再走 beforeinput
    content.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }),
    )
    expect(editor.doc).toEqual(
      createDocument([createElement('paragraph', [createText('Hello', [{ type: 'bold' }])])]),
    )
  })

  it('修订模式：新输入带 track_insert 标记', () => {
    editor.trackChanges = true
    view.renderer.setCaret({ path: [0, 0], offset: 5 })
    type('X')
    expect(editor.doc).toEqual(
      createDocument([
        createElement('paragraph', [
          createText('Hello'),
          createText('X', [{ type: 'track_insert', attrs: { author: '我', date: '' } }]),
        ]),
      ]),
    )
  })

  it('DOM 选区变化同步到模型选区', () => {
    const textNode = content.querySelector('p')?.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 2)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    document.dispatchEvent(new Event('selectionchange'))

    expect(editor.selection).toEqual({
      type: 'text',
      anchor: { path: [0, 0], offset: 2 },
      head: { path: [0, 0], offset: 2 },
    })
  })

  it('撤销 / 重做（Ctrl+Z / Ctrl+Y）', () => {
    view.renderer.setCaret({ path: [0, 0], offset: 5 })
    type(' World')
    expect(editor.doc).toEqual(
      createDocument([createElement('paragraph', [createText('Hello World')])]),
    )

    content.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
    )
    expect(editor.doc).toEqual(createDocument([createElement('paragraph', [createText('Hello')])]))

    content.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true }),
    )
    expect(editor.doc).toEqual(
      createDocument([createElement('paragraph', [createText('Hello World')])]),
    )
  })
})
