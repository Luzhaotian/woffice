import { describe, expect, it } from 'vitest'
import {
  attrsEqual,
  cloneNode,
  createDocument,
  createElement,
  createText,
  createVoid,
  getTextOf,
  isElement,
  isText,
  isVoid,
  marksEqual,
  stableStringify,
} from '@/model/node'

describe('node', () => {
  it('类型守卫', () => {
    const text = createText('hi')
    const element = createElement('paragraph', [text])
    const voidNode = createVoid('image')
    expect(isText(text)).toBe(true)
    expect(isElement(element)).toBe(true)
    expect(isVoid(voidNode)).toBe(true)
    expect(isText(element)).toBe(false)
    expect(isVoid(element)).toBe(false)
  })

  it('工厂函数', () => {
    expect(createText('a')).toEqual({ type: 'text', text: 'a' })
    expect(createText('a', [{ type: 'bold' }])).toEqual({ type: 'text', text: 'a', marks: [{ type: 'bold' }] })
    expect(createElement('paragraph')).toEqual({ type: 'paragraph', children: [] })
    expect(createVoid('hr')).toEqual({ type: 'hr', void: true })
    expect(createDocument()).toEqual({ type: 'doc', version: 1, children: [] })
  })

  it('getTextOf 递归取文本', () => {
    const doc = createDocument([
      createElement('paragraph', [createText('Hello '), createText('World')]),
      createElement('paragraph', [createText('!')]),
    ])
    expect(getTextOf(doc.children[0])).toBe('Hello World')
    expect(getTextOf(createVoid('hr'))).toBe('')
  })

  it('cloneNode 深拷贝', () => {
    const node = createElement('paragraph', [createText('a', [{ type: 'bold' }])], { id: 'p1' })
    const cloned = cloneNode(node)
    expect(cloned).toEqual(node)
    expect(cloned).not.toBe(node)
    if (isElement(cloned) && isElement(node)) {
      expect(cloned.children[0]).not.toBe(node.children[0])
    }
  })

  it('marksEqual / attrsEqual', () => {
    expect(marksEqual(undefined, undefined)).toBe(true)
    expect(marksEqual([{ type: 'bold' }], [{ type: 'bold' }])).toBe(true)
    expect(marksEqual([{ type: 'bold' }], [{ type: 'italic' }])).toBe(false)
    expect(marksEqual([{ type: 'bold' }], [{ type: 'bold' }, { type: 'italic' }])).toBe(false)
    expect(
      marksEqual([{ type: 'link', attrs: { href: '/a' } }], [{ type: 'link', attrs: { href: '/a' } }]),
    ).toBe(true)
    expect(attrsEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(attrsEqual({ a: 1 }, { a: 2 })).toBe(false)
  })

  it('stableStringify 键序无关', () => {
    expect(stableStringify({ a: 1, b: { c: 2, d: 3 } })).toBe(stableStringify({ b: { d: 3, c: 2 }, a: 1 }))
    expect(stableStringify([1, 2, 3])).toBe(stableStringify([1, 2, 3]))
  })
})
