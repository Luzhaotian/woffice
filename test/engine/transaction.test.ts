import { describe, expect, it } from 'vitest'
import { createDocument, createElement, createText } from '@/model/node'
import { createState } from '@/engine/state'
import { createSelection } from '@/engine/selection'
import { Transaction } from '@/engine/transaction'
import { ReplaceTextStep } from '@/engine/step'

describe('Transaction', () => {
  it('多步骤按序应用', () => {
    const state = createState(createDocument([createElement('paragraph', [createText('ab')])]))
    const tr = new Transaction(state)
    tr.addStep(new ReplaceTextStep([0, 0], 1, 1, 'X', ''))
    tr.addStep(new ReplaceTextStep([0, 0], 2, 2, 'Y', ''))
    expect(tr.apply().doc).toEqual(
      createDocument([createElement('paragraph', [createText('aXYb')])]),
    )
  })

  it('invert 可还原到初始文档', () => {
    const state = createState(createDocument([createElement('paragraph', [createText('ab')])]))
    const tr = new Transaction(state)
    tr.addStep(new ReplaceTextStep([0, 0], 1, 1, 'X', ''))
    tr.addStep(new ReplaceTextStep([0, 0], 2, 2, 'Y', ''))
    const after = tr.apply()
    let doc = after.doc
    for (const step of tr.invert()) doc = step.apply(doc)
    expect(doc).toEqual(state.doc)
  })

  it('选区随步骤映射', () => {
    const state = createState(
      createDocument([createElement('paragraph', [createText('abc')])]),
      createSelection({ path: [0, 0], offset: 3 }),
    )
    const tr = new Transaction(state)
    tr.addStep(new ReplaceTextStep([0, 0], 0, 1, 'X', ''))
    expect(tr.selection).toEqual(createSelection({ path: [0, 0], offset: 3 }))
  })

  it('选区在编辑点之前时保持不动', () => {
    const state = createState(
      createDocument([createElement('paragraph', [createText('abc')])]),
      createSelection({ path: [0, 0], offset: 0 }),
    )
    const tr = new Transaction(state)
    tr.addStep(new ReplaceTextStep([0, 0], 1, 2, 'X', 'b'))
    expect(tr.selection).toEqual(createSelection({ path: [0, 0], offset: 0 }))
  })

  it('提交时 normalize（合并相邻同 marks 文本）', () => {
    const state = createState(
      createDocument([createElement('paragraph', [createText('a'), createText('b')])]),
    )
    const tr = new Transaction(state)
    tr.addStep(new ReplaceTextStep([0, 1], 1, 1, 'c', ''))
    expect(tr.apply().doc).toEqual(
      createDocument([createElement('paragraph', [createText('abc')])]),
    )
  })
})
