// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createDocument, createElement, createText } from '@/model/node'
import { Renderer } from '@/render/renderer'

/**
 * 大文档性能基准（信息性，阈值给得很宽，避免 CI 抖动）
 */

let container: HTMLElement
let renderer: Renderer

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  renderer = new Renderer(container)
})

function buildLargeDoc(paragraphs: number) {
  const children = []
  for (let i = 0; i < paragraphs; i++) {
    children.push(
      createElement('paragraph', [createText(`第 ${i + 1} 段：这是一段用于性能测试的示例文字。`)]),
    )
  }
  return createDocument(children)
}

describe('大文档基准', () => {
  it('1000 段首次渲染', () => {
    const doc = buildLargeDoc(1000)
    const start = performance.now()
    renderer.render(doc)
    const elapsed = performance.now() - start
    console.log(`[bench] 1000 段首次渲染: ${elapsed.toFixed(1)}ms`)
    expect(container.children).toHaveLength(1000)
    expect(elapsed).toBeLessThan(3000)
  })

  it('1000 段增量渲染（只改一段）', () => {
    const doc = buildLargeDoc(1000)
    renderer.render(doc)

    const changed = [...doc.children]
    changed[500] = createElement('paragraph', [createText('修改后的第 501 段')])
    const start = performance.now()
    renderer.render(createDocument(changed))
    const elapsed = performance.now() - start
    console.log(`[bench] 1000 段增量渲染（改 1 段）: ${elapsed.toFixed(1)}ms`)
    expect(elapsed).toBeLessThan(1000)
  })

  it('5000 段首次渲染', () => {
    const doc = buildLargeDoc(5000)
    const start = performance.now()
    renderer.render(doc)
    const elapsed = performance.now() - start
    console.log(`[bench] 5000 段首次渲染: ${elapsed.toFixed(1)}ms`)
    expect(container.children).toHaveLength(5000)
    expect(elapsed).toBeLessThan(8000)
  })

  it('10000 段（约 20 万字）首次渲染 + 增量', () => {
    const doc = buildLargeDoc(10000)
    const start = performance.now()
    renderer.render(doc)
    const first = performance.now() - start
    console.log(`[bench] 10000 段首次渲染: ${first.toFixed(1)}ms`)

    const changed = [...doc.children]
    changed[5000] = createElement('paragraph', [createText('修改后的第 5001 段')])
    const start2 = performance.now()
    renderer.render(createDocument(changed))
    const incremental = performance.now() - start2
    console.log(`[bench] 10000 段增量渲染（改 1 段）: ${incremental.toFixed(1)}ms`)

    expect(container.children).toHaveLength(10000)
    expect(first).toBeLessThan(15000)
    expect(incremental).toBeLessThan(3000)
  })
})
