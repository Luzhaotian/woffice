import { describe, expect, it } from 'vitest'
import type { Document, Node } from '@/model/node'
import {
  createDocument,
  createElement,
  createText,
  createVoid,
  isElement,
  isText,
} from '@/model/node'
import type { Path } from '@/model/path'
import { getNodeAt, traverse } from '@/model/traverse'
import {
  ReplaceChildrenStep,
  ReplaceTextStep,
  SetMarksStep,
  SetNodeAttrsStep,
  type Step,
} from '@/engine/step'

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomDoc(rand: () => number): Document {
  const blockCount = 1 + Math.floor(rand() * 3)
  const children: Node[] = []
  for (let b = 0; b < blockCount; b++) {
    const textCount = Math.floor(rand() * 4)
    const inline: Node[] = []
    for (let t = 0; t < textCount; t++) {
      const text = String.fromCharCode(97 + Math.floor(rand() * 26)).repeat(Math.floor(rand() * 4))
      inline.push(createText(text))
    }
    children.push(createElement('paragraph', inline))
  }
  return createDocument(children)
}

function randomStep(rand: () => number, doc: Document): Step {
  const textEntries: { path: Path; text: string }[] = []
  const elementEntries: { path: Path; children: Node[] }[] = []
  traverse(doc, (entry) => {
    if (isText(entry.node)) textEntries.push({ path: entry.path, text: entry.node.text })
    else if (isElement(entry.node))
      elementEntries.push({ path: entry.path, children: entry.node.children })
    return undefined
  })

  if (rand() < 0.5 && textEntries.length > 0) {
    const entry = textEntries[Math.floor(rand() * textEntries.length)]
    const len = entry.text.length
    const from = Math.floor(rand() * (len + 1))
    const to = from + Math.floor(rand() * (len - from + 1))
    const text = 'x'.repeat(Math.floor(rand() * 3))
    return new ReplaceTextStep(entry.path, from, to, text, entry.text.slice(from, to))
  }

  const parent = elementEntries[Math.floor(rand() * elementEntries.length)]
  const index = Math.floor(rand() * (parent.children.length + 1))
  const node = rand() < 0.5 ? createText('z') : createVoid('hr')
  return new ReplaceChildrenStep(parent.path, index, index, [node], [])
}

describe('ReplaceChildrenStep', () => {
  it('插入子节点', () => {
    const doc = createDocument([createElement('paragraph', [createText('a')])])
    const step = new ReplaceChildrenStep([0], 1, 1, [createText('b')], [])
    const after = step.apply(doc)
    const paragraph = after.children[0]
    expect(isElement(paragraph) && paragraph.children).toEqual([createText('a'), createText('b')])
  })

  it('删除子节点并往返', () => {
    const doc = createDocument([createElement('paragraph', [createText('a'), createText('b')])])
    const step = new ReplaceChildrenStep([0], 0, 1, [], [createText('a')])
    const after = step.apply(doc)
    const paragraph = after.children[0]
    expect(isElement(paragraph) && paragraph.children).toEqual([createText('b')])
    expect(step.invert().apply(after)).toEqual(doc)
  })

  it('替换子节点并往返', () => {
    const doc = createDocument([
      createElement('paragraph', [createText('a'), createText('b'), createText('c')]),
    ])
    const step = new ReplaceChildrenStep([0], 1, 2, [createText('X')], [createText('b')])
    const after = step.apply(doc)
    const paragraph = after.children[0]
    expect(isElement(paragraph) && paragraph.children).toEqual([
      createText('a'),
      createText('X'),
      createText('c'),
    ])
    expect(step.invert().apply(after)).toEqual(doc)
  })

  it('根层级操作并往返', () => {
    const doc = createDocument([createElement('paragraph', [createText('a')])])
    const step = new ReplaceChildrenStep([], 0, 1, [], [doc.children[0]])
    const after = step.apply(doc)
    expect(after.children).toEqual([])
    expect(step.invert().apply(after)).toEqual(doc)
  })

  it('mapPosition：插入后位置后移', () => {
    const step = new ReplaceChildrenStep([0], 1, 1, [createVoid('hr')], [])
    expect(step.mapPosition({ path: [0, 2], offset: 0 })).toEqual({ path: [0, 3], offset: 0 })
    expect(step.mapPosition({ path: [0, 0], offset: 0 })).toEqual({ path: [0, 0], offset: 0 })
  })

  it('mapPosition：落在被替换区间内 → 移到插入点', () => {
    const step = new ReplaceChildrenStep([0], 1, 2, [], [createText('b')])
    expect(step.mapPosition({ path: [0, 1], offset: 3 })).toEqual({ path: [0, 1], offset: 0 })
  })
})

describe('ReplaceTextStep', () => {
  it('插入文本', () => {
    const doc = createDocument([createElement('paragraph', [createText('ac')])])
    const step = new ReplaceTextStep([0, 0], 1, 1, 'b', '')
    expect(step.apply(doc)).toEqual(
      createDocument([createElement('paragraph', [createText('abc')])]),
    )
  })

  it('删除文本并往返', () => {
    const doc = createDocument([createElement('paragraph', [createText('abc')])])
    const step = new ReplaceTextStep([0, 0], 1, 3, '', 'bc')
    const after = step.apply(doc)
    expect(after).toEqual(createDocument([createElement('paragraph', [createText('a')])]))
    expect(step.invert().apply(after)).toEqual(doc)
  })

  it('替换文本并往返', () => {
    const doc = createDocument([createElement('paragraph', [createText('abc')])])
    const step = new ReplaceTextStep([0, 0], 1, 2, 'X', 'b')
    const after = step.apply(doc)
    expect(after).toEqual(createDocument([createElement('paragraph', [createText('aXc')])]))
    expect(step.invert().apply(after)).toEqual(doc)
  })

  it('mapPosition：插入后光标后移', () => {
    const step = new ReplaceTextStep([0, 0], 1, 1, 'xy', '')
    expect(step.mapPosition({ path: [0, 0], offset: 1 })).toEqual({ path: [0, 0], offset: 3 })
    expect(step.mapPosition({ path: [0, 0], offset: 0 })).toEqual({ path: [0, 0], offset: 0 })
  })

  it('mapPosition：删除后光标前移', () => {
    const step = new ReplaceTextStep([0, 0], 1, 3, '', 'bc')
    expect(step.mapPosition({ path: [0, 0], offset: 3 })).toEqual({ path: [0, 0], offset: 1 })
    expect(step.mapPosition({ path: [0, 0], offset: 1 })).toEqual({ path: [0, 0], offset: 1 })
  })
})

describe('SetNodeAttrsStep / SetMarksStep', () => {
  it('设置 attrs 并往返', () => {
    const doc = createDocument([createElement('heading', [createText('t')], { level: 1 })])
    const step = new SetNodeAttrsStep([0], { level: 2 }, { level: 1 })
    const after = step.apply(doc)
    expect(after.children[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } })
    expect(step.invert().apply(after)).toEqual(doc)
  })

  it('设置 marks 并往返', () => {
    const doc = createDocument([createElement('paragraph', [createText('a')])])
    const step = new SetMarksStep([0, 0], [{ type: 'bold' }], undefined)
    const after = step.apply(doc)
    const node = getNodeAt(after, [0, 0])
    expect(node).toMatchObject({ type: 'text', text: 'a', marks: [{ type: 'bold' }] })
    expect(step.invert().apply(after)).toEqual(doc)
  })
})

describe('Step 性质', () => {
  it('随机步骤 apply + invert 往返（伪随机，300 例）', () => {
    const rand = mulberry32(42)
    for (let i = 0; i < 300; i++) {
      const doc = randomDoc(rand)
      const step = randomStep(rand, doc)
      const after = step.apply(doc)
      expect(step.invert().apply(after)).toEqual(doc)
    }
  })
})
