// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createDocument, createElement, createText, createVoid } from '@/model/node'
import { Renderer } from '@/render/renderer'

let container: HTMLElement
let renderer: Renderer

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  renderer = new Renderer(container)
})

describe('Renderer', () => {
  it('渲染文档结构与 path 标记', () => {
    const doc = createDocument([
      createElement('paragraph', [createText('Hello'), createText(' World', [{ type: 'bold' }])]),
      createElement('heading', [createText('Title')], { level: 2 }),
    ])
    renderer.render(doc)

    const p = container.children[0]
    expect(p.tagName).toBe('P')
    expect(p.getAttribute('data-woffice-path')).toBe('0')
    expect(p.textContent).toBe('Hello World')
    expect(p.querySelector('strong')?.textContent).toBe(' World')

    const h2 = container.children[1]
    expect(h2.tagName).toBe('H2')
    expect(h2.textContent).toBe('Title')
  })

  it('marks 嵌套渲染', () => {
    const doc = createDocument([
      createElement('paragraph', [createText('x', [{ type: 'bold' }, { type: 'italic' }])]),
    ])
    renderer.render(doc)
    // marks 按顺序向外包裹：bold 先 → strong，italic 后 → em 包在外面
    expect(container.querySelector('em strong')?.textContent).toBe('x')
  })

  it('空块插入 br，保证可编辑', () => {
    renderer.render(createDocument([createElement('paragraph')]))
    expect(container.children[0].innerHTML).toBe('<br>')
  })

  it('void 节点渲染', () => {
    const doc = createDocument([
      createElement('paragraph', [createText('a'), createVoid('hard_break'), createText('b')]),
    ])
    renderer.render(doc)
    expect(container.querySelector('br')).not.toBeNull()
  })

  it('setCaret / getPosition 往返', () => {
    const doc = createDocument([createElement('paragraph', [createText('abc')])])
    renderer.render(doc)
    renderer.setCaret({ path: [0, 0], offset: 2 })
    expect(renderer.getPosition()).toEqual({ path: [0, 0], offset: 2 })
  })

  it('元素路径光标（空块）', () => {
    const doc = createDocument([createElement('paragraph')])
    renderer.render(doc)
    renderer.setCaret({ path: [0], offset: 0 })
    expect(renderer.getPosition()).toEqual({ path: [0], offset: 0 })
  })

  it('getSelectionRange 读取选区', () => {
    const doc = createDocument([createElement('paragraph', [createText('abcd')])])
    renderer.render(doc)
    const textNode = container.querySelector('p')?.childNodes[0] as Text
    const range = document.createRange()
    range.setStart(textNode, 1)
    range.setEnd(textNode, 3)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    expect(renderer.getSelectionRange()).toEqual({
      type: 'text',
      anchor: { path: [0, 0], offset: 1 },
      head: { path: [0, 0], offset: 3 },
    })
  })
})
