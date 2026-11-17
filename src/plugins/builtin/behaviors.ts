import type { Plugin } from '@/plugins/plugin'

export const historyPlugin: Plugin = {
  name: 'history',
  commands: {
    'history.undo': (editor) => editor.undo(),
    'history.redo': (editor) => editor.redo(),
  },
  keymap: {
    'Mod-z': 'history.undo',
    'Mod-Shift-z': 'history.redo',
    'Mod-y': 'history.redo',
  },
}
