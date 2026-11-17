/**
 * 命令：把常见操作组装成 Step / Step 序列
 *
 * M1：单步命令工厂
 * M2：新增面向编辑的命令（删除区间 / 拆分段落 / 范围标记 / 块类型），供输入层组合使用
 *
 * 约定：复杂命令按需"边算边应用"，保证每一步的 removed 与实际文档一致（可逆）。
 */

import type { Attrs, Document, ElementNode, Mark, Node, TextNode } from '@/model/node'
import { createText, isElement, isText, isVoid, marksEqual } from '@/model/node'
import { normalizeMarks } from '@/model/normalize'
import { compare, comparePosition, isSamePath, type Path, type Position } from '@/model/path'
import { getChildrenAt, getNodeAt, traverse } from '@/model/traverse'
import { createSelection, selectionRange } from '@/engine/selection'
import {
  ReplaceChildrenStep,
  ReplaceTextStep,
  SetMarksStep,
  SetNodeAttrsStep,
  type Step,
} from '@/engine/step'

// ---------------------------------------------------------------------------
// M1 单步命令
// ---------------------------------------------------------------------------

export function insertText(path: Path, offset: number, text: string): Step {
  return new ReplaceTextStep(path, offset, offset, text, '')
}

export function deleteText(doc: Document, path: Path, from: number, to: number): Step {
  const node = getNodeAt(doc, path)
  if (!node || !isText(node)) throw new Error(`目标不是文本节点: ${path.join('.')}`)
  return new ReplaceTextStep(path, from, to, '', node.text.slice(from, to))
}

export function insertNodes(parentPath: Path, index: number, nodes: Node[]): Step {
  return new ReplaceChildrenStep(parentPath, index, index, nodes, [])
}

export function removeNodes(doc: Document, parentPath: Path, index: number, count: number): Step {
  const children = getChildrenAt(doc, parentPath)
  if (!children) throw new Error(`父节点不存在: ${parentPath.join('.')}`)
  const removed = children.slice(index, index + count)
  return new ReplaceChildrenStep(parentPath, index, index + count, [], removed)
}

export function setNodeAttrs(doc: Document, path: Path, patch: Attrs): Step {
  const node = getNodeAt(doc, path)
  const prevAttrs: Attrs = node && !isText(node) ? (node.attrs ?? {}) : {}
  return new SetNodeAttrsStep(path, { ...prevAttrs, ...patch }, prevAttrs)
}

export function setMarks(doc: Document, path: Path, marks: Mark[]): Step {
  const node = getNodeAt(doc, path)
  if (!node || !isText(node)) throw new Error(`目标不是文本节点: ${path.join('.')}`)
  return new SetMarksStep(path, normalizeMarks(marks), node.marks)
}

/**
 * 取光标位置处的行内格式（用于"格式续接"：输入时继承光标处文字的格式）。
 * - 光标在文本节点内：用该节点 marks
 * - 光标在元素位置（如空段落）：优先取左侧相邻文本的 marks，其次右侧
 */
export function getMarksAtPosition(doc: Document, pos: Position): Mark[] | undefined {
  const node = getNodeAt(doc, pos.path)
  if (!node) return undefined
  if (isText(node)) return node.marks
  if (isVoid(node)) return undefined
  const idx = pos.offset
  const left = idx > 0 ? node.children[idx - 1] : undefined
  const right = idx < node.children.length ? node.children[idx] : undefined
  const leftMarks = marksOfSubtree(left, 'backward')
  if (leftMarks) return leftMarks
  return marksOfSubtree(right, 'forward')
}

function marksOfSubtree(
  node: Node | undefined,
  direction: 'forward' | 'backward',
): Mark[] | undefined {
  if (!node) return undefined
  if (isText(node)) return node.marks
  if (isVoid(node)) return undefined
  const children = direction === 'forward' ? node.children : [...node.children].reverse()
  for (const child of children) {
    const marks = marksOfSubtree(child, direction)
    if (marks) return marks
  }
  return undefined
}

/** 找节点内最后一个文本节点（用于代码块元素位置回车时定位末尾） */
function findLastTextInNode(node: Node, path: Path): { path: Path; node: TextNode } | undefined {
  if (isText(node)) return { path, node }
  if (isVoid(node)) return undefined
  for (let i = node.children.length - 1; i >= 0; i--) {
    const found = findLastTextInNode(node.children[i], [...path, i])
    if (found) return found
  }
  return undefined
}

// ---------------------------------------------------------------------------
// M2 编辑命令（返回 Step 序列）
// ---------------------------------------------------------------------------

/** 在任意位置插入文本（path 可指向文本节点或元素节点） */
export function insertTextAt(
  doc: Document,
  pos: Position,
  text: string,
  marks?: Mark[],
): { steps: Step[]; caret: Position } {
  const node = getNodeAt(doc, pos.path)
  if (!node) throw new Error(`位置不存在: ${pos.path.join('.')}`)
  if (isText(node)) {
    // 带 marks 的插入（如修订模式 / 待输入格式）：若新格式与当前节点不同，
    // 在插入点拆分文本节点，只给新文本加标记；若相同则直接替换（光标路径更稳）。
    const sameMarks = marksEqual(normalizeMarks(node.marks) ?? [], normalizeMarks(marks) ?? [])
    if (marks !== undefined && !sameMarks) {
      const parentPath = pos.path.slice(0, -1)
      const index = pos.path[pos.path.length - 1]
      const parts: Node[] = []
      if (pos.offset > 0) parts.push(createText(node.text.slice(0, pos.offset), node.marks))
      const newIndex = index + (pos.offset > 0 ? 1 : 0)
      parts.push(createText(text, marks))
      if (pos.offset < node.text.length)
        parts.push(createText(node.text.slice(pos.offset), node.marks))
      return {
        steps: [new ReplaceChildrenStep(parentPath, index, index + 1, parts, [node])],
        caret: { path: [...parentPath, newIndex], offset: text.length },
      }
    }
    return {
      steps: [new ReplaceTextStep(pos.path, pos.offset, pos.offset, text, '')],
      caret: { path: pos.path, offset: pos.offset + text.length },
    }
  }
  if (isElement(node)) {
    return {
      steps: [
        new ReplaceChildrenStep(pos.path, pos.offset, pos.offset, [createText(text, marks)], []),
      ],
      caret: { path: [...pos.path, pos.offset], offset: text.length },
    }
  }
  throw new Error('不能在 void 节点中插入文本')
}

/** 删除 range（from / to 顺序无关） */
export function deleteRange(doc: Document, from: Position, to: Position): Step[] {
  const { from: a, to: b } = selectionRange(createSelection(from, to))
  if (comparePosition(a, b) === 0) return []

  const nodeA = getNodeAt(doc, a.path)

  // 同一文本节点
  if (isSamePath(a.path, b.path)) {
    if (nodeA && isText(nodeA)) {
      return [
        new ReplaceTextStep(a.path, a.offset, b.offset, '', nodeA.text.slice(a.offset, b.offset)),
      ]
    }
    return []
  }

  const parentA = a.path.slice(0, -1)
  const parentB = b.path.slice(0, -1)
  if (isSamePath(parentA, parentB)) {
    return deleteWithinParent(doc, parentA, a, b)
  }
  return deleteAcrossBlocks(doc, a, b)
}

function deleteWithinParent(doc: Document, parentPath: Path, a: Position, b: Position): Step[] {
  const parent = getNodeAt(doc, parentPath)
  if (!parent || !isElement(parent)) throw new Error('父节点不是元素')
  const indexA = a.path[a.path.length - 1]
  const indexB = b.path[b.path.length - 1]
  if (indexA === indexB) {
    const child = getNodeAt(doc, a.path)
    if (child && isElement(child)) {
      return deleteRange(
        doc,
        { path: a.path, offset: a.offset },
        { path: b.path, offset: b.offset },
      )
    }
    return []
  }
  const children = parent.children
  const nodeA = children[indexA]
  const nodeB = children[indexB]
  const inserted: Node[] = []
  // 保留 a 节点中偏移之前的部分（偏移 > 0 才有内容可留）
  if (isText(nodeA) && a.offset > 0) {
    inserted.push(createText(nodeA.text.slice(0, a.offset), nodeA.marks))
  }
  // 保留 b 节点中偏移之后的部分
  if (isText(nodeB) && b.offset < nodeB.text.length) {
    inserted.push(createText(nodeB.text.slice(b.offset), nodeB.marks))
  }
  const removed = children.slice(indexA, indexB + 1)
  return [new ReplaceChildrenStep(parentPath, indexA, indexB + 1, inserted, removed)]
}

function deleteAcrossBlocks(doc: Document, a: Position, b: Position): Step[] {
  const blockA = a.path[0]
  const blockB = b.path[0]
  if (blockA === blockB) return deleteWithinParent(doc, [blockA], a, b)

  const steps: Step[] = []
  let working = doc

  // 1. 删除 blockA 中 a 之后的内容
  const nodeA = getNodeAt(working, a.path)
  const blockANode = working.children[blockA]
  if (!blockANode || !isElement(blockANode)) throw new Error('块不存在')
  const inlineIndexA = a.path.length > 1 ? a.path[1] : blockANode.children.length
  const insertedA: Node[] = []
  if (nodeA && isText(nodeA) && nodeA.text.length > a.offset) {
    insertedA.push(createText(nodeA.text.slice(0, a.offset), nodeA.marks))
  }
  steps.push(
    new ReplaceChildrenStep(
      [blockA],
      inlineIndexA,
      blockANode.children.length,
      insertedA,
      blockANode.children.slice(inlineIndexA),
    ),
  )
  working = steps[steps.length - 1].apply(working)

  // 2. 删除 blockB 中 b 之前的内容
  const blockBNode = working.children[blockB]
  if (!blockBNode || !isElement(blockBNode)) throw new Error('块不存在')
  const nodeB = getNodeAt(working, b.path)
  const inlineIndexB = b.path.length > 1 ? b.path[1] : 0
  const insertedB: Node[] = []
  if (nodeB && isText(nodeB) && nodeB.text.length > b.offset) {
    insertedB.push(createText(nodeB.text.slice(b.offset), nodeB.marks))
  }
  steps.push(
    new ReplaceChildrenStep(
      [blockB],
      0,
      inlineIndexB + 1,
      insertedB,
      blockBNode.children.slice(0, inlineIndexB + 1),
    ),
  )
  working = steps[steps.length - 1].apply(working)

  // 3. 把 blockB 剩余内容并入 blockA
  const mergedB = working.children[blockB]
  const target = working.children[blockA]
  if (!mergedB || !isElement(mergedB) || !target || !isElement(target)) throw new Error('块不存在')
  steps.push(
    new ReplaceChildrenStep(
      [blockA],
      target.children.length,
      target.children.length,
      mergedB.children,
      [],
    ),
  )
  working = steps[steps.length - 1].apply(working)

  // 4. 删除 blockB
  steps.push(new ReplaceChildrenStep([], blockB, blockB + 1, [], [working.children[blockB]]))

  return steps
}

/** 退格删除（光标处或选区） */
export function deleteBackward(doc: Document, from: Position, to?: Position): Step[] {
  if (to && comparePosition(from, to) !== 0) return deleteRange(doc, from, to)
  const node = getNodeAt(doc, from.path)
  if (node && isText(node) && from.offset > 0) {
    return [
      new ReplaceTextStep(from.path, from.offset - 1, from.offset, '', node.text[from.offset - 1]),
    ]
  }

  // 光标在嵌套块开头（如 list_item / blockquote 里的段落）
  if (from.path.length >= 3) {
    const steps = backspaceAtNestedStart(doc, from)
    if (steps) return steps
  }

  const blockIndex = from.path[0]
  if (blockIndex > 0) return mergeBlocks(doc, blockIndex - 1, blockIndex)
  return []
}

/**
 * 嵌套块开头退格：
 * - 段落不是容器的第一个块 → 并入前一个兄弟块
 * - list_item 不是 list 的第一个条目 → 并入前一条目的最后一个块
 * - 否则退出容器（list / blockquote）
 */
function backspaceAtNestedStart(doc: Document, from: Position): Step[] | undefined {
  const node = getNodeAt(doc, from.path)
  if (!node) return undefined
  // 光标所在段落：文本位置取其父块，元素位置（空块）即该块本身
  const paragraphPath = isText(node) ? from.path.slice(0, -1) : from.path
  if (paragraphPath.length < 2) return undefined
  const containerPath = paragraphPath.slice(0, -1)
  const container = getNodeAt(doc, containerPath)
  if (!container || !isElement(container)) return undefined
  const paragraphIndex = paragraphPath[paragraphPath.length - 1]

  if (paragraphIndex > 0) {
    return mergeBlocksAt(doc, containerPath, paragraphIndex - 1, paragraphIndex)
  }

  // list_item 且不是 list 的第一个条目：并入前一条目
  if (containerPath.length >= 2) {
    const listPath = containerPath.slice(0, -1)
    const list = getNodeAt(doc, listPath)
    const itemIndex = containerPath[containerPath.length - 1]
    const curItem = container
    if (list && isElement(list) && LIST_TYPES.has(list.type) && itemIndex > 0) {
      const prevItem = list.children[itemIndex - 1]
      const curFirst = curItem.children[0]
      if (prevItem && isElement(prevItem) && curFirst && isElement(curFirst)) {
        const prevLast = prevItem.children[prevItem.children.length - 1]
        if (prevLast && isElement(prevLast)) {
          const prevLastPath = [...listPath, itemIndex - 1, prevItem.children.length - 1]
          const steps: Step[] = [
            new ReplaceChildrenStep(
              prevLastPath,
              prevLast.children.length,
              prevLast.children.length,
              curFirst.children,
              [],
            ),
            new ReplaceChildrenStep(containerPath, 0, 1, [], [curFirst]),
          ]
          if (curItem.children.length === 1) {
            steps.push(new ReplaceChildrenStep(listPath, itemIndex, itemIndex + 1, [], [curItem]))
          }
          return steps
        }
      }
    }
  }

  return exitNestedBlock(doc, containerPath)
}

/** 向前删除（光标处或选区） */
export function deleteForward(doc: Document, from: Position, to?: Position): Step[] {
  if (to && comparePosition(from, to) !== 0) return deleteRange(doc, from, to)
  const node = getNodeAt(doc, from.path)
  if (node && isText(node) && from.offset < node.text.length) {
    return [
      new ReplaceTextStep(from.path, from.offset, from.offset + 1, '', node.text[from.offset]),
    ]
  }

  // 光标在嵌套块末尾：优先并入后一个兄弟块
  if (from.path.length >= 3) {
    const containerPath = from.path.slice(0, -2)
    const container = getNodeAt(doc, containerPath)
    const innerIndex = from.path[from.path.length - 2]
    if (container && isElement(container) && innerIndex < container.children.length - 1) {
      return mergeBlocksAt(doc, containerPath, innerIndex, innerIndex + 1)
    }
  }

  const blockIndex = from.path[0]
  if (blockIndex < doc.children.length - 1) return mergeBlocks(doc, blockIndex, blockIndex + 1)
  return []
}

/** 把 parentPath 下第二个块的内容并入第一个块，并删除第二个块 */
function mergeBlocksAt(doc: Document, parentPath: Path, first: number, second: number): Step[] {
  const children = getChildrenAt(doc, parentPath)
  if (!children) return []
  const firstNode = children[first]
  const secondNode = children[second]
  if (!firstNode || !isElement(firstNode) || !secondNode || !isElement(secondNode)) return []
  return [
    // 把第二个块的内容追加到第一个块（父路径 = 第一个块）
    new ReplaceChildrenStep(
      [...parentPath, first],
      firstNode.children.length,
      firstNode.children.length,
      secondNode.children,
      [],
    ),
    // 从父节点删除第二个块
    new ReplaceChildrenStep(parentPath, second, second + 1, [], [secondNode]),
  ]
}

function mergeBlocks(doc: Document, first: number, second: number): Step[] {
  return mergeBlocksAt(doc, [], first, second)
}

/**
 * 退出嵌套容器（list_item / blockquote）：把容器内容提升到顶层。
 * - list_item 在 list 里：把该条目的块插到 list 之前，并移除空掉的 list
 * - blockquote 等：直接剥掉容器
 */
function exitNestedBlock(doc: Document, containerPath: Path): Step[] {
  const container = getNodeAt(doc, containerPath)
  if (!container || !isElement(container)) return []
  const parentPath = containerPath.slice(0, -1)
  const parent = parentPath.length === 0 ? undefined : getNodeAt(doc, parentPath)
  const index = containerPath[containerPath.length - 1]

  if (parent && isElement(parent) && LIST_TYPES.has(parent.type)) {
    const listPath = parentPath
    const list = parent
    const item = container
    const steps: Step[] = [new ReplaceChildrenStep(listPath, index, index + 1, [], [item])]
    if (list.children.length === 1) {
      steps.push(new ReplaceChildrenStep([], listPath[0], listPath[0] + 1, [], [list]))
    }
    steps.push(new ReplaceChildrenStep([], listPath[0], listPath[0], item.children, []))
    return steps
  }

  return [new ReplaceChildrenStep(parentPath, index, index + 1, container.children, [container])]
}

/**
 * 在光标处拆分块（Enter）。
 * 支持嵌套结构（如 blockquote > paragraph > text）：
 * 拆分发生在文本节点所在的**父块**，后半段进入一个与父块同类型的新块。
 *
 * `allowCodeBlockExit`：代码块只有"连续第二次回车"才允许退出（由输入层判断并传入）。
 */
export function splitBlock(
  doc: Document,
  pos: Position,
  allowCodeBlockExit = false,
): { steps: Step[]; caret: Position } {
  const blockIndex = pos.path[0]
  const block = doc.children[blockIndex]
  if (!block || !isElement(block)) throw new Error('光标不在块内')
  const node = getNodeAt(doc, pos.path)

  // 光标在元素位置（如空块）
  if (!node || !isText(node)) {
    const parentPath = pos.path.slice(0, -1)
    const index = pos.path[pos.path.length - 1]

    // 顶层空块（或路径无效）
    if (parentPath.length === 0 || !node) {
      const type = node !== undefined && isElement(node) ? node.type : block.type
      // 空标题：直接变成正文段落（WPS：回车两次退出）
      if (type === 'heading') {
        const replaceStep = new ReplaceChildrenStep(
          [],
          blockIndex,
          blockIndex + 1,
          [createElementNode('paragraph', [])],
          [block],
        )
        return { steps: [replaceStep], caret: { path: [blockIndex], offset: 0 } }
      }
      // 代码块：光标落在元素位置（如点到代码块空白处）时，
      // 块内已有内容则在末尾换行，不能把代码块连同内容变成段落；
      // 只有真正空的代码块才变成正文段落。
      if (type === 'code_block') {
        const lastText = findLastTextInNode(block, [blockIndex])
        if (lastText && isText(lastText.node)) {
          const len = lastText.node.text.length
          return {
            steps: [new ReplaceTextStep(lastText.path, len, len, '\n', '')],
            caret: { path: lastText.path, offset: len + 1 },
          }
        }
        const replaceStep = new ReplaceChildrenStep(
          [],
          blockIndex,
          blockIndex + 1,
          [createElementNode('paragraph', [])],
          [block],
        )
        return { steps: [replaceStep], caret: { path: [blockIndex], offset: 0 } }
      }
      const newBlockStep = new ReplaceChildrenStep(
        [],
        blockIndex + 1,
        blockIndex + 1,
        [createElementNode(type, [], type === block.type ? block.attrs : undefined)],
        [],
      )
      return { steps: [newBlockStep], caret: { path: [blockIndex + 1], offset: 0 } }
    }

    const parent = getNodeAt(doc, parentPath)

    // 空块在容器（引用）里：回车退出容器，已写内容保留。
    // list_item 也是"容器"类，但列表项内回车由 splitListItem 处理，不在此退出。
    if (
      parent &&
      isElement(parent) &&
      parent.type !== 'list_item' &&
      blockCategory(parent.type) === 'container'
    ) {
      const grandParentPath = parentPath.slice(0, -1)
      const parentIndex = parentPath[parentPath.length - 1]
      const steps: Step[] = [new ReplaceChildrenStep(parentPath, index, index + 1, [], [node])]
      if (parent.children.length === 1) {
        // 容器里只有这个空块：整个容器变成正文段落
        steps.push(
          new ReplaceChildrenStep(
            grandParentPath,
            parentIndex,
            parentIndex + 1,
            [createElementNode('paragraph', [])],
            [parent],
          ),
        )
        return { steps, caret: { path: [...grandParentPath, parentIndex], offset: 0 } }
      }
      // 否则在容器后面补一个正文段落，原容器内容不动
      steps.push(
        new ReplaceChildrenStep(
          grandParentPath,
          parentIndex + 1,
          parentIndex + 1,
          [createElementNode('paragraph', [])],
          [],
        ),
      )
      return { steps, caret: { path: [...grandParentPath, parentIndex + 1], offset: 0 } }
    }

    // 嵌套空块（列表里的空段落等）：在容器内继续，不脱离容器；
    // 标题 / 代码块上回车回到正文
    const nodeType = isElement(node) ? node.type : 'paragraph'
    const nodeAttrs = isElement(node) ? node.attrs : undefined
    const newType = nodeType === 'heading' || nodeType === 'code_block' ? 'paragraph' : nodeType
    const newBlockStep = new ReplaceChildrenStep(
      parentPath,
      index + 1,
      index + 1,
      [createElementNode(newType, [], newType === nodeType ? nodeAttrs : undefined)],
      [],
    )
    return { steps: [newBlockStep], caret: { path: [...parentPath, index + 1], offset: 0 } }
  }

  // 文本节点的父块：顶层块（path 长度 1）或嵌套块（如 blockquote 里的 paragraph）
  const parentPath = pos.path.slice(0, -1)
  const parent = getNodeAt(doc, parentPath)
  if (!parent || !isElement(parent)) throw new Error('光标所在父节点不是元素')
  const textIndex = pos.path[pos.path.length - 1]
  const grandParentPath = parentPath.slice(0, -1)
  const parentIndex = parentPath[parentPath.length - 1]

  const before = createText(node.text.slice(0, pos.offset), node.marks)
  const after = createText(node.text.slice(pos.offset), node.marks)
  const rest = parent.children.slice(textIndex + 1)

  // 代码块内回车（与引用 / 列表一致）：
  // - 当前行有内容 → 块内换行（仍是同一个 code_block，视觉上是一个整体）
  // - 光标停在最后一行空行上 → 连续第二次回车，退出代码块，已写内容保留
  if (parent.type === 'code_block') {
    const text = node.text
    const beforeText = text.slice(0, pos.offset)
    const afterText = text.slice(pos.offset)
    const lineStart = beforeText.lastIndexOf('\n') + 1
    const lineEnd = afterText.indexOf('\n')
    const currentLine =
      beforeText.slice(lineStart) + (lineEnd >= 0 ? afterText.slice(0, lineEnd) : afterText)
    const hasContentAfter =
      afterText.trim() !== '' || rest.some((child) => isText(child) && child.text.trim() !== '')

    if (allowCodeBlockExit && currentLine.trim() === '' && !hasContentAfter) {
      const steps: Step[] = []
      if (pos.offset > 0 && text[pos.offset - 1] === '\n') {
        steps.push(new ReplaceTextStep(pos.path, pos.offset - 1, pos.offset, '', '\n'))
      }
      steps.push(
        new ReplaceChildrenStep(
          grandParentPath,
          parentIndex + 1,
          parentIndex + 1,
          [createElementNode('paragraph', [])],
          [],
        ),
      )
      return { steps, caret: { path: [...grandParentPath, parentIndex + 1], offset: 0 } }
    }

    return {
      steps: [new ReplaceTextStep(pos.path, pos.offset, pos.offset, '\n', '')],
      caret: { path: pos.path, offset: pos.offset + 1 },
    }
  }

  // Word/WPS：在标题块末尾回车，新块回到正文；标题中间回车仍拆成标题
  const atEndOfBlock = pos.offset === node.text.length && rest.length === 0
  const newType = atEndOfBlock && parent.type === 'heading' ? 'paragraph' : parent.type
  const newAttrs = newType === parent.type ? parent.attrs : undefined

  return {
    steps: [
      // 原文本节点及其后续兄弟，替换为前半段
      // （后半段与后续兄弟会移到新块，必须从原块移除，否则内容会被复制）
      new ReplaceChildrenStep(
        parentPath,
        textIndex,
        parent.children.length,
        [before],
        [node, ...rest],
      ),
      // 后半段 + 后续兄弟节点，移入一个新块
      new ReplaceChildrenStep(
        grandParentPath,
        parentIndex + 1,
        parentIndex + 1,
        [createElementNode(newType, [after, ...rest], newAttrs)],
        [],
      ),
    ],
    caret: { path: [...grandParentPath, parentIndex + 1, 0], offset: 0 },
  }
}

/** 在选区范围内切换 mark（跨文本节点时自动拆分；可携带 attrs，如 link 的 href） */
export function toggleMark(
  doc: Document,
  from: Position,
  to: Position,
  markType: string,
  markAttrs?: Attrs,
): Step[] {
  const { from: a, to: b } = selectionRange(createSelection(from, to))
  if (comparePosition(a, b) === 0) return []

  const entries: { path: Path; text: string; marks: Mark[] | undefined }[] = []
  traverse(doc, (entry) => {
    if (isText(entry.node)) {
      entries.push({ path: entry.path, text: entry.node.text, marks: entry.node.marks })
    }
    return undefined
  })

  const inRange = entries.filter(
    (entry) => compare(entry.path, a.path) >= 0 && compare(entry.path, b.path) <= 0,
  )
  // 逆序处理，避免拆分导致的索引偏移影响后续步骤
  inRange.sort((x, y) => compare(y.path, x.path))

  const steps: Step[] = []
  for (const entry of inRange) {
    const start = isSamePath(entry.path, a.path) ? a.offset : 0
    const end = isSamePath(entry.path, b.path) ? b.offset : entry.text.length
    if (start >= end) continue

    const marks = entry.marks ?? []
    const has = marks.some((mark) => mark.type === markType)
    const next = has
      ? marks.filter((mark) => mark.type !== markType)
      : [...marks, markAttrs ? { type: markType, attrs: markAttrs } : { type: markType }]

    const parentPath = entry.path.slice(0, -1)
    const index = entry.path[entry.path.length - 1]

    if (start === 0 && end === entry.text.length) {
      steps.push(new SetMarksStep(entry.path, normalizeMarks(next), entry.marks))
      continue
    }

    const parts: Node[] = []
    if (start > 0) parts.push(createText(entry.text.slice(0, start), entry.marks))
    parts.push(createText(entry.text.slice(start, end), entry.marks))
    if (end < entry.text.length) parts.push(createText(entry.text.slice(end), entry.marks))
    const splitStep = new ReplaceChildrenStep(parentPath, index, index + 1, parts, [
      createText(entry.text, entry.marks),
    ])
    const middlePath = [...parentPath, index + (start > 0 ? 1 : 0)]
    steps.push(splitStep)
    steps.push(new SetMarksStep(middlePath, normalizeMarks(next), entry.marks))
  }
  return steps
}

// ---------------------------------------------------------------------------
// 块级命令（M2 工具栏）
// ---------------------------------------------------------------------------

/** 行内容器：子节点是 inline 节点（文本 / 图片 / 链接等） */
const INLINE_BLOCK_TYPES = new Set(['paragraph', 'heading', 'code_block'])
/** 列表：子节点是 list_item */
const LIST_TYPES = new Set(['bullet_list', 'ordered_list'])

type BlockCategory = 'inline' | 'list' | 'container'

function blockCategory(type: string): BlockCategory {
  if (INLINE_BLOCK_TYPES.has(type)) return 'inline'
  if (LIST_TYPES.has(type)) return 'list'
  return 'container'
}

/** 递归提取节点里的行内容（用于块类型转换时摊平嵌套结构） */
function toInlineContent(node: Node): Node[] {
  if (isText(node)) return [node]
  if (isVoid(node)) return []
  if (INLINE_BLOCK_TYPES.has(node.type)) return node.children
  return node.children.flatMap(toInlineContent)
}

/** 替换节点类型，保留子节点与 attrs */
function changeType(node: Node, targetType: string, attrs?: Attrs): Node {
  if (!isElement(node)) return node
  return createElementNode(targetType, node.children, attrs)
}

/**
 * 按目标块类型把源块转换成 0..n 个新块：
 * - inline（paragraph / heading / code_block）↔ container（blockquote 等）需要包一层 / 剥一层 paragraph
 * - list（bullet_list / ordered_list）↔ 非 list 需要剥掉 list_item（每个条目成为独立的块）
 */
function convertBlocks(block: Node, targetType: string, attrs?: Attrs): Node[] {
  if (!isElement(block)) return []
  const source = blockCategory(block.type)
  const target = blockCategory(targetType)

  if (target === 'list') {
    if (source === 'list') return [createElementNode(targetType, block.children, attrs)]
    const content = source === 'inline' ? block.children : toInlineContent(block)
    return [
      createElementNode(
        targetType,
        [createElementNode('list_item', [createElementNode('paragraph', content)])],
        attrs,
      ),
    ]
  }

  if (target === 'inline') {
    if (source === 'inline') return [createElementNode(targetType, block.children, attrs)]
    if (source === 'list') {
      // 每个 list_item 的块内容各自成为顶层块（保留条目边界）
      return block.children.flatMap((item) => (isElement(item) ? item.children : []))
    }
    // container → inline：每个子块改类型
    return block.children.map((child) => changeType(child, targetType, attrs))
  }

  // 目标为块容器（blockquote 等）
  if (source === 'inline') {
    return [createElementNode(targetType, [createElementNode('paragraph', block.children)], attrs)]
  }
  if (source === 'list') {
    const items = block.children.flatMap((item) => (isElement(item) ? item.children : []))
    return [createElementNode(targetType, items, attrs)]
  }
  return [createElementNode(targetType, block.children, attrs)]
}

/** 转换块类型（paragraph ↔ heading / blockquote / list 等），按目标类型整理子节点结构 */
export function setBlockType(doc: Document, blockPath: Path, type: string, attrs?: Attrs): Step[] {
  const parentPath = blockPath.slice(0, -1)
  const index = blockPath[blockPath.length - 1]
  const block = getNodeAt(doc, blockPath)
  if (index === undefined || !block || !isElement(block)) throw new Error('块不存在')
  const merged: Attrs = { ...(block.attrs ?? {}), ...(attrs ?? {}) }
  const newAttrs = Object.keys(merged).length > 0 ? merged : undefined
  const blocks = convertBlocks(block, type, newAttrs)
  return [new ReplaceChildrenStep(parentPath, index, index + 1, blocks, [block])]
}

/** 把块包进列表（list > list_item > 原内容） */
export function wrapInList(
  doc: Document,
  blockPath: Path,
  listType: 'bullet_list' | 'ordered_list',
): Step[] {
  const index = blockPath[0]
  const block = doc.children[index]
  if (!block || !isElement(block)) throw new Error('块不存在')
  const list = createElementNode(listType, [
    createElementNode('list_item', [createElementNode('paragraph', block.children)]),
  ])
  return [new ReplaceChildrenStep([], index, index + 1, [list], [block])]
}

/** 判断是否为列表节点 */
export function isListNode(node: Node | undefined): node is ElementNode {
  return !!node && isElement(node) && LIST_TYPES.has(node.type)
}

/** 列表项内容是否为空（没有非空白文本） */
function listItemEmpty(item: ElementNode): boolean {
  return toInlineContent(item).every((n) => !isText(n) || n.text.trim() === '')
}

/**
 * 列表项内回车（Word / WPS 行为）：
 * - 非空项 → 在当前项后新建一个同类型列表项，光标后的内容移过去
 * - 空项   → 退出列表：光标落到列表后的正文段落；
 *   已写条目仍保留在列表里（编号 / 圆点不丢）
 */
export function splitListItem(
  doc: Document,
  pos: Position,
): { steps: Step[]; caret: Position } | undefined {
  const listIndex = pos.path[0]
  const itemIndex = pos.path[1]
  const list = doc.children[listIndex]
  if (!isListNode(list)) return undefined
  const item = list.children[itemIndex]
  if (!item || !isElement(item)) return undefined
  const pIndex = pos.path[2]
  const paragraph = item.children[pIndex]
  if (!paragraph || !isElement(paragraph)) return undefined
  const textIndex = pos.path[pos.path.length - 1]

  // 空项 → 退出列表
  if (listItemEmpty(item)) {
    // 空项是最后一项且前面还有已写条目：
    // 保留列表（条目与编号 / 圆点不动），只移除空项，并在列表后补一个正文段落
    if (itemIndex > 0 && itemIndex === list.children.length - 1) {
      return {
        steps: [
          new ReplaceChildrenStep([listIndex], itemIndex, itemIndex + 1, [], [item]),
          new ReplaceChildrenStep(
            [],
            listIndex + 1,
            listIndex + 1,
            [createElementNode('paragraph', [])],
            [],
          ),
        ],
        caret: { path: [listIndex + 1], offset: 0 },
      }
    }

    // 空项是第一个 / 唯一项：整个列表变成正文段落
    const blocks: Node[] = []
    list.children.forEach((child, i) => {
      if (!isElement(child)) return
      if (i === itemIndex) blocks.push(createElementNode('paragraph', []))
      else blocks.push(...child.children)
    })
    return {
      steps: [new ReplaceChildrenStep([], listIndex, listIndex + 1, blocks, [list])],
      caret: { path: [listIndex + itemIndex], offset: 0 },
    }
  }

  // 非空 → 拆分内容，新建 item
  const beforeChildren: Node[] = []
  const afterChildren: Node[] = []
  for (let i = 0; i < paragraph.children.length; i++) {
    const child = paragraph.children[i]
    if (i < textIndex) {
      beforeChildren.push(child)
    } else if (i > textIndex) {
      afterChildren.push(child)
    } else if (isText(child)) {
      if (pos.offset > 0)
        beforeChildren.push(createText(child.text.slice(0, pos.offset), child.marks))
      if (pos.offset < child.text.length) {
        afterChildren.push(createText(child.text.slice(pos.offset), child.marks))
      }
    } else {
      beforeChildren.push(child)
    }
  }

  const before = createElementNode(paragraph.type, beforeChildren, paragraph.attrs)
  const after = createElementNode(paragraph.type, afterChildren, paragraph.attrs)
  const rest = item.children.slice(pIndex + 1)

  return {
    steps: [
      // 原 item 只保留拆分点之前的内容
      new ReplaceChildrenStep(
        [listIndex, itemIndex],
        pIndex,
        item.children.length,
        [before],
        [paragraph, ...rest],
      ),
      // 新建 item：拆分点之后的内容 + 原 item 后续块
      new ReplaceChildrenStep(
        [listIndex],
        itemIndex + 1,
        itemIndex + 1,
        [createElementNode('list_item', [after, ...rest])],
        [],
      ),
    ],
    caret: { path: [listIndex, itemIndex + 1, 0, 0], offset: 0 },
  }
}

// ---------------------------------------------------------------------------
// 列表缩进（Tab / Shift+Tab）
// ---------------------------------------------------------------------------

export interface ListItemLocation {
  listPath: Path
  itemPath: Path
  itemIndex: number
  list: ElementNode
  item: ElementNode
}

/** 从光标位置向上找到所在的 list_item 及其所属列表（可能是嵌套列表） */
export function locateListItem(doc: Document, pos: Position): ListItemLocation | undefined {
  for (let len = pos.path.length; len >= 2; len--) {
    const itemPath = pos.path.slice(0, len)
    const node = getNodeAt(doc, itemPath)
    if (!node || !isElement(node) || node.type !== 'list_item') continue
    const listPath = itemPath.slice(0, -1)
    const list = getNodeAt(doc, listPath)
    if (!list || !isElement(list) || !LIST_TYPES.has(list.type)) continue
    return { listPath, itemPath, itemIndex: itemPath[itemPath.length - 1], list, item: node }
  }
  return undefined
}

/**
 * 缩进列表项（Tab）：把当前条目移动为前一个条目的嵌套子列表。
 * 第一个条目没有前驱，不处理。
 */
export function indentListItem(
  doc: Document,
  pos: Position,
): { steps: Step[]; caret: Position } | undefined {
  const loc = locateListItem(doc, pos)
  if (!loc || loc.itemIndex === 0) return undefined
  const prev = loc.list.children[loc.itemIndex - 1]
  if (!prev || !isElement(prev)) return undefined

  const nested = createElementNode(loc.list.type, [loc.item], loc.list.attrs)
  const steps: Step[] = [
    // 从原列表移除当前条目
    new ReplaceChildrenStep(loc.listPath, loc.itemIndex, loc.itemIndex + 1, [], [loc.item]),
    // 作为嵌套列表追加到前一个条目
    new ReplaceChildrenStep(
      [...loc.listPath, loc.itemIndex - 1],
      prev.children.length,
      prev.children.length,
      [nested],
      [],
    ),
  ]
  const caretPath = [
    ...loc.listPath,
    loc.itemIndex - 1,
    prev.children.length,
    ...pos.path.slice(loc.itemPath.length),
  ]
  return { steps, caret: { path: caretPath, offset: pos.offset } }
}

/**
 * 取消缩进（Shift+Tab）：把当前条目提升到外层列表，成为外层条目的兄弟。
 * 已是最外层列表时不处理。
 */
export function outdentListItem(
  doc: Document,
  pos: Position,
): { steps: Step[]; caret: Position } | undefined {
  const loc = locateListItem(doc, pos)
  if (!loc) return undefined
  const outerItemPath = loc.listPath.slice(0, -1)
  const outerItem = getNodeAt(doc, outerItemPath)
  if (!outerItem || !isElement(outerItem)) return undefined
  const outerListPath = outerItemPath.slice(0, -1)
  const outerList = getNodeAt(doc, outerListPath)
  if (!outerList || !isElement(outerList)) return undefined
  const outerItemIndex = outerItemPath[outerItemPath.length - 1]
  const listIndexInItem = loc.listPath[loc.listPath.length - 1]

  const steps: Step[] = [
    new ReplaceChildrenStep(loc.listPath, loc.itemIndex, loc.itemIndex + 1, [], [loc.item]),
  ]
  if (loc.list.children.length === 1) {
    // 子列表空了，一并移除
    steps.push(
      new ReplaceChildrenStep(outerItemPath, listIndexInItem, listIndexInItem + 1, [], [loc.list]),
    )
  }
  steps.push(
    new ReplaceChildrenStep(outerListPath, outerItemIndex + 1, outerItemIndex + 1, [loc.item], []),
  )
  const caretPath = [...outerListPath, outerItemIndex + 1, ...pos.path.slice(loc.itemPath.length)]
  return { steps, caret: { path: caretPath, offset: pos.offset } }
}

/**
 * 多块选区切换列表：
 * - 选中的块都是同类型列表 → 全部退出列表（条目内容提升为顶层块）
 * - 否则 → 合并为一个 listType 列表（每个块一个条目）
 */
export function toggleListBlocks(
  doc: Document,
  fromIndex: number,
  toIndex: number,
  listType: 'bullet_list' | 'ordered_list',
): Step[] {
  const blocks = doc.children.slice(fromIndex, toIndex + 1)
  if (blocks.length === 0) return []
  const allSameList = blocks.every((block) => isElement(block) && block.type === listType)
  if (allSameList) {
    const inserted: Node[] = []
    for (const block of blocks) {
      if (!isElement(block)) continue
      for (const item of block.children) {
        if (isElement(item)) inserted.push(...item.children)
      }
    }
    return [new ReplaceChildrenStep([], fromIndex, toIndex + 1, inserted, blocks)]
  }
  const items: Node[] = []
  for (const block of blocks) {
    if (!isElement(block)) continue
    if (block.type === 'bullet_list' || block.type === 'ordered_list') {
      // 已有列表：条目标配进新列表
      items.push(...block.children)
      continue
    }
    items.push(createElementNode('list_item', [createElementNode('paragraph', block.children)]))
  }
  if (items.length === 0) return []
  return [
    new ReplaceChildrenStep(
      [],
      fromIndex,
      toIndex + 1,
      [createElementNode(listType, items)],
      blocks,
    ),
  ]
}

/** 把列表还原为普通块（每个 list_item 的块内容各自成为顶层块） */
export function unwrapFromList(doc: Document, listPath: Path): Step[] {
  const parentPath = listPath.slice(0, -1)
  const listIndex = listPath[listPath.length - 1]
  const list = getNodeAt(doc, listPath)
  if (listIndex === undefined || !list || !isElement(list)) throw new Error('列表不存在')
  const blocks: Node[] = []
  for (const item of list.children) {
    if (isElement(item)) blocks.push(...item.children)
  }
  if (blocks.length === 0) throw new Error('列表项不存在')
  return [new ReplaceChildrenStep(parentPath, listIndex, listIndex + 1, blocks, [list])]
}

function createElementNode(type: string, children: Node[], attrs?: Attrs): Node {
  return attrs ? { type, attrs, children } : { type, children }
}
