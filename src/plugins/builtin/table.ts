import type { Plugin } from '@/plugins/plugin'

export const tablePlugin: Plugin = {
  name: 'table',
  nodes: [
    { type: 'table', role: 'block', tagName: 'table' },
    { type: 'table_row', role: 'block', tagName: 'tr' },
    { type: 'table_cell', role: 'block', tagName: 'td' },
  ],
}
