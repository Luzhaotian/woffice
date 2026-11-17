/**
 * EditorView：把 Editor + Renderer + ContenteditableBackend 组装成可挂载的视图
 *
 * 挂载后容器内出现一个 contenteditable 区域；任何引擎状态变化都会触发重渲染。
 */

import type { Editor } from '@/editor'
import type { Schema } from '@/model/schema'
import { Renderer, type ViewMode } from '@/render/renderer'
import { ContenteditableBackend } from '@/input/backend'

export class EditorView {
  readonly element: HTMLElement
  private readonly content: HTMLElement
  private readonly rendererRef: Renderer
  private readonly backend: ContenteditableBackend

  constructor(
    private readonly editor: Editor,
    container: HTMLElement,
    schema?: Schema,
  ) {
    this.element = document.createElement('div')
    this.element.className = 'woffice-editor'

    this.content = document.createElement('div')
    this.content.className = 'woffice-editor-content'
    this.content.contentEditable = 'true'
    this.content.setAttribute('role', 'textbox')
    this.content.setAttribute('aria-multiline', 'true')
    this.content.setAttribute('aria-label', '文档编辑器')
    this.element.appendChild(this.content)
    container.appendChild(this.element)

    this.rendererRef = new Renderer(this.content, schema ?? editor.schema)
    this.backend = new ContenteditableBackend(this.editor, this.content, this.rendererRef)
    this.backend.mount()

    // 任何引擎状态变化都重渲染（通过内部通道，避免被外部 onChange 覆盖）
    this.editor.onStateChange = () => this.render()

    this.render()
    // DOM 选区变化时回写模型（不触发渲染），保证 editor.selection 与实际选区一致
    this.content.ownerDocument.addEventListener('selectionchange', this.handleSelectionChange)
  }

  private handleSelectionChange = (): void => {
    const selection = this.renderer.getSelectionRange()
    if (selection) this.editor.setSelection(selection)
  }

  /** 渲染器（测试 / 高级用法） */
  get renderer(): Renderer {
    return this.rendererRef
  }

  render(): void {
    this.rendererRef.render(this.editor.doc)
  }

  /** 切换视图模式（flow / page） */
  setViewMode(mode: ViewMode): void {
    this.rendererRef.setViewMode(mode)
    this.render()
  }

  focus(): void {
    // preventScroll：避免浏览器把画布滚到内容中间（空文档时尤其明显）
    this.content.focus({ preventScroll: true })
  }

  blur(): void {
    this.content.blur()
  }

  destroy(): void {
    this.content.ownerDocument.removeEventListener('selectionchange', this.handleSelectionChange)
    this.backend.unmount()
    this.element.remove()
  }
}
