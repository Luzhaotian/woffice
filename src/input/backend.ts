/**
 * Contenteditable 输入后端（M2）
 *
 * 策略：拦截 beforeinput，把浏览器输入转换为引擎步骤（model 为唯一真相源）；
 * IME 组合期间不拦截，compositionend 时读取 DOM 文本同步回模型。
 * 光标 / 选区由 Renderer 维护。
 */

import type { Document, Mark } from '@/model/node'
import { createText, isElement, isText, isVoid } from '@/model/node'
import type { Path, Position } from '@/model/path'
import { isCollapsed, selectionRange } from '@/engine/selection'
import type { Step } from '@/engine/step'
import { ReplaceChildrenStep, ReplaceTextStep } from '@/engine/step'
import type { TextSelection } from '@/engine/selection'
import { comparePosition, isSamePath } from '@/model/path'
import { getNodeAt, traverse } from '@/model/traverse'
import {
  deleteBackward,
  deleteForward,
  deleteRange,
  insertTextAt,
  splitBlock,
  splitListItem,
} from '@/engine/commands'
import type { Editor } from '@/editor'
import type { Renderer } from '@/render/renderer'

export class ContenteditableBackend {
  private composing = false
  private compositionPosition: Position | undefined
  private skipInsertComposition = false
  /** 代码块内"连续第二次回车退出"：记录上一次回车插入换行的时间与光标 */
  private codeBlockEnterAt = 0
  private codeBlockEnterPos: Position | undefined

  constructor(
    private editor: Editor,
    private content: HTMLElement,
    private renderer: Renderer,
  ) {}

  mount(): void {
    this.content.addEventListener('beforeinput', this.handleBeforeInput)
    this.content.addEventListener('compositionstart', this.handleCompositionStart)
    this.content.addEventListener('compositionupdate', this.handleCompositionUpdate)
    this.content.addEventListener('compositionend', this.handleCompositionEnd)
    this.content.addEventListener('paste', this.handlePaste)
    this.content.addEventListener('copy', this.handleCopy)
    this.content.addEventListener('cut', this.handleCut)
    this.content.addEventListener('keydown', this.handleKeydown)
    this.content.spellcheck = false
  }

  unmount(): void {
    this.content.removeEventListener('beforeinput', this.handleBeforeInput)
    this.content.removeEventListener('compositionstart', this.handleCompositionStart)
    this.content.removeEventListener('compositionupdate', this.handleCompositionUpdate)
    this.content.removeEventListener('compositionend', this.handleCompositionEnd)
    this.content.removeEventListener('paste', this.handlePaste)
    this.content.removeEventListener('copy', this.handleCopy)
    this.content.removeEventListener('cut', this.handleCut)
    this.content.removeEventListener('keydown', this.handleKeydown)
  }

  // -------------------------------------------------------------------------
  // beforeinput
  // -------------------------------------------------------------------------

  private handleBeforeInput = (event: InputEvent): void => {
    if (this.composing) return
    if (event.inputType === 'insertCompositionText' && this.skipInsertComposition) {
      this.skipInsertComposition = false
      return
    }

    switch (event.inputType) {
      case 'insertText':
      case 'insertReplacementText':
        if (event.data) {
          event.preventDefault()
          this.insertText(event.data)
        }
        return
      case 'insertParagraph':
      case 'insertLineBreak':
        event.preventDefault()
        this.splitAtCaret()
        return
      case 'deleteContentBackward':
      case 'deleteSoftLineBackward':
      case 'deleteHardLineBackward':
      case 'deleteByCut':
        event.preventDefault()
        this.deleteByDirection('backward')
        return
      case 'deleteContentForward':
      case 'deleteSoftLineForward':
      case 'deleteWordForward':
        event.preventDefault()
        this.deleteByDirection('forward')
        return
      // 格式类（bold/italic/...）由 keydown + keymap 统一处理，避免双重切换
      case 'historyUndo':
        event.preventDefault()
        this.editor.undo()
        return
      case 'historyRedo':
        event.preventDefault()
        this.editor.redo()
        return
      default:
        // 其余输入类型（拖拽、粘贴等）交给专门事件或浏览器
        return
    }
  }

  // -------------------------------------------------------------------------
  // 组合输入（IME）
  // -------------------------------------------------------------------------

  private handleCompositionStart = (): void => {
    this.composing = true
    this.compositionPosition = this.renderer.getPosition()
  }

  private handleCompositionUpdate = (): void => {
    // 不干预，让浏览器显示组合文本
  }

  private handleCompositionEnd = (_event: CompositionEvent): void => {
    this.composing = false
    this.skipInsertComposition = true
    const pos = this.compositionPosition
    this.compositionPosition = undefined
    if (!pos) return

    const node = getNodeAt(this.editor.doc, pos.path)

    if (node && isText(node)) {
      // 光标在文本节点：用 DOM 文本替换（组合可能跨越多个文本节点，保守替换整个节点）
      const domText = this.renderer.getTextAt(pos.path)?.data
      if (domText === undefined || domText === node.text) return
      const step = new ReplaceTextStep(pos.path, 0, node.text.length, domText, node.text)
      this.applySteps([step], { path: pos.path, offset: domText.length }, true)
      return
    }

    // 光标在元素位置（如空段落）：把该块组合出来的文本插进模型，
    // 否则 DOM 有字、模型没字，下一次渲染就把字抹掉
    if (node && isElement(node)) {
      const domText = this.renderer.getBlockText(pos.path)
      if (!domText) return
      const step = new ReplaceChildrenStep(pos.path, pos.offset, pos.offset, [createText(domText)], [])
      this.applySteps([step], { path: [...pos.path, pos.offset], offset: domText.length }, true)
    }
  }

  // -------------------------------------------------------------------------
  // 剪贴板
  // -------------------------------------------------------------------------

  private handlePaste = (event: ClipboardEvent): void => {
    event.preventDefault()
    const text = event.clipboardData?.getData('text/plain')
    if (!text) return
    this.insertTextWithNewlines(text)
  }

  private handleCopy = (event: ClipboardEvent): void => {
    const text = this.getSelectedText()
    if (!text) return
    event.preventDefault()
    event.clipboardData?.setData('text/plain', text)
  }

  private handleCut = (event: ClipboardEvent): void => {
    const text = this.getSelectedText()
    if (!text) return
    event.preventDefault()
    event.clipboardData?.setData('text/plain', text)
    this.deleteByDirection('backward')
  }

  private handleKeydown = (event: KeyboardEvent): void => {
    // Tab 只在列表内拦截（缩进 / 取消缩进），其余场景保留浏览器默认行为
    if (event.key === 'Tab') {
      const ok = this.editor.commands.run(event.shiftKey ? 'list.outdent' : 'list.indent')
      if (ok) event.preventDefault()
      return
    }
    const command = this.editor.keymap.resolve(event)
    if (!command) return
    event.preventDefault()
    this.editor.commands.run(command)
  }

  // -------------------------------------------------------------------------
  // 操作
  // -------------------------------------------------------------------------

  private insertText(text: string): void {
    this.resetCodeBlockEnter()
    const range = this.renderer.getSelectionRange()
    let working = this.editor.doc
    const steps: Step[] = []
    let caret: Position

    if (range && !isCollapsed(range)) {
      const { from } = selectionRange(range)
      const deleteSteps = deleteRange(working, range.anchor, range.head)
      steps.push(...deleteSteps)
      working = applyAll(working, deleteSteps)
      caret = from
    } else {
      const pos = this.renderer.getPosition()
      if (!pos) return
      const node = getNodeAt(this.editor.doc, pos.path)
      if (node && isVoid(node)) return
      caret = pos
    }

    const marks = this.inputMarks(caret)
    const inserted = insertTextAt(working, caret, text, marks)
    steps.push(...inserted.steps)
    this.applySteps(steps, inserted.caret, true)
  }

  /**
   * 输入使用的 marks：优先"待输入格式"（光标处点格式按钮），
   * 否则继承插入点处文本的格式；修订模式再叠加 track_insert。
   */
  private inputMarks(pos: Position): Mark[] | undefined {
    const base = this.editor.getInputMarks(pos)
    this.editor.clearStoredMarks()
    if (!this.editor.trackChanges) return base
    const track: Mark = { type: 'track_insert', attrs: { author: '我', date: '' } }
    return base ? [...base, track] : [track]
  }

  private insertTextWithNewlines(text: string): void {
    const lines = text.split(/\r?\n/)
    let working = this.editor.doc
    const steps: Step[] = []
    let caret: Position | undefined = this.renderer.getPosition()
    if (!caret) return

    for (let i = 0; i < lines.length; i++) {
      const inserted = insertTextAt(working, caret, lines[i])
      steps.push(...inserted.steps)
      working = applyAll(working, inserted.steps)
      caret = inserted.caret
      if (i < lines.length - 1) {
        const split = splitBlock(working, caret)
        steps.push(...split.steps)
        working = applyAll(working, split.steps)
        caret = split.caret
      }
    }
    this.applySteps(steps, caret)
  }

  private deleteByDirection(direction: 'backward' | 'forward'): void {
    this.resetCodeBlockEnter()
    const range = this.renderer.getSelectionRange()

    if (range && !isCollapsed(range)) {
      const { from } = selectionRange(range)
      const steps = deleteRange(this.editor.doc, range.anchor, range.head)
      this.applySteps(steps, from, true)
      return
    }

    const pos = this.renderer.getPosition()
    if (!pos) return
    const posNode = getNodeAt(this.editor.doc, pos.path)
    if (posNode && isVoid(posNode)) return

    if (direction === 'backward') {
      const steps = deleteBackward(this.editor.doc, pos)
      const caret = steps.length > 0 ? this.caretAfterBackward(pos) : pos
      this.applySteps(steps, caret, true)
    } else {
      const steps = deleteForward(this.editor.doc, pos)
      this.applySteps(steps, pos, true)
    }
  }

  /** 退格后光标位置：文本内删除原地不动；块首合并落到合并点 */
  private caretAfterBackward(pos: Position): Position {
    const node = getNodeAt(this.editor.doc, pos.path)
    if (node && isText(node) && pos.offset > 0) return { path: pos.path, offset: pos.offset - 1 }
    const blockIndex = pos.path[0]
    if (blockIndex > 0) {
      return this.endOfBlockPosition(this.editor.doc, blockIndex - 1)
    }
    return pos
  }

  private endOfBlockPosition(doc: Document, blockIndex: number): Position {
    const block = doc.children[blockIndex]
    if (!block) return { path: [blockIndex], offset: 0 }
    const last = findLastTextPath(doc, blockIndex)
    if (!last) return { path: [blockIndex], offset: 0 }
    const node = getNodeAt(doc, last)
    return { path: last, offset: node && isText(node) ? node.text.length : 0 }
  }

  private splitAtCaret(): void {
    const range = this.renderer.getSelectionRange()
    if (!range) return

    const pos = this.renderer.getPosition()
    if (!pos) return

    // 列表项内（Word/Docs 行为）：新建同类型列表项；空项则退出列表
    if (isCollapsed(range) && pos.path.length >= 3) {
      const result = splitListItem(this.editor.doc, pos)
      if (result) {
        this.applySteps(result.steps, result.caret)
        return
      }
    }

    let working = this.editor.doc
    const steps: Step[] = []
    let caret: Position

    if (!isCollapsed(range)) {
      // 有选区：先删除选区内容，再在删除点拆分（符合常见编辑器行为）
      const { from } = selectionRange(range)
      const deleteSteps = deleteRange(working, range.anchor, range.head)
      steps.push(...deleteSteps)
      working = applyAll(working, deleteSteps)
      caret = from
    } else {
      caret = pos
    }

    // 代码块：只有"连续第二次回车"才退出；单次回车一定块内换行
    const inCodeBlock = this.inCodeBlock(caret)
    const allowCodeBlockExit =
      inCodeBlock &&
      this.codeBlockEnterPos !== undefined &&
      comparePosition(caret, this.codeBlockEnterPos) === 0 &&
      Date.now() - this.codeBlockEnterAt < 1000

    const split = splitBlock(working, caret, allowCodeBlockExit)
    steps.push(...split.steps)
    this.applySteps(steps, split.caret)

    if (inCodeBlock && !allowCodeBlockExit) {
      this.codeBlockEnterAt = Date.now()
      this.codeBlockEnterPos = { path: [...split.caret.path], offset: split.caret.offset }
    } else {
      this.resetCodeBlockEnter()
    }
  }

  /** 光标是否位于 code_block 内（任意嵌套层级） */
  private inCodeBlock(pos: Position): boolean {
    let path: Path = pos.path
    while (path.length > 0) {
      const node = getNodeAt(this.editor.doc, path)
      if (node && isElement(node) && node.type === 'code_block') return true
      path = path.slice(0, -1)
    }
    return false
  }

  private resetCodeBlockEnter(): void {
    this.codeBlockEnterAt = 0
    this.codeBlockEnterPos = undefined
  }

  private getSelectedText(): string | undefined {
    const range = this.renderer.getSelectionRange()
    if (!range || isCollapsed(range)) return undefined
    return getTextInRange(this.editor.doc, range)
  }

  private applySteps(steps: Step[], caret?: Position, coalescible = false): void {
    if (steps.length === 0) return
    const tr = this.editor.transaction()
    tr.coalescible = coalescible
    for (const step of steps) tr.addStep(step)
    this.editor.dispatch(tr)
    if (caret) this.renderer.setCaret(caret)
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function applyAll(doc: Document, steps: Step[]): Document {
  let result = doc
  for (const step of steps) result = step.apply(result)
  return result
}

/** 找到块内最后一个文本节点的路径（用于合并后定位光标） */
function findLastTextPath(doc: Document, blockIndex: number): Path | undefined {
  let current: Path = [blockIndex]
  let node = getNodeAt(doc, current)
  while (node && !isText(node)) {
    if (!('children' in node) || node.children.length === 0) return undefined
    const lastIndex = node.children.length - 1
    current = [...current, lastIndex]
    node = node.children[lastIndex]
  }
  return node ? current : undefined
}

function getTextInRange(doc: Document, range: TextSelection): string {
  const { from, to } = selectionRange(range)
  const parts: string[] = []
  traverse(doc, (entry) => {
    if (!isText(entry.node)) return undefined
    const isFrom = isSamePath(entry.path, from.path)
    const isTo = isSamePath(entry.path, to.path)
    const start = isFrom ? from.offset : 0
    const end = isTo ? to.offset : entry.node.text.length
    if (start < end) parts.push(entry.node.text.slice(start, end))
    return undefined
  })
  return parts.join('')
}
