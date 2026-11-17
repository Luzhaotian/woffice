/**
 * WofficeApp：库自带的 UI 外壳（顶栏 + 工具栏 + 画布 + 状态栏）
 *
 * 使用方只需传入容器与配置，外壳负责：
 * - 渲染内置插件的全部命令（工具栏 / 快捷键 / 块类型下拉）
 * - 页面视图 ⇄ 流式视图切换、页码、字数统计
 * - docx 导入 / 导出
 * - 选区状态联动（工具栏 active 状态）
 *
 * 底层仍可通过 `app.editor` 访问完整 Editor API；外壳只是 Editor 的一层薄封装。
 */

import type { Document } from '@/model/node'
import type { Position } from '@/model/path'
import {
  WOFFICE_VERSION,
  Editor,
  compare,
  comparePosition,
  createDocument,
  createElement,
  createSelection,
  exportDocx,
  getNodeAt,
  getTextContent,
  importDocx,
  isSamePath,
  isText,
  isVoid,
  normalize,
  selectionRange,
  traverse,
} from '@/index'
import type { Plugin } from '@/plugins/plugin'
import type { ViewMode } from '@/render/renderer'
import { ICONS, iconSvg } from './icons'
import appCss from './editor-app.css?inline'

export interface WofficeAppOptions {
  /** 挂载容器（外壳会占满该容器） */
  container: HTMLElement
  /** 初始文档（默认：一个空段落） */
  content?: Document
  /** 文档标题（顶栏显示，并作为导出文件名） */
  title?: string
  /** 插件集（默认内置插件） */
  plugins?: Plugin[]
  /** 初始视图模式（默认 'page'） */
  viewMode?: ViewMode
  /** 顶栏（默认显示；传 false 隐藏） */
  header?: boolean
  /** 工具栏：true 用默认项 / false 隐藏 / 数组自定义（默认 true） */
  toolbar?: boolean | ToolbarItem[]
  /** 状态栏（默认显示；传 false 隐藏） */
  statusbar?: boolean
  /** 文档变化回调 */
  onChange?: (doc: Document) => void
}

/** 工具栏可配置项 */
export type ToolbarItem =
  | 'undo'
  | 'redo'
  | 'blockType'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'highlight'
  | 'code'
  | 'link'
  | 'bulletList'
  | 'orderedList'
  | 'blockquote'
  | 'codeBlock'
  | 'hr'
  | 'comment'
  | 'trackChanges'
  | 'separator'

export const DEFAULT_TOOLBAR: ToolbarItem[] = [
  'undo',
  'redo',
  'separator',
  'blockType',
  'separator',
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'highlight',
  'code',
  'link',
  'separator',
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
  'separator',
  'hr',
  'comment',
  'trackChanges',
]

const BLOCK_ITEMS: { key: string; label: string; command: string }[] = [
  { key: 'paragraph', label: '正文', command: 'block.paragraph' },
  { key: 'heading1', label: '标题 1', command: 'heading.h1' },
  { key: 'heading2', label: '标题 2', command: 'heading.h2' },
  { key: 'heading3', label: '标题 3', command: 'heading.h3' },
  { key: 'blockquote', label: '引用', command: 'block.quote' },
  { key: 'code_block', label: '代码块', command: 'block.code' },
]

const BLOCK_LABELS: Record<string, string> = {
  paragraph: '正文',
  heading1: '标题 1',
  heading2: '标题 2',
  heading3: '标题 3',
  blockquote: '引用',
  code_block: '代码块',
  bullet_list: '无序列表',
  ordered_list: '有序列表',
}

const MARK_TYPES = [
  { type: 'bold', icon: ICONS.bold, title: '加粗 (Mod-B)', command: 'mark.bold' },
  { type: 'italic', icon: ICONS.italic, title: '斜体 (Mod-I)', command: 'mark.italic' },
  { type: 'underline', icon: ICONS.underline, title: '下划线 (Mod-U)', command: 'mark.underline' },
  {
    type: 'strikethrough',
    icon: ICONS.strikethrough,
    title: '删除线',
    command: 'mark.strikethrough',
  },
  { type: 'highlight', icon: ICONS.highlight, title: '高亮', command: 'mark.highlight' },
  { type: 'code_inline', icon: ICONS.code, title: '行内代码', command: 'mark.code' },
  { type: 'link', icon: ICONS.link, title: '链接', command: 'mark.link' },
]

const BLOCK_TOGGLES = [
  {
    type: 'bullet_list',
    icon: ICONS.list,
    title: '无序列表 (Mod-Shift-7)',
    command: 'list.bullet',
  },
  {
    type: 'ordered_list',
    icon: ICONS.listOrdered,
    title: '有序列表 (Mod-Shift-8)',
    command: 'list.ordered',
  },
  { type: 'blockquote', icon: ICONS.quote, title: '引用', command: 'block.quote' },
  { type: 'code_block', icon: ICONS.squareCode, title: '代码块', command: 'block.code' },
]

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

/** 外壳样式只注入一次（CSS 已内联，使用方无需额外引入样式文件） */
let stylesInjected = false
function ensureStyles(): void {
  if (stylesInjected) return
  stylesInjected = true
  const style = document.createElement('style')
  style.setAttribute('data-woffice-app', '')
  style.textContent = appCss
  document.head.appendChild(style)
}

export class WofficeApp {
  /** 底层编辑器（可命令式操作） */
  readonly editor: Editor

  private readonly options: WofficeAppOptions
  private readonly root: HTMLElement
  private readonly canvasEl: HTMLElement
  private readonly uploadInput: HTMLInputElement
  private currentViewMode: ViewMode

  private toolbarEl: HTMLElement | undefined
  private titleInput: HTMLInputElement | undefined
  private exportBtn: HTMLButtonElement | undefined
  private statusPage: HTMLElement | undefined
  private statusWords: HTMLElement | undefined
  private statusBlock: HTMLElement | undefined
  private blockTypeLabel: HTMLElement | undefined
  private toastEl: HTMLElement | undefined
  private toastTimer: number | undefined

  private readonly markEls = new Map<string, HTMLButtonElement>()
  private readonly blockToggleEls = new Map<string, HTMLButtonElement>()
  private readonly blockItemEls = new Map<string, HTMLButtonElement>()
  private undoBtn: HTMLButtonElement | undefined
  private redoBtn: HTMLButtonElement | undefined
  private trackBtn: HTMLButtonElement | undefined

  constructor(options: WofficeAppOptions) {
    this.options = options
    this.currentViewMode = options.viewMode ?? 'page'
    ensureStyles()

    // 规范化初始文档：去掉空文本节点，否则空段落不会生成占位 <br>（高度为 0）
    const content = normalize(options.content ?? createDocument([createElement('paragraph')]))
    this.editor = new Editor(content, {
      plugins: options.plugins,
      selection: createSelection({ path: [0, 0], offset: 0 }),
    })

    this.root = el('div', 'woffice-app')
    options.container.appendChild(this.root)

    if (options.header !== false) this.buildHeader()
    if (options.toolbar !== false) {
      const items = Array.isArray(options.toolbar) ? options.toolbar : DEFAULT_TOOLBAR
      this.toolbarEl = this.buildToolbar(items)
      this.root.appendChild(this.toolbarEl)
    }

    this.canvasEl = el('main', 'woffice-app-canvas')
    this.root.appendChild(this.canvasEl)

    if (options.statusbar !== false) {
      const statusbar = this.buildStatusbar()
      this.root.appendChild(statusbar)
    }

    this.editor.mount(this.canvasEl)
    this.editor.setViewMode(this.currentViewMode)

    this.uploadInput = el('input')
    this.uploadInput.type = 'file'
    this.uploadInput.accept = '.docx'
    this.uploadInput.hidden = true
    document.body.appendChild(this.uploadInput)

    this.bind()
    this.editor.onChange = () => {
      this.updateToolbar()
      this.updateStatus()
      this.options.onChange?.(this.editor.doc)
    }
    document.addEventListener('selectionchange', this.handleSelectionChange)

    this.updateToolbar()
    this.updateStatus()
    this.updateExportState()
    this.editor.focus()
    this.editor.view?.renderer.setCaret({ path: [0, 0], offset: 0 })
    // 初始光标在文档开头，画布回到顶部
    this.canvasEl.scrollTop = 0
  }

  destroy(): void {
    document.removeEventListener('selectionchange', this.handleSelectionChange)
    window.removeEventListener('resize', this.closeDropdown)
    this.canvasEl.removeEventListener('scroll', this.closeDropdown)
    this.uploadInput.remove()
    this.toastEl?.remove()
    this.editor.unmount()
    this.root.remove()
  }

  // -------------------------------------------------------------------------
  // DOM 构建
  // -------------------------------------------------------------------------

  private buildHeader(): void {
    const header = el('header', 'woffice-app-header')

    const brand = el('div', 'woffice-app-brand')
    const logo = el('div', 'woffice-app-logo')
    logo.textContent = 'W'
    const meta = el('div', 'woffice-app-brand-meta')
    const title = el('h1')
    title.textContent = 'woffice'
    const sub = el('span', 'woffice-app-brand-sub')
    sub.textContent = 'Word 文档编辑器'
    meta.appendChild(title)
    meta.appendChild(sub)
    const version = el('span', 'woffice-app-version')
    version.textContent = `v${WOFFICE_VERSION}`
    brand.appendChild(logo)
    brand.appendChild(meta)
    brand.appendChild(version)

    const titleWrap = el('div', 'woffice-app-title-wrap')
    const titleInput = el('input', 'woffice-app-title')
    titleInput.type = 'text'
    titleInput.placeholder = '未命名文档'
    titleInput.setAttribute('aria-label', '文档标题')
    titleInput.value = this.options.title ?? ''
    titleInput.addEventListener('input', () => this.updateExportState())
    titleWrap.appendChild(titleInput)
    this.titleInput = titleInput

    const actions = el('div', 'woffice-app-actions')
    const importBtn = el('button', 'woffice-app-btn')
    importBtn.type = 'button'
    importBtn.textContent = '导入 .docx'
    importBtn.addEventListener('click', () => this.uploadInput.click())
    const exportBtn = el('button', 'woffice-app-btn woffice-app-btn-primary')
    exportBtn.type = 'button'
    exportBtn.textContent = '导出 .docx'
    exportBtn.addEventListener('click', () => void this.handleExport())
    this.exportBtn = exportBtn
    actions.appendChild(importBtn)
    actions.appendChild(exportBtn)

    header.appendChild(brand)
    header.appendChild(titleWrap)
    header.appendChild(actions)
    this.root.appendChild(header)
  }

  private buildToolbar(items: ToolbarItem[]): HTMLElement {
    const bar = el('div', 'woffice-app-toolbar')
    bar.setAttribute('role', 'toolbar')
    bar.setAttribute('aria-label', '格式工具栏')

    let group: HTMLElement[] = []
    const flush = (): void => {
      if (group.length === 0) return
      const groupEl = el('div', 'woffice-app-tb-group')
      for (const child of group) groupEl.appendChild(child)
      bar.appendChild(groupEl)
      group = []
    }

    for (const item of items) {
      if (item === 'separator') {
        flush()
        const sep = el('div', 'woffice-app-tb-sep')
        bar.appendChild(sep)
        continue
      }
      group.push(this.buildToolbarButton(item))
    }
    flush()
    return bar
  }

  private makeButton(icon: string, title: string, onClick: () => void): HTMLButtonElement {
    const btn = el('button', 'woffice-app-tb-btn')
    btn.type = 'button'
    btn.innerHTML = iconSvg(icon)
    btn.title = title
    btn.setAttribute('aria-label', title)
    // 阻止 mousedown 默认行为：点击工具栏时保持编辑器选区
    btn.addEventListener('mousedown', (event) => event.preventDefault())
    btn.addEventListener('click', onClick)
    return btn
  }

  private buildToolbarButton(item: Exclude<ToolbarItem, 'separator'>): HTMLElement {
    switch (item) {
      case 'undo':
        this.undoBtn = this.makeButton(ICONS.undo, '撤销 (Mod-Z)', () => this.run('history.undo'))
        return this.undoBtn
      case 'redo':
        this.redoBtn = this.makeButton(ICONS.redo, '重做 (Mod-Y)', () => this.run('history.redo'))
        return this.redoBtn
      case 'blockType':
        return this.buildBlockTypeDropdown()
      case 'bold':
      case 'italic':
      case 'underline':
      case 'strikethrough':
      case 'highlight':
      case 'code':
      case 'link': {
        const mark = MARK_TYPES.find((m) => m.type === this.markTypeOf(item))!
        const btn = this.makeButton(mark.icon, mark.title, () => this.run(mark.command))
        this.markEls.set(mark.type, btn)
        return btn
      }
      case 'bulletList':
      case 'orderedList':
      case 'blockquote':
      case 'codeBlock': {
        const toggle = BLOCK_TOGGLES.find((t) => t.type === this.blockTypeOf(item))!
        const btn = this.makeButton(toggle.icon, toggle.title, () => this.run(toggle.command))
        this.blockToggleEls.set(toggle.type, btn)
        return btn
      }
      case 'hr':
        return this.makeButton(ICONS.minus, '分割线', () => this.run('block.hr'))
      case 'comment':
        return this.makeButton(ICONS.comment, '批注', () => this.run('mark.comment'))
      case 'trackChanges':
        this.trackBtn = this.makeButton(ICONS.pencil, '修订模式（新输入会带修订标记）', () => {
          this.editor.trackChanges = !this.editor.trackChanges
          this.updateToolbar()
        })
        return this.trackBtn
      default: {
        const exhaustive: never = item
        throw new Error(`未知工具栏项: ${String(exhaustive)}`)
      }
    }
  }

  private markTypeOf(item: ToolbarItem): string {
    switch (item) {
      case 'bold':
        return 'bold'
      case 'italic':
        return 'italic'
      case 'underline':
        return 'underline'
      case 'strikethrough':
        return 'strikethrough'
      case 'highlight':
        return 'highlight'
      case 'code':
        return 'code_inline'
      case 'link':
        return 'link'
      default:
        return item
    }
  }

  private blockTypeOf(item: ToolbarItem): string {
    switch (item) {
      case 'bulletList':
        return 'bullet_list'
      case 'orderedList':
        return 'ordered_list'
      case 'blockquote':
        return 'blockquote'
      case 'codeBlock':
        return 'code_block'
      default:
        return item
    }
  }

  private buildBlockTypeDropdown(): HTMLElement {
    const wrap = el('div', 'woffice-app-tb-dropdown')

    const trigger = el('button', 'woffice-app-tb-btn woffice-app-tb-trigger')
    trigger.type = 'button'
    trigger.setAttribute('aria-haspopup', 'listbox')
    trigger.setAttribute('aria-expanded', 'false')
    trigger.addEventListener('mousedown', (event) => event.preventDefault())
    trigger.addEventListener('click', (event) => {
      event.stopPropagation()
      const willOpen = menu.hidden
      this.closeDropdown()
      if (willOpen) this.openDropdown()
    })

    this.blockTypeLabel = el('span', 'woffice-app-tb-trigger-label')
    this.blockTypeLabel.textContent = '正文'
    trigger.appendChild(this.blockTypeLabel)
    trigger.insertAdjacentHTML('beforeend', iconSvg(ICONS.chevron))

    const menu = el('div', 'woffice-app-tb-menu')
    menu.hidden = true
    menu.setAttribute('role', 'listbox')

    for (const item of BLOCK_ITEMS) {
      const itemBtn = el('button', 'woffice-app-tb-menu-item')
      itemBtn.type = 'button'
      itemBtn.textContent = item.label
      itemBtn.dataset.key = item.key
      itemBtn.addEventListener('mousedown', (event) => event.preventDefault())
      itemBtn.addEventListener('click', () => {
        this.run(item.command)
        this.closeDropdown()
      })
      this.blockItemEls.set(item.key, itemBtn)
      menu.appendChild(itemBtn)
    }

    wrap.appendChild(trigger)
    wrap.appendChild(menu)
    return wrap
  }

  private buildStatusbar(): HTMLElement {
    const bar = el('footer', 'woffice-app-statusbar')

    this.statusPage = el('span', 'woffice-app-status-item')
    this.statusWords = el('span', 'woffice-app-status-item')
    this.statusBlock = el('span', 'woffice-app-status-item')
    bar.appendChild(this.statusPage)
    bar.appendChild(this.statusWords)
    bar.appendChild(this.statusBlock)

    const spacer = el('span', 'woffice-app-status-spacer')
    bar.appendChild(spacer)

    const switchEl = el('div', 'woffice-app-view-switch')
    switchEl.setAttribute('role', 'tablist')
    for (const mode of ['page', 'flow'] as const) {
      const btn = el('button', 'woffice-app-view-btn')
      btn.type = 'button'
      btn.dataset.view = mode
      btn.textContent = mode === 'page' ? '页面视图' : '流式视图'
      btn.setAttribute('role', 'tab')
      btn.addEventListener('click', () => this.setViewMode(mode))
      switchEl.appendChild(btn)
    }
    bar.appendChild(switchEl)
    return bar
  }

  // -------------------------------------------------------------------------
  // 行为
  // -------------------------------------------------------------------------

  private bind(): void {
    this.uploadInput.addEventListener('change', () => void this.handleImport())

    document.addEventListener('mousedown', (event) => {
      const target = event.target as Node | null
      if (!target || !this.toolbarEl) return
      const dropdown = this.toolbarEl.querySelector<HTMLElement>('.woffice-app-tb-dropdown')
      if (dropdown && !dropdown.contains(target as HTMLElement)) this.closeDropdown()
    })
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeDropdown()
    })
    window.addEventListener('resize', this.closeDropdown)
    this.canvasEl.addEventListener('scroll', this.closeDropdown)
  }

  private handleSelectionChange = (): void => {
    this.updateToolbar()
    this.updateStatus()
  }

  /** 执行命令并保留选区 */
  private run(name: string, ...args: unknown[]): void {
    const changed = this.editor.commands.run(name, ...args)
    if (changed) {
      // 命令可能拆分/重排节点（如加粗按选区拆分文本、列表包装），
      // 用事务映射后的模型选区恢复 DOM 选区
      const { anchor, head } = this.editor.state.selection
      this.editor.view?.renderer.setSelection(this.intoText(anchor), this.intoText(head))
    }
    this.updateToolbar()
    this.updateStatus()
  }

  /**
   * 把落在非文本节点上的位置下钻到文本节点。
   * 块被包装/解包（列表、引用）后，选区常落在容器节点上，
   * 不处理的话光标会"悬空"（看不见、后续输入失效）。
   */
  private intoText(pos: Position): Position {
    let path = pos.path
    let offset = pos.offset
    let node = getNodeAt(this.editor.doc, path)
    while (node && !isText(node)) {
      if (isVoid(node) || node.children.length === 0) return { path, offset }
      if (node.children.length === 1) {
        // 单链下钻，保留偏移
        path = [...path, 0]
        node = node.children[0]
        continue
      }
      const index = Math.min(Math.max(offset, 0), node.children.length - 1)
      path = [...path, index]
      offset = 0
      node = node.children[index]
    }
    return { path, offset }
  }

  setViewMode(mode: ViewMode): void {
    this.currentViewMode = mode
    this.editor.setViewMode(mode)
    this.root.querySelectorAll<HTMLButtonElement>('.woffice-app-view-btn').forEach((btn) => {
      const active = btn.dataset.view === mode
      btn.classList.toggle('active', active)
      btn.setAttribute('aria-selected', String(active))
    })
    this.updateStatus()
  }

  private openDropdown(): void {
    if (!this.toolbarEl) return
    const menu = this.toolbarEl.querySelector<HTMLElement>('.woffice-app-tb-menu')
    const trigger = this.toolbarEl.querySelector<HTMLButtonElement>('.woffice-app-tb-trigger')
    if (!menu || !trigger) return
    const rect = trigger.getBoundingClientRect()
    menu.style.top = `${rect.bottom + 6}px`
    menu.style.left = `${rect.left}px`
    menu.hidden = false
    trigger.setAttribute('aria-expanded', 'true')
  }

  private closeDropdown = (): void => {
    if (!this.toolbarEl) return
    const menu = this.toolbarEl.querySelector<HTMLElement>('.woffice-app-tb-menu')
    const trigger = this.toolbarEl.querySelector<HTMLButtonElement>('.woffice-app-tb-trigger')
    if (menu) menu.hidden = true
    if (trigger) trigger.setAttribute('aria-expanded', 'false')
  }

  private currentBlockType(): string {
    const pos = this.editor.getCaret()
    if (!pos) return 'paragraph'
    const block = this.editor.doc.children[pos.path[0]]
    if (!block) return 'paragraph'
    if (block.type === 'heading') return `heading${block.attrs?.level ?? 1}`
    return block.type
  }

  private activeMarks(): Set<string> {
    const result = new Set<string>()
    const range = this.editor.getSelection()
    if (!range) return result
    const { from, to } = selectionRange(range)
    const collapsed = comparePosition(from, to) === 0
    // 折叠光标处点击格式按钮：按钮应立刻显示为激活（对应"待输入格式"）
    if (collapsed && this.editor.storedMarks) {
      for (const mark of this.editor.storedMarks) result.add(mark.type)
      return result
    }
    const nodes: import('@/model/node').TextNode[] = []

    traverse(this.editor.doc, (entry) => {
      if (!isText(entry.node)) return undefined
      if (collapsed) {
        if (isSamePath(entry.path, from.path)) nodes.push(entry.node)
        return undefined
      }
      const isFrom = isSamePath(entry.path, from.path)
      const isTo = isSamePath(entry.path, to.path)
      if (!isFrom && !isTo) {
        if (compare(entry.path, from.path) >= 0 && compare(entry.path, to.path) <= 0) {
          nodes.push(entry.node)
        }
        return undefined
      }
      // 边界节点：只有真正被选中的那部分才算
      // （选区起点落在节点末尾时，该节点其实没被选中）
      const start = isFrom ? from.offset : 0
      const end = isTo ? to.offset : entry.node.text.length
      if (end > start) nodes.push(entry.node)
      return undefined
    })
    if (nodes.length === 0) return result

    for (const mark of MARK_TYPES) {
      if (nodes.every((node) => (node.marks ?? []).some((m) => m.type === mark.type))) {
        result.add(mark.type)
      }
    }
    return result
  }

  /** 未命名（标题为空）时不允许导出 */
  private updateExportState(): void {
    if (this.exportBtn) {
      this.exportBtn.disabled = (this.titleInput?.value.trim() ?? '') === ''
    }
  }

  private updateToolbar(): void {
    const blockType = this.currentBlockType()
    const label = BLOCK_LABELS[blockType] ?? '正文'
    if (this.blockTypeLabel) this.blockTypeLabel.textContent = label
    if (this.statusBlock) this.statusBlock.textContent = label

    for (const item of BLOCK_ITEMS) {
      this.blockItemEls.get(item.key)?.classList.toggle('active', item.key === blockType)
    }

    const marks = this.activeMarks()
    for (const mark of MARK_TYPES) {
      this.markEls.get(mark.type)?.classList.toggle('active', marks.has(mark.type))
    }
    for (const item of BLOCK_TOGGLES) {
      this.blockToggleEls.get(item.type)?.classList.toggle('active', blockType === item.type)
    }

    if (this.undoBtn) this.undoBtn.disabled = !this.editor.history.canUndo
    if (this.redoBtn) this.redoBtn.disabled = !this.editor.history.canRedo
    if (this.trackBtn) this.trackBtn.classList.toggle('active', this.editor.trackChanges)
  }

  private updateStatus(): void {
    const pages = this.root.querySelectorAll('.woffice-page').length
    const words = getTextContent(this.editor.doc).replace(/\s+/g, '').length
    if (this.statusWords) this.statusWords.textContent = `${words} 字`

    if (this.currentViewMode === 'flow') {
      if (this.statusPage) this.statusPage.textContent = '流式布局'
      return
    }

    const selection = window.getSelection()
    const anchor = selection?.anchorNode
    const el =
      anchor && anchor.nodeType === Node.ELEMENT_NODE
        ? (anchor as HTMLElement)
        : anchor?.parentElement
    const page = el?.closest('.woffice-page')
    const current = page
      ? Array.from(this.root.querySelectorAll('.woffice-page')).indexOf(page) + 1
      : 1
    if (this.statusPage) this.statusPage.textContent = `第 ${current} 页 / 共 ${pages} 页`
  }

  private toast(message: string): void {
    if (!this.toastEl) {
      this.toastEl = el('div', 'woffice-app-toast')
      document.body.appendChild(this.toastEl)
    }
    this.toastEl.textContent = message
    this.toastEl.classList.add('show')
    window.clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => this.toastEl?.classList.remove('show'), 1800)
  }

  private async handleImport(): Promise<void> {
    const file = this.uploadInput.files?.[0]
    this.uploadInput.value = ''
    if (!file) return
    this.toast('解析中…')
    try {
      const doc = await importDocx(file)
      this.editor.setDoc(doc)
      this.editor.focus()
      if (this.titleInput) this.titleInput.value = file.name.replace(/\.docx$/i, '')
      this.updateExportState()
      this.canvasEl.scrollTop = 0
      this.toast(`已导入：${file.name}`)
    } catch (error) {
      this.toast(`导入失败：${(error as Error).message}`)
    }
  }

  private async handleExport(): Promise<void> {
    this.toast('正在生成 .docx…')
    try {
      const blob = await exportDocx(this.editor.doc)
      const url = URL.createObjectURL(blob)
      const a = el('a')
      a.href = url
      a.download = `${this.titleInput?.value || '未命名文档'}.docx`
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      this.toast('已导出 .docx')
    } catch (error) {
      this.toast(`导出失败：${(error as Error).message}`)
    }
  }
}
