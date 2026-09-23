// 路径安全。这是全项目唯一允许拼路径的地方，其它模块一律调用这里。
//
// 库根（rootReal）必须是 realpath 之后的绝对路径。所有函数都以它为唯一边界。

import fs from 'node:fs'
import path from 'node:path'

/** 请求的路径落在库外，或指向不存在的东西。 */
export class OutsideLibraryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutsideLibraryError'
  }
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

/** 判断 relative() 的结果是否指向父目录之外。不能只用 startsWith('..')，'..foo' 是合法目录名。 */
function escapes(relative: string): boolean {
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
}

export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * 把用户给的相对路径解析成库内的绝对真实路径。
 * 越界、绝对路径、不存在、以及符号链接指向库外，全部抛 OutsideLibraryError。
 */
export function resolveInsideRoot(rootReal: string, rel: string): string {
  if (rel.includes('\0')) throw new OutsideLibraryError('路径里有 NUL 字节')

  const posixRel = rel.split('\\').join('/')
  if (posixRel === '' || posixRel === '.') throw new OutsideLibraryError('没有指定文件')
  if (path.posix.isAbsolute(posixRel) || /^[a-zA-Z]:/.test(posixRel)) {
    throw new OutsideLibraryError('不接受绝对路径')
  }

  const lexical = path.resolve(rootReal, posixRel)
  if (escapes(path.relative(rootReal, lexical))) {
    throw new OutsideLibraryError('路径落在库外')
  }

  let real: string
  try {
    real = fs.realpathSync.native(lexical)
  } catch {
    throw new OutsideLibraryError('路径不存在')
  }
  if (escapes(path.relative(rootReal, real))) {
    throw new OutsideLibraryError('符号链接指向库外')
  }
  return real
}

/**
 * 把 md 里的链接目标解析成"相对库根的 posix 路径"。
 * 解析不出库内路径（外链、锚点、绝对路径、越界）就返回 null。
 */
export function resolveLinkRel(currentRel: string, target: string): string | null {
  if (target === '') return null
  const withoutHash = target.split('#')[0]
  if (withoutHash === '') return null

  const decoded = safeDecode(withoutHash)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)) return null // http: mailto: 等
  if (decoded.startsWith('/')) return null // 绝对路径一律当库外

  const dir = path.posix.dirname(currentRel)
  const joined = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, decoded))
  if (joined.startsWith('..') || path.posix.isAbsolute(joined)) return null
  return joined
}
