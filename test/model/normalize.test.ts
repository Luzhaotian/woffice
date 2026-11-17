import { describe, expect, it } from 'vitest'
import type { Node } from '@/model/node'
import { createDocument, createElement, createText, createVoid, isElement } from '@/model/node'
import { normalize } from '@/model/normalize'

function childrenOf(node: Node): Node[] {
  return isElement(node) ? node.children : []
}

describe('normalize', () => {
  it('合并相邻同 marks 文本', () => {
    const doc = createDocument([
      createElement('paragraph', [
        createText('Hello', [{ type: 'bold' }]),
        createText(' World', [{ type: 'bold' }]),
        createText('!', [{ type: 'italic' }]),
      ]),
    ])
    const result = normalize(doc)
    expect(result.children).toEqual([
      createElement('paragraph', [
        createText('Hello World', [{ type: 'bold' }]),
        createText('!', [{ type: 'italic' }]),
      ]),
    ])
  })

  it('合并相邻代码块（视觉上是一个整体）', () => {
    const doc = createDocument([
      createElement('code_block', [createText('甲')]),
      createElement('code_block', [createText('乙')]),
    ])
    const result = normalize(doc)
    // 两个代码块合成一个，中间补换行，相邻同 marks 文本再合并
    expect(result.children).toEqual([createElement('code_block', [createText('甲\n乙')])])
    // 幂等
    expect(normalize(result)).toBe(result)
  })

  it('删除空文本节点', () => {
    const doc = createDocument([
      createElement('paragraph', [createText(''), createText('a'), createText('')]),
    ])
    const result = normalize(doc)
    expect(result.children).toEqual([createElement('paragraph', [createText('a')])])
  })

  it('marks 去重并排序', () => {
    const doc = createDocument([
      createElement('paragraph', [
        createText('a', [{ type: 'italic' }, { type: 'bold' }, { type: 'italic' }]),
      ]),
    ])
    const result = normalize(doc)
    expect(result.children).toEqual([
      createElement('paragraph', [createText('a', [{ type: 'bold' }, { type: 'italic' }])]),
    ])
  })

  it('空文档补一个空段落', () => {
    expect(normalize(createDocument([]))).toEqual(createDocument([createElement('paragraph')]))
  })

  it('顶层文本包进段落', () => {
    const doc = createDocument([
      createText('a'),
      createElement('paragraph', [createText('b')]),
      createText('c'),
      createText('d'),
    ])
    expect(normalize(doc).children).toEqual([
      createElement('paragraph', [createText('a')]),
      createElement('paragraph', [createText('b')]),
      createElement('paragraph', [createText('cd')]),
    ])
  })

  it('保留 void 节点', () => {
    const doc = createDocument([createVoid('hr')])
    expect(normalize(doc).children).toEqual([createVoid('hr')])
  })

  it('幂等：normalize(normalize(doc)) 返回同一引用', () => {
    const doc = createDocument([
      createElement('paragraph', [
        createText('a'),
        createText(''),
        createText('b', [{ type: 'bold' }]),
      ]),
      createText('c'),
    ])
    const once = normalize(doc)
    expect(normalize(once)).toBe(once)
  })

  it('未变化时返回原引用', () => {
    const doc = normalize(createDocument([createElement('paragraph', [createText('a')])]))
    expect(normalize(doc)).toBe(doc)
  })

  it('随机文档幂等（伪随机，100 例）', () => {
    let seed = 42
    const rand = (): number => {
      seed = (seed * 48271) % 2147483647
      return seed / 2147483647
    }
    const randomNode = (depth: number): Node => {
      const kind = rand()
      if (depth > 2 || kind < 0.4) {
        return createText(
          rand() < 0.2 ? '' : `t${Math.floor(rand() * 10)}`,
          rand() < 0.5 ? [{ type: 'bold' }] : undefined,
        )
      }
      if (kind < 0.5) return createVoid('hr')
      const count = Math.floor(rand() * 4)
      const children: Node[] = []
      for (let i = 0; i < count; i++) children.push(randomNode(depth + 1))
      return createElement('paragraph', children)
    }
    for (let i = 0; i < 100; i++) {
      const count = Math.floor(rand() * 4)
      const children: Node[] = []
      for (let j = 0; j < count; j++) children.push(randomNode(0))
      const once = normalize(createDocument(children))
      expect(normalize(once)).toBe(once)
    }
  })

  it('childrenOf 辅助可用', () => {
    expect(childrenOf(createElement('paragraph', [createText('x')]))).toHaveLength(1)
    expect(childrenOf(createVoid('hr'))).toHaveLength(0)
  })
})
