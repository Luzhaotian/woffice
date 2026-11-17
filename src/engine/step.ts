/**
 * Step：文档修改的最小可逆单元
 *
 * 设计原则：
 *   - apply(doc) 返回新文档（结构共享，不做 normalize）
 *   - invert() 返回逆 Step，apply + invert 必须往返一致
 *   - mapPosition 把语义位置映射过该步骤（用于选区跟随）
 *
 * M1 提供 4 个原语：ReplaceChildrenStep / ReplaceTextStep / SetNodeAttrsStep / SetMarksStep。
 * 文本范围内的 mark 操作由 M2 通过拆分文本节点组合实现。
 */

import type { Attrs, Document, Mark, Node } from '@/model/node'
import { isElement, isText } from '@/model/node'
import type { Path, Position } from '@/model/path'
import { isSamePath } from '@/model/path'
import type { TextSelection } from '@/engine/selection'
import { isDescendantOf, mapSelection } from '@/engine/selection'
import { getChildrenAt, getNodeAt, updateNodeAt } from '@/model/traverse'

export interface Step {
  readonly type: string
  apply(doc: Document): Document
  invert(): Step
  mapPosition(pos: Position): Position
  mapSelection(sel: TextSelection): TextSelection
}

export abstract class BaseStep implements Step {
  abstract readonly type: string
  abstract apply(doc: Document): Document
  abstract invert(): Step
  abstract mapPosition(pos: Position): Position

  mapSelection(sel: TextSelection): TextSelection {
    return mapSelection(sel, (pos) => this.mapPosition(pos))
  }
}

// ---------------------------------------------------------------------------
// ReplaceChildrenStep：替换某父节点下 [from, to) 的子节点
// ---------------------------------------------------------------------------

export class ReplaceChildrenStep extends BaseStep {
  readonly type = 'replaceChildren'

  constructor(
    readonly parentPath: Path,
    readonly from: number,
    readonly to: number,
    readonly inserted: Node[],
    readonly removed: Node[],
  ) {
    super()
    if (from < 0 || to < from) throw new Error(`非法的子节点区间 [${from}, ${to})`)
  }

  apply(doc: Document): Document {
    const children = getChildrenAt(doc, this.parentPath)
    if (!children) throw new Error(`父节点不存在: ${this.parentPath.join('.')}`)
    if (this.from > children.length || this.to > children.length) {
      throw new Error(`子节点区间越界: [${this.from}, ${this.to})，长度 ${children.length}`)
    }
    const next = [...children.slice(0, this.from), ...this.inserted, ...children.slice(this.to)]
    if (this.parentPath.length === 0) return { ...doc, children: next }
    const parent = getNodeAt(doc, this.parentPath)
    if (!parent || !isElement(parent)) throw new Error('父节点不是元素节点')
    return updateNodeAt(doc, this.parentPath, { ...parent, children: next })
  }

  invert(): Step {
    return new ReplaceChildrenStep(
      this.parentPath,
      this.from,
      this.from + this.inserted.length,
      this.removed,
      this.inserted,
    )
  }

  mapPosition(pos: Position): Position {
    if (!isDescendantOf(pos.path, this.parentPath)) return pos
    const index = pos.path[this.parentPath.length]
    if (index === undefined) return pos
    if (index >= this.from && index < this.to) {
      // 位置落在被替换区间内。
      // 若是"块被包进/剥出容器"（列表、引用等），保留更深的路径，
      // 让光标落在对应的文本节点上，而不是跑到插入点。
      if (index === this.from && this.inserted.length > 0) {
        const rest = pos.path.slice(this.parentPath.length + 1)
        if (rest.length > 0) {
          return { path: [...this.parentPath, this.from, ...rest], offset: pos.offset }
        }
      }
      // 若是"一个文本节点被拆成多段"（如加粗时按选区拆分），
      // 按偏移映射到对应的插入段，保持选区范围。
      if (this.removed.length === 1 && isText(this.removed[0])) {
        let acc = 0
        for (let i = 0; i < this.inserted.length; i++) {
          const node = this.inserted[i]
          if (!isText(node)) break
          const len = node.text.length
          if (pos.offset <= acc + len || i === this.inserted.length - 1) {
            return {
              path: [...this.parentPath, this.from + i],
              offset: Math.max(0, Math.min(pos.offset - acc, len)),
            }
          }
          acc += len
        }
      }
      // 其它情况：移到插入点
      return { path: [...this.parentPath, this.from], offset: 0 }
    }
    if (index >= this.to) {
      const delta = this.inserted.length - this.removed.length
      const path = [...pos.path]
      path[this.parentPath.length] = index + delta
      return { ...pos, path }
    }
    return pos
  }
}

// ---------------------------------------------------------------------------
// ReplaceTextStep：替换单个文本节点内的 [from, to) 文本
// ---------------------------------------------------------------------------

export class ReplaceTextStep extends BaseStep {
  readonly type = 'replaceText'

  constructor(
    readonly path: Path,
    readonly from: number,
    readonly to: number,
    readonly text: string,
    readonly removedText: string,
  ) {
    super()
    if (from < 0 || to < from) throw new Error(`非法的文本区间 [${from}, ${to})`)
  }

  apply(doc: Document): Document {
    const node = getNodeAt(doc, this.path)
    if (!node || !isText(node)) throw new Error(`目标不是文本节点: ${this.path.join('.')}`)
    if (this.from > node.text.length || this.to > node.text.length) {
      throw new Error(`文本区间越界: [${this.from}, ${this.to})，长度 ${node.text.length}`)
    }
    const text = node.text.slice(0, this.from) + this.text + node.text.slice(this.to)
    return updateNodeAt(doc, this.path, { ...node, text })
  }

  invert(): Step {
    return new ReplaceTextStep(
      this.path,
      this.from,
      this.from + this.text.length,
      this.removedText,
      this.text,
    )
  }

  mapPosition(pos: Position): Position {
    if (!isSamePath(pos.path, this.path)) return pos
    if (pos.offset >= this.to)
      return { ...pos, offset: pos.offset - (this.to - this.from) + this.text.length }
    if (pos.offset <= this.from) return pos
    return { ...pos, offset: this.from + this.text.length }
  }
}

// ---------------------------------------------------------------------------
// SetNodeAttrsStep：整体设置节点 attrs（prevAttrs → nextAttrs）
// ---------------------------------------------------------------------------

export class SetNodeAttrsStep extends BaseStep {
  readonly type = 'setNodeAttrs'

  constructor(
    readonly path: Path,
    readonly nextAttrs: Attrs,
    readonly prevAttrs: Attrs,
  ) {
    super()
  }

  apply(doc: Document): Document {
    const node = getNodeAt(doc, this.path)
    if (!node) throw new Error(`节点不存在: ${this.path.join('.')}`)
    return updateNodeAt(doc, this.path, { ...node, attrs: this.nextAttrs })
  }

  invert(): Step {
    return new SetNodeAttrsStep(this.path, this.prevAttrs, this.nextAttrs)
  }

  mapPosition(pos: Position): Position {
    return pos
  }
}

// ---------------------------------------------------------------------------
// SetMarksStep：设置文本节点的 marks
// ---------------------------------------------------------------------------

export class SetMarksStep extends BaseStep {
  readonly type = 'setMarks'

  constructor(
    readonly path: Path,
    readonly marks: Mark[] | undefined,
    readonly prevMarks: Mark[] | undefined,
  ) {
    super()
  }

  apply(doc: Document): Document {
    const node = getNodeAt(doc, this.path)
    if (!node || !isText(node)) throw new Error(`目标不是文本节点: ${this.path.join('.')}`)
    return updateNodeAt(doc, this.path, { ...node, marks: this.marks })
  }

  invert(): Step {
    return new SetMarksStep(this.path, this.prevMarks, this.marks)
  }

  mapPosition(pos: Position): Position {
    return pos
  }
}
