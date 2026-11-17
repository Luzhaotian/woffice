/**
 * Plugin：Schema + Commands + Keymap 的组合
 *
 * 内置插件与第三方扩展使用同一套接口；内核保持精简。
 */

import type { MarkSpec, NodeSpec } from '@/model/schema'
import type { Editor } from '@/editor'

/** 命令：读取编辑器状态（文档 / 选区）→ dispatch 事务，返回是否有实际修改 */
export type Command = (editor: Editor, ...args: any[]) => boolean

/** 快捷键表：组合键 → 命令名（组合键格式如 "Mod-b" / "Mod-Shift-7"） */
export type Keymap = Record<string, string>

export interface Plugin {
  name: string
  nodes?: NodeSpec[]
  marks?: MarkSpec[]
  commands?: Record<string, Command>
  keymap?: Keymap
}
