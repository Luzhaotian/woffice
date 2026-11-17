import type { Plugin } from '@/plugins/plugin'
import { basicBlocksPlugin } from '@/plugins/builtin/blocks'
import { listPlugin } from '@/plugins/builtin/lists'
import { markPlugin } from '@/plugins/builtin/marks'
import { historyPlugin } from '@/plugins/builtin/behaviors'
import { tablePlugin } from '@/plugins/builtin/table'

/** 内置插件集（默认启用） */
export function builtinPlugins(): Plugin[] {
  return [basicBlocksPlugin, listPlugin, markPlugin, tablePlugin, historyPlugin]
}
