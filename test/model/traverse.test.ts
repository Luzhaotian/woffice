import { describe, expect, it } from 'vitest'
import { createDocument, createElement, createText, createVoid } from '@/model/node'
import { findNode, getTextContent, getNodeAt, getParentAt, traverse } from '@/model/traverse'

describe('traverse', () => {
  const doc = createDocument([
    createElement('paragraph', [createText('a')]),
    createElement('paragraph', [createText('b'), createVoid('hr')]),
  ])

  it('getNodeAt', () => {
    expect(getNodeAt(doc, [0])?.type).toBe('paragraph')
    expect(getNodeAt(doc, [0, 0])?.type).toBe('text')
    expect(getNodeAt(doc, [99])).toBeUndefined()
    expect(getNodeAt(doc, [0, 99])).toBeUndefined()
    expect(getNodeAt(doc, [])).toBeUndefined()
  })

  it('getParentAt', () => {
    expect(getParentAt(doc, [0, 0])?.type).toBe('paragraph')
    expect(getParentAt(doc, [0])).toBeUndefined()
  })

  it('traverse 深度优先且带 path', () => {
    const visited: string[] = []
    traverse(doc, ({ node, path }) => {
      visited.push(`${node.type}@${path.join('.')}`)
      return undefined
    })
    expect(visited).toEqual(['paragraph@0', 'text@0.0', 'paragraph@1', 'text@1.0', 'hr@1.1'])
  })

  it('traverse 返回 false 跳过子节点', () => {
    const visited: string[] = []
    traverse(doc, ({ node }) => {
      visited.push(node.type)
      return node.type === 'paragraph' ? false : undefined
    })
    expect(visited).toEqual(['paragraph', 'paragraph'])
  })

  it('findNode', () => {
    expect(findNode(doc, (node) => node.type === 'hr')?.path).toEqual([1, 1])
    expect(findNode(doc, (node) => node.type === 'missing')).toBeUndefined()
  })

  it('getTextContent', () => {
    expect(getTextContent(doc)).toBe('ab')
  })
})
