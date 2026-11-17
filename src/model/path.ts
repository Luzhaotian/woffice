/**
 * Path：节点在文档树中的位置（从 doc 根出发的子节点下标数组）
 *
 * 空数组 [] 表示文档根；[a, b, c] 表示 doc.children[a].children[b].children[c]。
 */

export type Path = number[]

/** 父路径（根节点的父路径仍是根） */
export function parent(path: Path): Path {
  return path.slice(0, -1)
}

/** 最后一个下标 */
export function last(path: Path): number {
  return path[path.length - 1] ?? -1
}

/** 下一个兄弟路径 */
export function next(path: Path): Path {
  return [...path.slice(0, -1), last(path) + 1]
}

/** 上一个兄弟路径（已在第一个时原地返回，避免产生负下标） */
export function prev(path: Path): Path {
  return [...path.slice(0, -1), Math.max(last(path) - 1, 0)]
}

export function isRoot(path: Path): boolean {
  return path.length === 0
}

export function isSamePath(a: Path, b: Path): boolean {
  return a.length === b.length && a.every((index, i) => index === b[i])
}

/** ancestor 是否是 path 的严格祖先 */
export function isAncestor(ancestor: Path, path: Path): boolean {
  if (ancestor.length >= path.length) return false
  return ancestor.every((index, i) => index === path[i])
}

/** 字典序比较（文档顺序的近似，同父节点下严格成立） */
export function compare(a: Path, b: Path): number {
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}

/** 最近公共祖先路径 */
export function commonAncestor(a: Path, b: Path): Path {
  const length = Math.min(a.length, b.length)
  let i = 0
  while (i < length && a[i] === b[i]) i++
  return a.slice(0, i)
}

export function isSibling(a: Path, b: Path): boolean {
  return (
    a.length === b.length &&
    a.length > 0 &&
    !isSamePath(a, b) &&
    compare(parent(a), parent(b)) === 0
  )
}

// ---------------------------------------------------------------------------
// Position（光标 / 选区锚点，M1 会扩展为完整选区语义）
// ---------------------------------------------------------------------------

export interface Position {
  path: Path
  /** 文本内偏移，或子节点下标 */
  offset: number
}

export function comparePosition(a: Position, b: Position): number {
  const order = compare(a.path, b.path)
  return order !== 0 ? order : a.offset - b.offset
}
