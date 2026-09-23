// 界面偏好的持久化。
//
// 为什么不用浏览器的 localStorage：服务每次启动都挑一个随机端口，而
// localStorage 按源（协议+主机+端口）隔离，端口一变就读不到上一次的值。
// 所以偏好放在磁盘上，由服务端读写。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type Prefs = { sidebarWidth?: number; outlineWidth?: number }

// 栏最窄可以拖到 0——那条分隔线本身还留着，所以还拖得回来。
export const MIN_PANEL_WIDTH = 0
export const MAX_PANEL_WIDTH = 4000

function readWidth(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.round(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, value)))
}

/** 只接受有限数字，超出范围夹住。别的一律丢掉，不报错。 */
export function normalizePrefs(input: unknown): Prefs {
  if (typeof input !== 'object' || input === null) return {}
  const raw = input as Record<string, unknown>
  const out: Prefs = {}
  const sidebarWidth = readWidth(raw.sidebarWidth)
  const outlineWidth = readWidth(raw.outlineWidth)
  if (sidebarWidth !== undefined) out.sidebarWidth = sidebarWidth
  if (outlineWidth !== undefined) out.outlineWidth = outlineWidth
  return out
}

export function prefsFilePath(): string {
  const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.config')
  return path.join(base, 'md-viewer', 'prefs.json')
}

export function readPrefs(file: string): Prefs {
  try {
    return normalizePrefs(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return {} // 文件不存在或坏了，回到默认值，不当错误
  }
}

export function writePrefs(file: string, prefs: Prefs): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(prefs, null, 2)}\n`)
}
