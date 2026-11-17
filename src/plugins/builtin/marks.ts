import type { Plugin } from '@/plugins/plugin'
import { addComment, toggleLink, toggleMark } from '@/plugins/builtin/helpers'

export const markPlugin: Plugin = {
  name: 'mark',
  marks: [
    { type: 'bold', tagName: 'strong' },
    { type: 'italic', tagName: 'em' },
    { type: 'underline', tagName: 'u' },
    { type: 'strikethrough', tagName: 's' },
    { type: 'highlight', tagName: 'mark' },
    { type: 'code_inline', tagName: 'code' },
    { type: 'link', tagName: 'a' },
    { type: 'comment', tagName: 'span', className: 'woffice-mark-comment' },
    { type: 'track_insert', tagName: 'span', className: 'woffice-mark-track-insert' },
    { type: 'track_delete', tagName: 'span', className: 'woffice-mark-track-delete' },
  ],
  commands: {
    'mark.bold': (editor) => toggleMark(editor, 'bold'),
    'mark.italic': (editor) => toggleMark(editor, 'italic'),
    'mark.underline': (editor) => toggleMark(editor, 'underline'),
    'mark.strikethrough': (editor) => toggleMark(editor, 'strikethrough'),
    'mark.highlight': (editor) => toggleMark(editor, 'highlight'),
    'mark.code': (editor) => toggleMark(editor, 'code_inline'),
    'mark.link': (editor, url?: string) => toggleLink(editor, url),
    'mark.comment': (editor, text?: string) => addComment(editor, text),
  },
  keymap: {
    'Mod-b': 'mark.bold',
    'Mod-i': 'mark.italic',
    'Mod-u': 'mark.underline',
  },
}
