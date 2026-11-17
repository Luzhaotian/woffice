/**
 * 构建后处理：tsc 会把源码里的 `@/` 别名原样写进 dist 下的 .d.ts，
 * 导致发布后使用方无法解析（他们没有 `@` → src 的别名）。
 *
 * 这里把 `@/x/y` 还原成相对于当前 .d.ts 的路径。
 * dist 目录结构与 src 一致，所以 `@/x/y` → `dist/x/y`。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist', import.meta.url))

function resolveTarget(abs) {
  if (fs.existsSync(abs + '.d.ts')) return abs
  if (fs.existsSync(path.join(abs, 'index.d.ts'))) return path.join(abs, 'index')
  return null
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

let changed = 0
for (const file of walk(dist)) {
  const source = fs.readFileSync(file, 'utf8')
  const result = source.replace(/(['"])@\/([^'"]+)\1/g, (match, quote, spec) => {
    const target = resolveTarget(path.join(dist, spec))
    if (!target) return match
    let rel = path.relative(path.dirname(file), target).split(path.sep).join('/')
    if (!rel.startsWith('.')) rel = './' + rel
    return `${quote}${rel}${quote}`
  })
  if (result !== source) {
    fs.writeFileSync(file, result)
    changed++
  }
}

console.log(`fix-dts-alias: rewrote ${changed} d.ts file(s)`)
