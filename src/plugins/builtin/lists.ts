import type { Plugin } from '@/plugins/plugin'
import {
  indentList,
  outdentList,
  toggleBulletList,
  toggleOrderedList,
} from '@/plugins/builtin/helpers'

export const listPlugin: Plugin = {
  name: 'list',
  nodes: [
    { type: 'bullet_list', role: 'block', tagName: 'ul' },
    { type: 'ordered_list', role: 'block', tagName: 'ol' },
    { type: 'list_item', role: 'block', tagName: 'li' },
  ],
  commands: {
    'list.bullet': (editor) => toggleBulletList(editor),
    'list.ordered': (editor) => toggleOrderedList(editor),
    'list.indent': (editor) => indentList(editor),
    'list.outdent': (editor) => outdentList(editor),
  },
  keymap: {
    'Mod-Shift-7': 'list.bullet',
    'Mod-Shift-8': 'list.ordered',
    Tab: 'list.indent',
    'Shift-Tab': 'list.outdent',
  },
}
