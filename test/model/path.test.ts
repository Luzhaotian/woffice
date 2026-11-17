import { describe, expect, it } from 'vitest'
import {
  commonAncestor,
  compare,
  comparePosition,
  isAncestor,
  isRoot,
  isSamePath,
  isSibling,
  last,
  next,
  parent,
  prev,
} from '@/model/path'

describe('path', () => {
  it('parent / last', () => {
    expect(parent([0, 1, 2])).toEqual([0, 1])
    expect(parent([0])).toEqual([])
    expect(parent([])).toEqual([])
    expect(last([0, 1, 2])).toBe(2)
  })

  it('next / prev', () => {
    expect(next([0, 1])).toEqual([0, 2])
    expect(next([])).toEqual([0])
    expect(prev([0, 1])).toEqual([0, 0])
    expect(prev([0])).toEqual([0])
  })

  it('isRoot / isSamePath', () => {
    expect(isRoot([])).toBe(true)
    expect(isRoot([0])).toBe(false)
    expect(isSamePath([0, 1], [0, 1])).toBe(true)
    expect(isSamePath([0, 1], [0, 2])).toBe(false)
  })

  it('isAncestor', () => {
    expect(isAncestor([], [0])).toBe(true)
    expect(isAncestor([0], [0, 1])).toBe(true)
    expect(isAncestor([0, 1], [0, 1])).toBe(false)
    expect(isAncestor([0, 2], [0, 1])).toBe(false)
  })

  it('compare 字典序', () => {
    expect(compare([0, 1], [0, 2])).toBeLessThan(0)
    expect(compare([0, 2], [0, 1])).toBeGreaterThan(0)
    expect(compare([0], [0, 0])).toBeLessThan(0)
    expect(compare([1], [0])).toBeGreaterThan(0)
    expect(compare([0, 1], [0, 1])).toBe(0)
  })

  it('commonAncestor', () => {
    expect(commonAncestor([0, 1, 2], [0, 1, 3])).toEqual([0, 1])
    expect(commonAncestor([0, 1], [2, 3])).toEqual([])
    expect(commonAncestor([0], [0, 1])).toEqual([0])
  })

  it('isSibling', () => {
    expect(isSibling([0, 1], [0, 2])).toBe(true)
    expect(isSibling([0, 1], [1, 1])).toBe(false)
    expect(isSibling([0], [0])).toBe(false)
  })

  it('comparePosition', () => {
    expect(comparePosition({ path: [0], offset: 5 }, { path: [0], offset: 3 })).toBeGreaterThan(0)
    expect(comparePosition({ path: [0, 1], offset: 0 }, { path: [0, 2], offset: 0 })).toBeLessThan(
      0,
    )
  })
})
