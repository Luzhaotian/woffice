/**
 * Transaction：一组 Step 的序列，携带选区映射，产出新状态
 */

import type { Document } from '@/model/node'
import { normalize } from '@/model/normalize'
import type { EditorState } from '@/engine/state'
import type { Step } from '@/engine/step'
import type { TextSelection } from '@/engine/selection'

export class Transaction {
  private readonly _steps: Step[] = []
  private _selection: TextSelection
  readonly startState: EditorState

  /** 是否可与相邻事务合并（连续输入时置 true，用于撤销合并） */
  coalescible = false

  constructor(state: EditorState) {
    this.startState = state
    this._selection = state.selection
  }

  get steps(): readonly Step[] {
    return this._steps
  }

  /** 事务开始时的文档（步骤应用前） */
  get doc(): Document {
    return this.startState.doc
  }

  get selection(): TextSelection {
    return this._selection
  }

  addStep(step: Step): this {
    this._steps.push(step)
    this._selection = step.mapSelection(this._selection)
    return this
  }

  apply(): EditorState {
    let doc = this.startState.doc
    for (const step of this._steps) doc = step.apply(doc)
    return { doc: normalize(doc), selection: this._selection }
  }

  /** 逆步骤（已按应用顺序排好：倒序的 invert） */
  invert(): Step[] {
    return this._steps.map((step) => step.invert()).reverse()
  }
}
