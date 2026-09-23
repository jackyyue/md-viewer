// 目录扫描。只产出目录树需要的信息，不读文件内容。
//
// 规则见 docs/spec.md 第 6 条与第 10 条：
//   - 只显示文件夹和 .md 文件
//   - 隐藏点开头的目录，以及 IGNORED_DIRS 里的目录名
//   - 一个目录里如果没有任何 md（含子孙），整枝不显示
//   - 文件数超过上限直接报错，不静默截断

import fs from 'node:fs'
import path from 'node:path'
import { IGNORED_DIRS, MAX_FILES, MD_EXTENSION } from './config.ts'

export type TreeDir = { type: 'dir'; name: string; rel: string; children: TreeNode[] }
export type TreeFile = { type: 'file'; name: string; rel: string }
export type TreeNode = TreeDir | TreeFile

export class LibraryTooLargeError extends Error {
  readonly count: number

  constructor(count: number, limit: number) {
    super(`库里的 md 文件超过上限 ${limit} 个（已数到 ${count} 个）`)
    this.name = 'LibraryTooLargeError'
    this.count = count
  }
}

function byName(a: TreeNode, b: TreeNode): number {
  if (a.name === b.name) return 0
  return a.name < b.name ? -1 : 1
}

/**
 * 扫描库根，返回目录树（相对路径用 posix 分隔符）。
 * maxFiles 只为测试留的口子，生产一律用 config 里的值。
 */
export function scanTree(rootReal: string, maxFiles: number = MAX_FILES): TreeNode[] {
  const visited = new Set<string>()
  let fileCount = 0

  const walk = (absDir: string, relDir: string): TreeNode[] => {
    let realDir: string
    try {
      realDir = fs.realpathSync.native(absDir)
    } catch {
      return []
    }
    // 符号链接可能绕成环，走过的真实目录不再走第二遍
    if (visited.has(realDir)) return []
    visited.add(realDir)

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true })
    } catch {
      return [] // 权限不足之类的目录直接跳过，不中断整棵树
    }

    const dirs: TreeNode[] = []
    const files: TreeNode[] = []

    for (const entry of entries) {
      const name = entry.name
      if (name.startsWith('.')) continue

      const rel = relDir === '' ? name : `${relDir}/${name}`

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.includes(name)) continue
        const children = walk(path.join(absDir, name), rel)
        if (children.length > 0) dirs.push({ type: 'dir', name, rel, children })
        continue
      }

      if (name.toLowerCase().endsWith(MD_EXTENSION) && (entry.isFile() || entry.isSymbolicLink())) {
        fileCount += 1
        if (fileCount > maxFiles) throw new LibraryTooLargeError(fileCount, maxFiles)
        files.push({ type: 'file', name, rel })
      }
    }

    dirs.sort(byName)
    files.sort(byName)
    return [...dirs, ...files]
  }

  return walk(rootReal, '')
}
