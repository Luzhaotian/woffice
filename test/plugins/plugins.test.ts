// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type { Document } from '@/model/node'
import { createDocument, createElement, createText } from '@/model/node'
import type { Position } from '@/model/path'
import { createSelection } from '@/engine/selection'
import { setBlockType } from '@/engine/commands'
import { Editor } from '@/editor'
import type { Plugin } from '@/plugins/plugin'
import { builtinPlugins } from '@/plugins/builtin/index'
import { Renderer } from '@/render/renderer'

function createEditor(doc: Document, from: Position, to?: Position): Editor {
  return new Editor(doc, { selection: createSelection(from, to ?? from) })
}

describe('插件系统', () => {
  it('默认注册内置插件（schema / 命令 / 快捷键）', () => {
    const editor = createEditor(createDocument([createElement('paragraph', [createText('a')])]), {
      path: [0, 0],
      offset: 0,
    })
    expect(editor.schema.nodes.map((n) => n.type)).toContain('paragraph')
    expect(editor.schema.nodes.map((n) => n.type)).toContain('heading')
    expect(editor.schema.marks.map((m) => m.type)).toContain('bold')
    expect(editor.commands.has('mark.bold')).toBe(true)
    expect(editor.commands.has('heading.h2')).toBe(true)
    expect(editor.commands.has('list.bullet')).toBe(true)
  })

  it('自定义插件：注册节点 + 命令 + 快捷键', () => {
    const spoilerPlugin: Plugin = {
      name: 'spoiler',
      nodes: [{ type: 'spoiler', role: 'block', tagName: 'div' }],
      commands: {
        'spoiler.toggle': (editor) => {
          const pos = editor.getCaret()
          if (!pos) return false
          const index = pos.path[0]
          const block = editor.doc.children[index]
          const next = block?.type === 'spoiler' ? 'paragraph' : 'spoiler'
          const tr = editor.transaction()
          for (const step of setBlockType(editor.doc, [index], next)) tr.addStep(step)
          editor.dispatch(tr)
          return true
        },
      },
      keymap: { 'Mod-Alt-s': 'spoiler.toggle' },
    }

    const editor = new Editor(createDocument([createElement('paragraph', [createText('a')])]), {
      plugins: [spoilerPlugin, ...builtinPlugins()],
      selection: createSelection({ path: [0, 0], offset: 0 }),
    })
    expect(editor.schema.nodes.map((n) => n.type)).toContain('spoiler')
    expect(editor.commands.has('spoiler.toggle')).toBe(true)
    expect(
      editor.keymap.resolve({
        key: 's',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: true,
      }),
    ).toBe('spoiler.toggle')

    editor.commands.run('spoiler.toggle')
    expect(editor.doc.children[0]).toMatchObject({ type: 'spoiler' })
  })

  it('快捷键解析', () => {
    const editor = createEditor(createDocument([createElement('paragraph', [createText('a')])]), {
      path: [0, 0],
      offset: 0,
    })
    const base = { metaKey: false, shiftKey: false, altKey: false }
    expect(editor.keymap.resolve({ ...base, key: 'b', ctrlKey: true })).toBe('mark.bold')
    expect(editor.keymap.resolve({ ...base, key: 'i', ctrlKey: true })).toBe('mark.italic')
    expect(editor.keymap.resolve({ ...base, key: 'z', ctrlKey: true })).toBe('history.undo')
    expect(editor.keymap.resolve({ ...base, key: 'Z', ctrlKey: true, shiftKey: true })).toBe(
      'history.redo',
    )
    expect(editor.keymap.resolve({ ...base, key: 'x', ctrlKey: true })).toBeUndefined()
  })
})

describe('内置命令', () => {
  it('mark.bold：选区加粗', () => {
    const doc = createDocument([createElement('paragraph', [createText('hello')])])
    const editor = createEditor(doc, { path: [0, 0], offset: 0 }, { path: [0, 0], offset: 5 })
    editor.commands.run('mark.bold')
    expect(editor.doc).toEqual(
      createDocument([createElement('paragraph', [createText('hello', [{ type: 'bold' }])])]),
    )
  })

  it('折叠光标点加粗：不改已有文字，只设置待输入格式', () => {
    const doc = createDocument([createElement('paragraph', [createText('abc')])])
    const editor = createEditor(doc, { path: [0, 0], offset: 3 })
    editor.commands.run('mark.bold')
    expect(editor.doc).toEqual(doc)
    expect(editor.storedMarks?.map((m) => m.type)).toEqual(['bold'])
    expect(editor.getInputMarks()).toEqual([{ type: 'bold' }])
  })

  it('待输入格式再点一次取消', () => {
    const doc = createDocument([createElement('paragraph', [createText('abc')])])
    const editor = createEditor(doc, { path: [0, 0], offset: 3 })
    editor.commands.run('mark.bold')
    editor.commands.run('mark.bold')
    expect(editor.storedMarks).toEqual([])
    expect(editor.getInputMarks()).toEqual([])
  })

  it('光标移动后待输入格式失效', () => {
    const doc = createDocument([createElement('paragraph', [createText('abc')])])
    const editor = createEditor(doc, { path: [0, 0], offset: 3 })
    editor.commands.run('mark.bold')
    editor.setSelection(createSelection({ path: [0, 0], offset: 1 }))
    expect(editor.storedMarks).toBeUndefined()
  })

  it('mark.italic：部分选区斜体', () => {
    const doc = createDocument([createElement('paragraph', [createText('hello')])])
    const editor = createEditor(doc, { path: [0, 0], offset: 1 }, { path: [0, 0], offset: 4 })
    editor.commands.run('mark.italic')
    expect(editor.doc).toEqual(
      createDocument([
        createElement('paragraph', [
          createText('h'),
          createText('ell', [{ type: 'italic' }]),
          createText('o'),
        ]),
      ]),
    )
  })

  it('mark.link：带 attrs 的 mark', () => {
    const doc = createDocument([createElement('paragraph', [createText('hello')])])
    const editor = createEditor(doc, { path: [0, 0], offset: 0 }, { path: [0, 0], offset: 5 })
    const plugin = builtinPlugins().find((p) => p.name === 'mark')!
    plugin.commands!['mark.link'](editor, 'https://example.com')
    expect(editor.doc).toEqual(
      createDocument([
        createElement('paragraph', [
          createText('hello', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
        ]),
      ]),
    )
  })

  it('heading.h2：段落转标题，再点还原', () => {
    const doc = createDocument([createElement('paragraph', [createText('title')])])
    const editor = createEditor(doc, { path: [0, 0], offset: 0 })
    editor.commands.run('heading.h2')
    expect(editor.doc.children[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } })
    editor.commands.run('heading.h2')
    expect(editor.doc.children[0]).toMatchObject({ type: 'paragraph' })
  })

  it('list.bullet：段落包进列表，再点还原', () => {
    const doc = createDocument([createElement('paragraph', [createText('item')])])
    const editor = createEditor(doc, { path: [0, 0], offset: 0 })
    editor.commands.run('list.bullet')
    expect(editor.doc.children[0]).toMatchObject({ type: 'bullet_list' })
    editor.commands.run('list.bullet')
    expect(editor.doc.children[0]).toMatchObject({ type: 'paragraph' })
  })

  it('block.quote / block.code：块类型切换', () => {
    const doc = createDocument([createElement('paragraph', [createText('quote')])])
    const editor = createEditor(doc, { path: [0, 0], offset: 0 })
    editor.commands.run('block.quote')
    expect(editor.doc.children[0]).toMatchObject({ type: 'blockquote' })
    editor.commands.run('block.code')
    expect(editor.doc.children[0]).toMatchObject({ type: 'code_block' })
  })

  it('block.hr：插入分割线（末尾补空段落，便于继续输入）', () => {
    const doc = createDocument([createElement('paragraph', [createText('a')])])
    const editor = createEditor(doc, { path: [0, 0], offset: 0 })
    editor.commands.run('block.hr')
    expect(editor.doc.children.map((b) => b.type)).toEqual([
      'paragraph',
      'horizontal_rule',
      'paragraph',
    ])
    // 光标应落在分割线下方的空段落，而不是分割线（void）上
    expect(editor.state.selection.anchor.path).toEqual([2])
  })

  it('block.hr：空段落插入分割线后光标在分割线下方', () => {
    const doc = createDocument([
      createElement('paragraph', [createText('a')]),
      createElement('paragraph'),
    ])
    const editor = createEditor(doc, { path: [1, 0], offset: 0 })
    editor.commands.run('block.hr')
    expect(editor.doc.children.map((b) => b.type)).toEqual([
      'paragraph',
      'horizontal_rule',
      'paragraph',
    ])
    expect(editor.state.selection.anchor.path).toEqual([2])
  })

  it('history.undo / redo：撤销重做', () => {
    const doc = createDocument([createElement('paragraph', [createText('a')])])
    const editor = createEditor(doc, { path: [0, 0], offset: 0 })
    editor.commands.run('heading.h1')
    expect(editor.doc.children[0]).toMatchObject({ type: 'heading' })
    editor.commands.run('history.undo')
    expect(editor.doc.children[0]).toMatchObject({ type: 'paragraph' })
    editor.commands.run('history.redo')
    expect(editor.doc.children[0]).toMatchObject({ type: 'heading' })
  })

  it('未注册命令返回 false', () => {
    const editor = createEditor(createDocument([createElement('paragraph', [createText('a')])]), {
      path: [0, 0],
      offset: 0,
    })
    expect(editor.commands.run('not.exists')).toBe(false)
  })
})

describe('插件渲染', () => {
  it('page_break 使用插件自定义渲染', () => {
    const editor = new Editor(
      createDocument([
        createElement('paragraph', [createText('a')]),
        { type: 'page_break', void: true },
      ]),
    )
    const container = document.createElement('div')
    document.body.appendChild(container)
    const renderer = new Renderer(container, editor.schema)
    renderer.render(editor.doc)
    expect(container.querySelector('.woffice-page-break')).not.toBeNull()
  })
})
