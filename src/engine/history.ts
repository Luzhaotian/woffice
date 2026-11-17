/**
 * History：撤销 / 重做栈，支持连续输入合并
 */

import type { Document } from '@/model/node'
import { normalize } from '@/model/normalize'
import type { EditorState } from '@/engine/state'
import type { Step } from '@/engine/step'
import type { TextSelection } from '@/engine/selection'

export interface HistoryEntry {
  steps: Step[]
  /** 逆步骤（已按应用顺序排列） */
  inverted: Step[]
  selectionBefore: TextSelection
  selectionAfter: TextSelection
  time: number
  coalescible: boolean
}

/** 连续输入合并的时间窗口（毫秒） */
export const COALESCE_DELAY = 500

export class History {
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  get undoCount(): number {
    return this.undoStack.length
  }

  get redoCount(): number {
    return this.redoStack.length
  }

  push(entry: HistoryEntry): void {
    const prev = this.undoStack[this.undoStack.length - 1]
    if (entry.coalescible && prev && prev.coalescible && entry.time - prev.time < COALESCE_DELAY) {
      // 合并到上一个事务：步骤追加，逆步骤前插
      prev.steps.push(...entry.steps)
      prev.inverted = [...entry.inverted, ...prev.inverted]
      prev.selectionAfter = entry.selectionAfter
      prev.time = entry.time
    } else {
      this.undoStack.push(entry)
    }
    // 新事务会清空重做栈
    this.redoStack = []
  }

  undo(state: EditorState): EditorState | undefined {
    const entry = this.undoStack.pop()
    if (!entry) return undefined
    let doc: Document = state.doc
    for (const step of entry.inverted) doc = step.apply(doc)
    this.redoStack.push(entry)
    return { doc: normalize(doc), selection: entry.selectionBefore }
  }

  redo(state: EditorState): EditorState | undefined {
    const entry = this.redoStack.pop()
    if (!entry) return undefined
    let doc: Document = state.doc
    for (const step of entry.steps) doc = step.apply(doc)
    this.undoStack.push(entry)
    return { doc: normalize(doc), selection: entry.selectionAfter }
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }
}
