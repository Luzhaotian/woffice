/**
 * 命令注册表与快捷键表（M3 插件系统）
 */

import type { Editor } from '@/editor'
import type { Command, Keymap as KeymapSpec } from '@/plugins/plugin'

export class CommandRegistry {
  private readonly commands = new Map<string, Command>()

  constructor(private readonly editor: Editor) {}

  register(name: string, command: Command): void {
    this.commands.set(name, command)
  }

  run(name: string, ...args: unknown[]): boolean {
    const command = this.commands.get(name)
    return command ? command(this.editor, ...args) : false
  }

  has(name: string): boolean {
    return this.commands.has(name)
  }

  names(): string[] {
    return [...this.commands.keys()]
  }
}

export class KeymapTable {
  private readonly map = new Map<string, string>()

  register(map: KeymapSpec): void {
    for (const [combo, command] of Object.entries(map)) this.map.set(combo, command)
  }

  resolve(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): string | undefined {
    return this.map.get(comboFromEvent(event))
  }
}

/** 把键盘事件归一化为 "Mod-Shift-Alt-b" 形式的组合键 */
export function comboFromEvent(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
): string {
  const parts: string[] = []
  if (event.metaKey || event.ctrlKey) parts.push('Mod')
  if (event.shiftKey) parts.push('Shift')
  if (event.altKey) parts.push('Alt')
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  parts.push(key)
  return parts.join('-')
}
