/**
 * Editor：组装层（文档 + 选区 + 历史 + 插件）
 *
 * M1：文档 + 选区 + 历史 + 基础操作
 * M2：mount / unmount / focus / blur / onChange
 * M3：插件系统（schema / 命令 / 快捷键）
 */

import type { Attrs, Document, Mark, Node } from '@/model/node'
import { comparePosition, type Path, type Position } from '@/model/path'
import type { TextSelection } from '@/engine/selection'
import { createState, type EditorState } from '@/engine/state'
import { Transaction } from '@/engine/transaction'
import { History, type HistoryEntry } from '@/engine/history'
import { CommandRegistry, KeymapTable } from '@/engine/registry'
import type { Step } from '@/engine/step'
import * as commands from '@/engine/commands'
import { buildSchema, type Schema } from '@/model/schema'
import { normalize } from '@/model/normalize'
import type { Plugin } from '@/plugins/plugin'
import { builtinPlugins } from '@/plugins/builtin/index'
import { EditorView } from '@/render/view'
import type { ViewMode } from '@/render/renderer'

export interface EditorOptions {
  /** 插件集（默认内置插件） */
  plugins?: Plugin[]
  selection?: TextSelection
}

export class Editor {
  private _state: EditorState
  private _view?: EditorView
  readonly history = new History()
  readonly schema: Schema
  readonly commands: CommandRegistry
  readonly keymap: KeymapTable

  /** 引擎状态变化回调（dispatch / undo / redo 后触发） */
  onChange?: (state: EditorState) => void

  /** 内部状态变化通知（视图渲染用，不对外） */
  onStateChange?: (state: EditorState) => void

  /** 修订模式（M7）：开启后新输入标记为 track_insert */
  trackChanges = false

  /**
   * 折叠光标处的"待输入格式"（点击加粗 / 斜体等按钮时设置）。
   * 与 Word/WPS 一致：光标处点格式按钮不会改已有文字，而是让接下来输入的文字带上格式。
   */
  storedMarks: Mark[] | undefined
  private storedMarksPos: Position | undefined

  constructor(doc: Document, options: EditorOptions = {}) {
    const plugins = options.plugins ?? builtinPlugins()
    this.schema = buildSchema(plugins)
    this.commands = new CommandRegistry(this)
    this.keymap = new KeymapTable()
    for (const plugin of plugins) {
      for (const [name, command] of Object.entries(plugin.commands ?? {})) {
        this.commands.register(name, command)
      }
      this.keymap.register(plugin.keymap ?? {})
    }
    this._state = createState(doc, options.selection)
  }

  get state(): EditorState {
    return this._state
  }

  get doc(): Document {
    return this._state.doc
  }

  get selection(): TextSelection {
    return this._state.selection
  }

  /** 当前选区（优先 DOM 选区，未挂载时用模型选区） */
  getSelection(): TextSelection {
    return this._view?.renderer.getSelectionRange() ?? this._state.selection
  }

  /**
   * 同步选区（不写入历史、不触发渲染）。
   * 供视图层在 DOM 选区变化时回写模型，保证 editor.selection 与实际选区一致。
   */
  setSelection(selection: TextSelection): void {
    this.refreshStoredMarks(selection)
    this._state = { ...this._state, selection }
  }

  /**
   * 记录折叠光标处的待输入格式。
   * 光标位置变化（点击别处、移动光标）后自动失效；输入一次后由输入层清除。
   */
  setStoredMarks(marks: Mark[] | undefined, pos: Position): void {
    this.storedMarks = marks
    this.storedMarksPos =
      marks === undefined ? undefined : { path: [...pos.path], offset: pos.offset }
  }

  /** 清除待输入格式（输入一次之后，格式已由新文本自身携带） */
  clearStoredMarks(): void {
    this.storedMarks = undefined
    this.storedMarksPos = undefined
  }

  /**
   * 当前输入使用的格式：优先待输入格式；否则取插入点处文本自身的格式（格式续接）。
   */
  getInputMarks(pos?: Position): Mark[] | undefined {
    if (this.storedMarks) return this.storedMarks
    const at = pos ?? this.getCaret()
    if (!at) return undefined
    return commands.getMarksAtPosition(this.doc, at)
  }

  private refreshStoredMarks(selection: TextSelection): void {
    if (!this.storedMarks) return
    // 出现非折叠选区（选中了文字）时，待输入格式失效
    if (comparePosition(selection.anchor, selection.head) !== 0) {
      this.clearStoredMarks()
      return
    }
    if (this.storedMarksPos && comparePosition(selection.anchor, this.storedMarksPos) === 0) return
    this.clearStoredMarks()
  }

  /** 当前光标（优先 DOM 光标） */
  getCaret(): Position | undefined {
    return this._view?.renderer.getPosition() ?? this._state.selection.anchor
  }

  /** 已挂载的视图（未挂载时为 undefined） */
  get view(): EditorView | undefined {
    return this._view
  }

  /** 整体替换文档（清空历史，触发重渲染） */
  setDoc(doc: Document): void {
    const selection: TextSelection = {
      type: 'text',
      anchor: { path: [0, 0], offset: 0 },
      head: { path: [0, 0], offset: 0 },
    }
    this._state = { doc: normalize(doc), selection }
    this.history.clear()
    this.emitChange()
  }

  /** 挂载到容器（M2 渲染 + 输入） */
  mount(container: HTMLElement): EditorView {
    if (this._view) throw new Error('编辑器已挂载')
    this._view = new EditorView(this, container)
    return this._view
  }

  unmount(): void {
    this._view?.destroy()
    this._view = undefined
  }

  focus(): void {
    this._view?.focus()
  }

  blur(): void {
    this._view?.blur()
  }

  /** 切换视图模式（M5：flow / page） */
  setViewMode(mode: ViewMode): void {
    this._view?.setViewMode(mode)
  }

  /** 开始一个事务（可组合多个步骤） */
  transaction(): Transaction {
    return new Transaction(this._state)
  }

  /** 提交事务（自动写入历史） */
  dispatch(tr: Transaction): void {
    const next = tr.apply()
    const entry: HistoryEntry = {
      steps: [...tr.steps],
      inverted: tr.invert(),
      selectionBefore: tr.startState.selection,
      selectionAfter: next.selection,
      time: Date.now(),
      coalescible: tr.coalescible,
    }
    this.history.push(entry)
    this._state = next
    this.emitChange()
  }

  private emitChange(): void {
    this.onStateChange?.(this._state)
    this.onChange?.(this._state)
  }

  private run(step: Step, coalescible = false): void {
    const tr = this.transaction()
    tr.coalescible = coalescible
    tr.addStep(step)
    this.dispatch(tr)
  }

  insertText(path: Path, offset: number, text: string, coalescible = true): void {
    this.run(commands.insertText(path, offset, text), coalescible)
  }

  /** 删除默认独立成组（不与前面的输入合并），连续删除可在调用处显式传 coalescible */
  deleteText(path: Path, from: number, to: number, coalescible = false): void {
    this.run(commands.deleteText(this.doc, path, from, to), coalescible)
  }

  insertNodes(parentPath: Path, index: number, nodes: Node[]): void {
    this.run(commands.insertNodes(parentPath, index, nodes))
  }

  removeNodes(parentPath: Path, index: number, count: number): void {
    this.run(commands.removeNodes(this.doc, parentPath, index, count))
  }

  setNodeAttrs(path: Path, patch: Attrs): void {
    this.run(commands.setNodeAttrs(this.doc, path, patch))
  }

  setMarks(path: Path, marks: Mark[]): void {
    this.run(commands.setMarks(this.doc, path, marks))
  }

  undo(): boolean {
    const next = this.history.undo(this._state)
    if (!next) return false
    this._state = next
    this.emitChange()
    return true
  }

  redo(): boolean {
    const next = this.history.redo(this._state)
    if (!next) return false
    this._state = next
    this.emitChange()
    return true
  }
}
