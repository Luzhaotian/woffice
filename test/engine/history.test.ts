import { describe, expect, it } from 'vitest'
import { createDocument, createElement, createText } from '@/model/node'
import { createState } from '@/engine/state'
import { createSelection } from '@/engine/selection'
import { COALESCE_DELAY, History, type HistoryEntry } from '@/engine/history'
import { ReplaceTextStep } from '@/engine/step'

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  const selection = createSelection({ path: [0, 0], offset: 0 })
  return {
    steps: [new ReplaceTextStep([0, 0], 1, 1, 'b', '')],
    inverted: [new ReplaceTextStep([0, 0], 1, 2, '', 'b')],
    selectionBefore: selection,
    selectionAfter: createSelection({ path: [0, 0], offset: 2 }),
    time: 1000,
    coalescible: false,
    ...overrides,
  }
}

describe('History', () => {
  it('undo / redo 往返', () => {
    const before = createDocument([createElement('paragraph', [createText('a')])])
    const after = createDocument([createElement('paragraph', [createText('ab')])])
    const history = new History()
    history.push(makeEntry())

    const undone = history.undo(createState(after))!
    expect(undone.doc).toEqual(before)

    const redone = history.redo(undone)!
    expect(redone.doc).toEqual(after)
  })

  it('连续输入合并为一个撤销单元', () => {
    const history = new History()
    history.push(makeEntry({ coalescible: true, time: 1000 }))
    history.push(
      makeEntry({
        steps: [new ReplaceTextStep([0, 0], 2, 2, 'c', '')],
        inverted: [new ReplaceTextStep([0, 0], 2, 3, '', 'c')],
        coalescible: true,
        time: 1200,
      }),
    )
    const current = createState(createDocument([createElement('paragraph', [createText('abc')])]))
    const undone = history.undo(current)!
    expect(undone.doc).toEqual(createDocument([createElement('paragraph', [createText('a')])]))
  })

  it('超过时间窗口不合并', () => {
    const history = new History()
    history.push(makeEntry({ coalescible: true, time: 1000 }))
    history.push(
      makeEntry({
        steps: [new ReplaceTextStep([0, 0], 2, 2, 'c', '')],
        inverted: [new ReplaceTextStep([0, 0], 2, 3, '', 'c')],
        coalescible: true,
        time: 1000 + COALESCE_DELAY + 1,
      }),
    )
    const current = createState(createDocument([createElement('paragraph', [createText('abc')])]))
    const undone = history.undo(current)!
    expect(undone.doc).toEqual(createDocument([createElement('paragraph', [createText('ab')])]))
  })

  it('新事务清空重做栈', () => {
    const history = new History()
    history.push(makeEntry())
    history.undo(createState(createDocument([createElement('paragraph', [createText('ab')])])))
    expect(history.canRedo).toBe(true)
    history.push(makeEntry())
    expect(history.canRedo).toBe(false)
  })
})
