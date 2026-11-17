/**
 * 语义选区：anchor / head（path + 文本偏移），与 DOM 解耦
 */

import type { Position, Path } from '@/model/path'
import { comparePosition } from '@/model/path'

export interface TextSelection {
  type: 'text'
  anchor: Position
  head: Position
}

export function createSelection(anchor: Position, head: Position = anchor): TextSelection {
  return { type: 'text', anchor, head }
}

export function eqPosition(a: Position, b: Position): boolean {
  return comparePosition(a, b) === 0
}

export function eqSelection(a: TextSelection, b: TextSelection): boolean {
  return eqPosition(a.anchor, b.anchor) && eqPosition(a.head, b.head)
}

export function isCollapsed(sel: TextSelection): boolean {
  return eqPosition(sel.anchor, sel.head)
}

/** 规整为 from <= to（用于删除等只需要顺序的场景） */
export function selectionRange(sel: TextSelection): { from: Position; to: Position } {
  return comparePosition(sel.anchor, sel.head) <= 0
    ? { from: sel.anchor, to: sel.head }
    : { from: sel.head, to: sel.anchor }
}

export function mapSelection(sel: TextSelection, map: (pos: Position) => Position): TextSelection {
  return { type: 'text', anchor: map(sel.anchor), head: map(sel.head) }
}

/** 判断 path 是否严格位于 ancestor 之下 */
export function isDescendantOf(path: Path, ancestor: Path): boolean {
  return path.length > ancestor.length && ancestor.every((index, i) => path[i] === index)
}
