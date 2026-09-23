// 本地服务。只监听 127.0.0.1，不对外暴露。
//
// 全部路由：
//   GET /                → 页面
//   GET /static/<name>   → 白名单里的静态文件
//   GET /api/tree        → 目录树
//   GET /api/file?p=...  → 一篇 md 的渲染结果
//
// 库根是唯一的边界，任何请求都要过 resolveInsideRoot。

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { MAX_FILE_BYTES, MD_EXTENSION } from './config.ts'
import { OutsideLibraryError, resolveInsideRoot, resolveLinkRel, safeDecode, toPosix } from './paths.ts'
import { LibraryTooLargeError, scanTree } from './scan.ts'
import { renderMarkdown, type LinkTarget } from './markdown.ts'

export type ServerHandle = {
  url: string
  port: number
  close: () => Promise<void>
}

const STATIC_FILES = new Set(['index.html', 'app.js', 'style.css'])

function sendText(res: http.ServerResponse, status: number, text: string): void {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(text)
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function serveStatic(res: http.ServerResponse, publicDir: string, name: string): void {
  const abs = path.join(publicDir, name)
  let body: Buffer
  try {
    body = fs.readFileSync(abs)
  } catch {
    sendText(res, 404, `静态文件缺失：${name}`)
    return
  }
  const type =
    name.endsWith('.css') ? 'text/css; charset=utf-8'
    : name.endsWith('.js') ? 'text/javascript; charset=utf-8'
    : 'text/html; charset=utf-8'
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

function handleTree(res: http.ServerResponse, rootReal: string): void {
  try {
    const tree = scanTree(rootReal)
    sendJson(res, 200, { name: path.basename(rootReal), root: rootReal, tree })
  } catch (error) {
    if (error instanceof LibraryTooLargeError) {
      sendJson(res, 413, { error: error.message })
      return
    }
    throw error
  }
}

function handleFile(res: http.ServerResponse, rootReal: string, url: URL): void {
  const requested = url.searchParams.get('p') ?? ''

  let abs: string
  try {
    abs = resolveInsideRoot(rootReal, requested)
  } catch (error) {
    if (error instanceof OutsideLibraryError) {
      sendJson(res, 403, { error: error.message })
      return
    }
    throw error
  }

  let size: number
  try {
    const stat = fs.statSync(abs)
    if (!stat.isFile()) {
      sendJson(res, 400, { error: '这不是一个文件' })
      return
    }
    size = stat.size
  } catch {
    sendJson(res, 404, { error: '读不到这个文件' })
    return
  }

  if (size > MAX_FILE_BYTES) {
    sendJson(res, 413, {
      error: `文件 ${Math.round(size / 1024)}KB，超过上限 ${Math.round(MAX_FILE_BYTES / 1024)}KB`,
    })
    return
  }

  const rel = toPosix(path.relative(rootReal, abs))

  // 只有调用方知道库根，所以链接分类在这里做
  const classifyLink = (target: string): LinkTarget => {
    const relTarget = resolveLinkRel(rel, target)
    if (relTarget === null) {
      const decoded = safeDecode(target)
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)) return { kind: 'external' }
      return { kind: 'outside' }
    }
    if (!relTarget.toLowerCase().endsWith(MD_EXTENSION)) return { kind: 'outside' }
    try {
      resolveInsideRoot(rootReal, relTarget)
    } catch {
      return { kind: 'outside' } // 库内但不存在，也当不可点
    }
    return { kind: 'inside', rel: relTarget }
  }

  const markdown = fs.readFileSync(abs, 'utf8')
  const { html, outline } = renderMarkdown(markdown, { currentRel: rel, classifyLink })

  sendJson(res, 200, { rel, html, outline })
}

function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rootReal: string,
  publicDir: string,
): void {
  if (req.method !== 'GET') {
    sendText(res, 405, '只支持 GET')
    return
  }

  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const pathname = url.pathname

  if (pathname === '/') {
    serveStatic(res, publicDir, 'index.html')
    return
  }
  if (pathname.startsWith('/static/')) {
    const name = pathname.slice('/static/'.length)
    if (!STATIC_FILES.has(name)) {
      sendText(res, 404, '没有这个静态文件')
      return
    }
    serveStatic(res, publicDir, name)
    return
  }
  if (pathname === '/api/tree') {
    handleTree(res, rootReal)
    return
  }
  if (pathname === '/api/file') {
    handleFile(res, rootReal, url)
    return
  }
  sendText(res, 404, '没有这个路由')
}

/** 起服务。端口交给系统挑，避免多个实例打架。 */
export function startServer(rootReal: string, publicDir: string): Promise<ServerHandle> {
  const server = http.createServer((req, res) => {
    try {
      handle(req, res, rootReal, publicDir)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!res.headersSent) sendJson(res, 500, { error: message })
      else res.end()
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}/`,
        port,
        close: () =>
          new Promise((done) => {
            server.close(() => done())
          }),
      })
    })
  })
}
