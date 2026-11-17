// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { WofficeApp } from '@/app/editor-app'

function mount(): { container: HTMLElement; app: WofficeApp } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const app = new WofficeApp({ container })
  return { container, app }
}

describe('WofficeApp 外壳', () => {
  it('渲染完整外壳：顶栏 / 工具栏 / 画布 / 状态栏', () => {
    const { container, app } = mount()
    expect(container.querySelector('.woffice-app-header')).not.toBeNull()
    expect(container.querySelector('.woffice-app-toolbar')).not.toBeNull()
    expect(container.querySelector('.woffice-app-canvas')).not.toBeNull()
    expect(container.querySelector('.woffice-app-statusbar')).not.toBeNull()
    // 编辑器挂载进画布
    expect(container.querySelector('.woffice-app-canvas .woffice-editor-content')).not.toBeNull()
    app.destroy()
  })

  it('destroy 后移除根节点', () => {
    const { container, app } = mount()
    app.destroy()
    expect(container.querySelector('.woffice-app')).toBeNull()
  })

  it('默认工具栏包含内置命令', () => {
    const { container, app } = mount()
    const titles = Array.from(container.querySelectorAll('.woffice-app-tb-btn')).map(
      (btn) => btn.getAttribute('aria-label') ?? '',
    )
    expect(titles).toContain('撤销 (Mod-Z)')
    expect(titles).toContain('加粗 (Mod-B)')
    expect(titles).toContain('无序列表 (Mod-Shift-7)')
    app.destroy()
  })

  it('自定义工具栏项', () => {
    const { app } = mount()
    app.destroy()
    const custom = document.createElement('div')
    document.body.appendChild(custom)
    const app2 = new WofficeApp({ container: custom, toolbar: ['bold', 'separator', 'italic'] })
    const buttons = custom.querySelectorAll('.woffice-app-tb-btn')
    expect(buttons.length).toBe(2)
    expect(buttons[0].getAttribute('aria-label')).toBe('加粗 (Mod-B)')
    app2.destroy()
  })

  it('可隐藏顶栏 / 状态栏 / 工具栏', () => {
    const { app } = mount()
    app.destroy()
    const minimal = document.createElement('div')
    document.body.appendChild(minimal)
    const app2 = new WofficeApp({
      container: minimal,
      header: false,
      statusbar: false,
      toolbar: false,
    })
    expect(minimal.querySelector('.woffice-app-header')).toBeNull()
    expect(minimal.querySelector('.woffice-app-statusbar')).toBeNull()
    expect(minimal.querySelector('.woffice-app-toolbar')).toBeNull()
    expect(minimal.querySelector('.woffice-editor-content')).not.toBeNull()
    app2.destroy()
  })

  it('暴露底层 editor，可命令式操作', () => {
    const { container, app } = mount()
    expect(app.editor.doc.children.length).toBeGreaterThan(0)
    app.editor.commands.run('heading.h1')
    expect(app.editor.doc.children[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } })
    app.destroy()
    expect(container.querySelector('.woffice-app')).toBeNull()
  })
})
