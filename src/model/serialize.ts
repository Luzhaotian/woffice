/**
 * JSON 序列化 / 反序列化（规范格式，带 version）
 *
 * parse 会做结构校验并 normalize，保证读入的文档一定是 canonical 的。
 */

import type { Attrs, Document, Mark, Node } from '@/model/node'
import { normalize } from '@/model/normalize'

export interface SerializedDocument {
  type: 'doc'
  version: number
  children: unknown[]
}

export function toJSON(doc: Document): SerializedDocument {
  return { type: 'doc', version: doc.version, children: doc.children }
}

export function serialize(doc: Document): string {
  return JSON.stringify(toJSON(doc))
}

export function parse(input: string | SerializedDocument): Document {
  const data: unknown = typeof input === 'string' ? JSON.parse(input) : input
  return normalize(validateDocument(data))
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

function validateDocument(data: unknown): Document {
  assertObject(data)
  const record = data as Record<string, unknown>
  if (record.type !== 'doc') throw new TypeError('文档根节点必须是 { type: "doc" }')
  if (typeof record.version !== 'number') throw new TypeError('文档缺少 version 字段')
  if (!Array.isArray(record.children)) throw new TypeError('文档缺少 children 数组')
  return {
    type: 'doc',
    version: record.version,
    children: record.children.map(validateNode),
  }
}

function validateNode(data: unknown): Node {
  assertObject(data)
  const record = data as Record<string, unknown>
  const type = requireString(record.type, '节点 type')
  const attrs = validateAttrs(record.attrs)

  if (type === 'text') {
    const text = requireString(record.text, 'text 节点 text')
    const marks = record.marks === undefined ? undefined : validateMarks(record.marks)
    return marks ? { type: 'text', text, marks } : { type: 'text', text }
  }

  if (record.void === true) {
    return attrs ? { type, attrs, void: true } : { type, void: true }
  }

  if (!Array.isArray(record.children)) {
    throw new TypeError(`节点 "${type}" 必须包含 children 数组或 void: true`)
  }
  return {
    type,
    ...(attrs ? { attrs } : {}),
    children: record.children.map(validateNode),
  }
}

function validateMark(data: unknown): Mark {
  assertObject(data)
  const record = data as Record<string, unknown>
  const type = requireString(record.type, 'mark type')
  const attrs = validateAttrs(record.attrs)
  return attrs ? { type, attrs } : { type }
}

function validateMarks(data: unknown): Mark[] {
  if (!Array.isArray(data)) throw new TypeError('marks 必须是数组')
  return data.map(validateMark)
}

function validateAttrs(data: unknown): Attrs | undefined {
  if (data === undefined) return undefined
  assertObject(data)
  return data as Attrs
}

// ---------------------------------------------------------------------------
// 断言工具
// ---------------------------------------------------------------------------

function assertObject(data: unknown): asserts data is Record<string, unknown> {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('期望一个对象')
  }
}

function requireString(data: unknown, field: string): string {
  if (typeof data !== 'string') throw new TypeError(`"${field}" 必须是字符串`)
  return data
}
