// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createDocument, createElement, createText } from '@/model/node'
import { Renderer } from '@/render/renderer'

let container: HTMLElement
let renderer: Renderer

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  renderer = new Renderer(container)
})

describe('增量渲染', () => {
  it('未变化的块复用同一个 DOM 节点', () => {
    const doc = createDocument([
      createElement('paragraph', [createText('a')]),
      createElement('paragraph', [createText('b')]),
    ])
    renderer.render(doc)
    const first = container.children[0]

    const doc2 = createDocument([...doc.children, createElement('paragraph', [createText('c')])])
    renderer.render(doc2)
    expect(container.children[0]).toBe(first)
    expect(container.children).toHaveLength(3)
  })

  it('在开头插入时，原有节点被移动而非重建', () => {
    const doc = createDocument([
      createElement('paragraph', [createText('a')]),
      createElement('paragraph', [createText('b')]),
    ])
    renderer.render(doc)
    const first = container.children[0]

    const doc2 = createDocument([createElement('paragraph', [createText('z')]), ...doc.children])
    renderer.render(doc2)
    expect(container.children[1]).toBe(first)
    expect(container.children[0].textContent).toBe('z')
  })

  it('删除中间块后其余节点复用', () => {
    const doc = createDocument([
      createElement('paragraph', [createText('a')]),
      createElement('paragraph', [createText('b')]),
      createElement('paragraph', [createText('c')]),
    ])
    renderer.render(doc)
    const first = container.children[0]
    const third = container.children[2]

    const doc2 = createDocument([doc.children[0], doc.children[2]])
    renderer.render(doc2)
    expect(container.children[0]).toBe(first)
    expect(container.children[1]).toBe(third)
  })

  it('文本节点内容变化时重建该文本节点', () => {
    const doc = createDocument([createElement('paragraph', [createText('a')])])
    renderer.render(doc)
    const textNode = container.querySelector('p')?.firstChild

    const doc2 = createDocument([createElement('paragraph', [createText('b')])])
    renderer.render(doc2)
    expect(container.querySelector('p')?.firstChild).not.toBe(textNode)
    expect(container.textContent).toBe('b')
  })
})
