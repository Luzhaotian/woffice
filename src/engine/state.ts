/**
 * 编辑器状态：文档 + 选区（不可变，事务产生新状态）
 */

import type { Document } from '@/model/node'
import { createSelection, type TextSelection } from '@/engine/selection'
import type { Position } from '@/model/path'

export interface EditorState {
  doc: Document
  selection: TextSelection
}

export function createState(doc: Document, selection?: TextSelection): EditorState {
  return { doc, selection: selection ?? createSelection(defaultPosition()) }
}

/** 默认光标：第一个块的第一个文本节点开头 */
function defaultPosition(): Position {
  return { path: [0, 0], offset: 0 }
}
