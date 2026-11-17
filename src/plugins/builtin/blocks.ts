import { isText } from '@/model/node'
import type { Plugin } from '@/plugins/plugin'
import {
  insertField,
  insertHorizontalRule,
  setBlockQuote,
  setCodeBlock,
  setHeading,
  setParagraph,
} from '@/plugins/builtin/helpers'

export const basicBlocksPlugin: Plugin = {
  name: 'basic-blocks',
  nodes: [
    { type: 'paragraph', role: 'block', tagName: 'p' },
    {
      type: 'heading',
      role: 'block',
      tagName: 'h1',
      dynamicTag: (attrs) => `h${(attrs?.level as number) ?? 1}`,
    },
    { type: 'blockquote', role: 'block', tagName: 'blockquote' },
    { type: 'code_block', role: 'block', tagName: 'pre' },
    { type: 'horizontal_rule', role: 'void', tagName: 'hr' },
    {
      type: 'page_break',
      role: 'void',
      tagName: 'div',
      render: () => {
        const el = document.createElement('div')
        el.className = 'woffice-page-break'
        return el
      },
    },
    {
      type: 'field',
      role: 'inline',
      tagName: 'span',
      render: (node, renderChildren) => {
        const el = document.createElement('span')
        el.className = 'woffice-field'
        const children = renderChildren()
        if (children.length === 0) {
          const instr = (isText(node) ? undefined : node.attrs)?.instr ?? ''
          el.textContent = `{ ${String(instr)} }`
        } else {
          for (const child of children) el.appendChild(child)
        }
        return el
      },
    },
  ],
  commands: {
    'heading.h1': (editor) => setHeading(editor, 1),
    'heading.h2': (editor) => setHeading(editor, 2),
    'heading.h3': (editor) => setHeading(editor, 3),
    'block.paragraph': (editor) => setParagraph(editor),
    'block.quote': (editor) => setBlockQuote(editor),
    'block.code': (editor) => setCodeBlock(editor),
    'block.hr': (editor) => insertHorizontalRule(editor),
    'block.field': (editor, instr?: string) => insertField(editor, instr ?? 'PAGE'),
  },
  keymap: {
    'Mod-Alt-1': 'heading.h1',
    'Mod-Alt-2': 'heading.h2',
    'Mod-Alt-3': 'heading.h3',
  },
}
