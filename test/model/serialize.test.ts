import { describe, expect, it } from 'vitest'
import type { Node } from '@/model/node'
import { createDocument, createElement, createText, createVoid, isElement } from '@/model/node'
import { parse, serialize, toJSON } from '@/model/serialize'

function childrenOf(node: Node): Node[] {
  return isElement(node) ? node.children : []
}

describe('serialize', () => {
  const doc = createDocument([
    createElement('paragraph', [createText('Hello', [{ type: 'bold' }]), createText(' World')]),
    createVoid('hr'),
  ])

  it('toJSON / serialize', () => {
    expect(toJSON(doc)).toEqual({
      type: 'doc',
      version: 1,
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', text: 'Hello', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' World' },
          ],
        },
        { type: 'hr', void: true },
      ],
    })
    expect(serialize(doc)).toBe(JSON.stringify(toJSON(doc)))
  })

  it('parse round-trip', () => {
    expect(parse(serialize(doc))).toEqual(doc)
  })

  it('parse 会 normalize', () => {
    const parsed = parse(
      JSON.stringify({
        type: 'doc',
        version: 1,
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', text: 'a' },
              { type: 'text', text: 'b' },
            ],
          },
        ],
      }),
    )
    expect(childrenOf(parsed.children[0])).toEqual([createText('ab')])
  })

  it('非法输入抛错', () => {
    expect(() => parse('not json')).toThrow()
    expect(() => parse(JSON.stringify({ type: 'doc' }))).toThrow()
    expect(() => parse(JSON.stringify({ type: 'doc', version: 1, children: 'x' }))).toThrow()
    expect(() =>
      parse(JSON.stringify({ type: 'doc', version: 1, children: [{ type: 'text' }] })),
    ).toThrow()
    expect(() =>
      parse(JSON.stringify({ type: 'doc', version: 1, children: [{ type: 'paragraph' }] })),
    ).toThrow()
    expect(() =>
      parse(JSON.stringify({ type: 'doc', version: 1, children: [{ type: 'hr' }] })),
    ).toThrow()
  })
})
