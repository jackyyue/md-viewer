// 服务的集成测试。覆盖单元测试碰不到的边界：越界请求、两个性能上限、偏好读写。
//
// 偏好写到临时文件，不碰真实的那份（这也是给 startServer 加 prefsFile 的原因）。

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../src/server.ts'
import { MAX_FILES, MAX_FILE_BYTES } from '../src/config.ts'

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url))

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function makeLibrary(): string {
  const root = tempDir('md-viewer-server-')
  fs.writeFileSync(path.join(root, 'a.md'), '# a\n\n[内](b.md) [外](../x.md)\n')
  fs.writeFileSync(path.join(root, 'b.md'), '# b\n')
  fs.writeFileSync(path.join(root, 'note.txt'), '不是 md')
  return fs.realpathSync.native(root)
}

async function withServer(
  buildRoot: () => string,
  run: (base: string, root: string) => Promise<void>,
): Promise<void> {
  const root = buildRoot()
  const handle = await startServer({
    rootReal: root,
    publicDir: PUBLIC_DIR,
    prefsFile: path.join(tempDir('md-viewer-prefs-'), 'prefs.json'),
  })
  try {
    await run(handle.url.replace(/\/$/, ''), root)
  } finally {
    await handle.close()
  }
}

const get = async (base: string, route: string) => {
  const response = await fetch(base + route)
  const text = await response.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    // 页面和纯文本错误不是 JSON
  }
  return { status: response.status, text, json }
}

test('目录树只列 md，渲染出的库内链接可点、库外置灰', async () => {
  await withServer(makeLibrary, async (base) => {
    const tree = await get(base, '/api/tree')
    assert.equal(tree.status, 200)
    const names = JSON.stringify(tree.json)
    assert.ok(names.includes('a.md') && names.includes('b.md'))
    assert.ok(!names.includes('note.txt'), '非 md 文件不该进树')

    const doc = await get(base, `/api/file?p=${encodeURIComponent('a.md')}`)
    assert.equal(doc.status, 200)
    const html = (doc.json as { html: string }).html
    assert.ok(html.includes('class="md-link"'), '库内链接应当可点')
    assert.ok(html.includes('class="inert"'), '库外链接应当置灰')
  })
})

test('越界请求一律 403', async () => {
  await withServer(makeLibrary, async (base) => {
    const attacks = [
      '../outside.md',
      '../../windows/win.ini',
      '..%2F..%2Fwindows%2Fwin.ini',
      'C:/Windows/win.ini',
      '/etc/passwd',
      'sub/../../../etc/passwd',
      '',
    ]
    for (const attack of attacks) {
      const res = await get(base, `/api/file?p=${encodeURIComponent(attack)}`)
      assert.equal(res.status, 403, `应当拒绝：${attack || '(空)'}`)
    }
  })
})

test('单文件超过上限时报 413，并说清超了多少', async () => {
  await withServer(
    () => {
      const root = tempDir('md-viewer-big-')
      fs.writeFileSync(path.join(root, 'huge.md'), 'x'.repeat(MAX_FILE_BYTES + 1))
      return fs.realpathSync.native(root)
    },
    async (base) => {
      const res = await get(base, `/api/file?p=${encodeURIComponent('huge.md')}`)
      assert.equal(res.status, 413)
      assert.match((res.json as { error: string }).error, /超过上限/)
    },
  )
})

test('库内文件数超过上限时报 413', async () => {
  // 要真造 MAX_FILES+1 个文件才能走到生产常量。实测约 1.5 秒，可以接受
  await withServer(
    () => {
      const root = tempDir('md-viewer-many-')
      for (let i = 0; i <= MAX_FILES; i++) {
        fs.writeFileSync(path.join(root, `f${i}.md`), '# x\n')
      }
      return fs.realpathSync.native(root)
    },
    async (base) => {
      const res = await get(base, '/api/tree')
      assert.equal(res.status, 413)
      assert.match((res.json as { error: string }).error, new RegExp(`上限 ${MAX_FILES} 个`))
    },
  )
})

test('偏好：往返、夹取、垃圾输入不写坏', async () => {
  await withServer(makeLibrary, async (base) => {
    const post = async (body: unknown) =>
      fetch(`${base}/api/prefs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

    assert.equal((await get(base, '/api/prefs')).text, '{}')

    const saved = await post({ sidebarWidth: 300, outlineWidth: 220 })
    assert.equal(saved.status, 200)
    assert.deepEqual(await saved.json(), { sidebarWidth: 300, outlineWidth: 220 })
    assert.equal((await get(base, '/api/prefs')).text, '{"sidebarWidth":300,"outlineWidth":220}')

    // 负数夹到 0；不认识的字段丢掉；坏值不覆盖已有的好值
    assert.deepEqual(await (await post({ sidebarWidth: -5, evil: 1 })).json(), {
      sidebarWidth: 0,
      outlineWidth: 220,
    })
    assert.deepEqual(await (await post({ sidebarWidth: 'abc' })).json(), {
      sidebarWidth: 0,
      outlineWidth: 220,
    })

    // 请求体不是 JSON
    const bad = await fetch(`${base}/api/prefs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    assert.equal(bad.status, 400)
  })
})

test('静态文件走白名单，未知路由 404，非 GET 405', async () => {
  await withServer(makeLibrary, async (base) => {
    assert.equal((await get(base, '/')).status, 200)
    assert.equal((await get(base, '/static/app.js')).status, 200)
    assert.equal((await get(base, '/static/style.css')).status, 200)
    // 用编码形式发，免得 fetch 在客户端就把 .. 规范化掉，那样等于没测
    assert.equal((await get(base, '/static/%2e%2e/src/server.ts')).status, 404)
    assert.equal((await get(base, '/static/nope.js')).status, 404)
    assert.equal((await get(base, '/api/nope')).status, 404)

    const posted = await fetch(`${base}/api/tree`, { method: 'POST' })
    assert.equal(posted.status, 405)
  })
})
