/**
 * 内置插件命令实现（组合引擎命令）
 */

import type { Node } from '@/model/node'
import { createElement, createText, isElement, isText } from '@/model/node'
import type { Position } from '@/model/path'
import { traverse } from '@/model/traverse'
import type { Step } from '@/engine/step'
import { ReplaceChildrenStep } from '@/engine/step'
import { createSelection, selectionRange } from '@/engine/selection'
import {
  getMarksAtPosition,
  indentListItem,
  insertNodes,
  locateListItem,
  outdentListItem,
  setBlockType,
  toggleListBlocks,
  toggleMark as toggleMarkSteps,
  unwrapFromList,
  wrapInList,
} from '@/engine/commands'
import type { Editor } from '@/editor'

/** 读取用户输入的链接地址（无 DOM / 无 prompt 环境返回空串） */
function promptUrl(): string {
  if (typeof window === 'undefined') return ''
  const w = window as unknown as {
    prompt?: (message?: string, defaultValue?: string) => string | null
  }
  return typeof w.prompt === 'function' ? (w.prompt('链接地址', 'https://') ?? '') : ''
}

export function dispatch(editor: Editor, steps: Step[], caret?: Position): boolean {
  if (steps.length === 0) return false
  const tr = editor.transaction()
  for (const step of steps) tr.addStep(step)
  editor.dispatch(tr)
  if (caret) editor.setSelection(createSelection(caret))
  return true
}

/** 列表项缩进（Tab）：把当前条目嵌套到前一个条目下，保留列表类型与内容 */
export function indentList(editor: Editor): boolean {
  const pos = editor.getCaret()
  if (!pos) return false
  const result = indentListItem(editor.doc, pos)
  return result ? dispatch(editor, result.steps, result.caret) : false
}

/** 取消列表项缩进（Shift+Tab）：把当前条目提升到外层列表 */
export function outdentList(editor: Editor): boolean {
  const pos = editor.getCaret()
  if (!pos) return false
  const result = outdentListItem(editor.doc, pos)
  return result ? dispatch(editor, result.steps, result.caret) : false
}

/** 给选区加批注（M7） */
export function addComment(editor: Editor, textArg?: string): boolean {
  const range = editor.getSelection()
  if (!range) return false
  const collapsed =
    range.anchor.path.join('.') === range.head.path.join('.') &&
    range.anchor.offset === range.head.offset
  if (collapsed) return false
  const text =
    textArg ?? (typeof window !== 'undefined' ? (window.prompt('批注内容', '') ?? '') : '')
  if (!text) return false

  let maxId = -1
  traverse(editor.doc, (entry) => {
    if (isText(entry.node)) {
      for (const mark of entry.node.marks ?? []) {
        if (mark.type === 'comment') maxId = Math.max(maxId, Number(mark.attrs?.id ?? '-1'))
      }
    }
    return undefined
  })
  return toggleMark(editor, 'comment', { id: String(maxId + 1), text, author: '我' })
}

/** 在当前块末尾插入域（M7） */
export function insertField(editor: Editor, instr = 'PAGE'): boolean {
  const pos = editor.getCaret()
  if (!pos) return false
  const blockIndex = pos.path[0]
  const block = editor.doc.children[blockIndex]
  if (!block || !isElement(block)) return false
  const node: Node = { type: 'field', attrs: { instr }, children: [createText('1')] }
  return dispatch(editor, [insertNodes([blockIndex], block.children.length, [node])])
}

/** 切换修订模式（M7）：开启后新输入带 track_insert 标记 */
export function toggleTrackChanges(editor: Editor, on: boolean): boolean {
  editor.trackChanges = on
  return true
}

export function currentBlockIndex(editor: Editor): number | undefined {
  const pos = editor.getCaret()
  return pos ? pos.path[0] : undefined
}

export function setHeading(editor: Editor, level: number): boolean {
  const index = currentBlockIndex(editor)
  if (index === undefined) return false
  const block = editor.doc.children[index]
  const isCurrent = block?.type === 'heading' && block.attrs?.level === level
  return dispatch(
    editor,
    setBlockType(
      editor.doc,
      [index],
      isCurrent ? 'paragraph' : 'heading',
      isCurrent ? {} : { level },
    ),
  )
}

export function setParagraph(editor: Editor): boolean {
  const index = currentBlockIndex(editor)
  if (index === undefined) return false
  return dispatch(editor, setBlockType(editor.doc, [index], 'paragraph'))
}

export function toggleMark(
  editor: Editor,
  markType: string,
  attrs?: Record<string, unknown>,
): boolean {
  const range = editor.getSelection()
  if (!range) return false

  const collapsed =
    range.anchor.path.join('.') === range.head.path.join('.') &&
    range.anchor.offset === range.head.offset
  if (collapsed) {
    // 折叠光标：不改已有文字，只切换"待输入格式"（Word/WPS 行为）
    const pos = editor.getCaret() ?? range.anchor
    const base = editor.storedMarks ?? getMarksAtPosition(editor.doc, pos) ?? []
    const has = base.some((mark) => mark.type === markType)
    const next = has
      ? base.filter((mark) => mark.type !== markType)
      : [...base, attrs ? { type: markType, attrs } : { type: markType }]
    next.sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
    editor.setStoredMarks(next, pos)
    return true
  }

  return dispatch(editor, toggleMarkSteps(editor.doc, range.anchor, range.head, markType, attrs))
}

export function toggleLink(editor: Editor, urlArg?: string): boolean {
  const range = editor.getSelection()
  if (!range) return false
  const collapsed =
    range.anchor.path.join('.') === range.head.path.join('.') &&
    range.anchor.offset === range.head.offset
  if (collapsed) return false
  const url = urlArg ?? promptUrl()
  if (!url) return false
  return toggleMark(editor, 'link', { href: url })
}

export function toggleBulletList(editor: Editor): boolean {
  return toggleList(editor, 'bullet_list')
}

export function toggleOrderedList(editor: Editor): boolean {
  return toggleList(editor, 'ordered_list')
}

function toggleList(editor: Editor, listType: 'bullet_list' | 'ordered_list'): boolean {
  // 跨块选区：把选中的多个块合并成一个列表 / 或全部退出列表
  const range = editor.getSelection()
  if (range) {
    const { from, to } = selectionRange(range)
    const collapsed = from.path.join('.') === to.path.join('.') && from.offset === to.offset
    if (!collapsed && from.path[0] !== to.path[0]) {
      return dispatch(editor, toggleListBlocks(editor.doc, from.path[0], to.path[0], listType))
    }
  }

  const pos = editor.getCaret()
  if (!pos) return false
  // 光标在列表内（可能是嵌套列表）：切换光标所在的那一层，而不是最外层
  const loc = locateListItem(editor.doc, pos)
  if (loc) {
    if (loc.list.type === listType) {
      return dispatch(editor, unwrapFromList(editor.doc, loc.listPath))
    }
    return dispatch(editor, setBlockType(editor.doc, loc.listPath, listType))
  }
  const index = pos.path[0]
  const block = editor.doc.children[index]
  // 同类型列表 → 取消列表（回到普通段落）
  if (block?.type === listType) {
    return dispatch(editor, unwrapFromList(editor.doc, [index]))
  }
  // 另一种列表 → 转换类型（保留条目内容），而不是取消列表
  if (block?.type === 'bullet_list' || block?.type === 'ordered_list') {
    return dispatch(editor, setBlockType(editor.doc, [index], listType))
  }
  return dispatch(editor, wrapInList(editor.doc, [index], listType))
}

export function setBlockQuote(editor: Editor): boolean {
  const index = currentBlockIndex(editor)
  if (index === undefined) return false
  const block = editor.doc.children[index]
  const next = block?.type === 'blockquote' ? 'paragraph' : 'blockquote'
  return dispatch(editor, setBlockType(editor.doc, [index], next))
}

export function setCodeBlock(editor: Editor): boolean {
  const index = currentBlockIndex(editor)
  if (index === undefined) return false
  const block = editor.doc.children[index]
  const next = block?.type === 'code_block' ? 'paragraph' : 'code_block'
  return dispatch(editor, setBlockType(editor.doc, [index], next))
}

export function insertHorizontalRule(editor: Editor): boolean {
  const index = currentBlockIndex(editor)
  if (index === undefined) return false
  const block = editor.doc.children[index]
  const isEmptyParagraph =
    block?.type === 'paragraph' && (!('children' in block) || block.children.length === 0)
  if (isEmptyParagraph) {
    // 空段落 → 替换为「分割线 + 空段落」，光标落到分割线下方，便于继续输入
    // （否则分割线成了最后一个块，下方没有可输入的位置）
    return dispatch(
      editor,
      [
        new ReplaceChildrenStep(
          [],
          index,
          index + 1,
          [{ type: 'horizontal_rule', void: true }, createElement('paragraph')],
          [block],
        ),
      ],
      { path: [index + 1], offset: 0 },
    )
  }
  const steps: Step[] = [insertNodes([], index + 1, [{ type: 'horizontal_rule', void: true }])]
  if (index === editor.doc.children.length - 1) {
    // 分割线成为最后一个块时补一个空段落，保证下方仍可继续输入
    steps.push(insertNodes([], index + 2, [createElement('paragraph')]))
  }
  // 光标落到分割线下方（与 WPS 一致），避免停在分割线上
  return dispatch(editor, steps, { path: [index + 2], offset: 0 })
}
