// 目录扫描的测试：只显示 md、隐藏点目录与忽略名单、空枝剪掉、超限报错。

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LibraryTooLargeError, scanTree } from '../src/scan.ts'

function makeLibrary(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-viewer-scan-'))
  const write = (rel: string): void => {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, '# x\n')
  }

  write('a.md')
  write('sub/b.md')
  write('sub2/deep/f.md')
  write('.hidden/c.md')
  write('node_modules/d.md')
  write('dist/e.md')
  write('build/g.md')
  fs.mkdirSync(path.join(root, 'empty'), { recursive: true })
  fs.writeFileSync(path.join(root, 'note.txt'), 'not markdown')
  fs.writeFileSync(path.join(root, 'sub', 'image.png'), 'x')

  return fs.realpathSync.native(root)
}

test('只留 md，剪掉空枝，隐藏点目录和忽略名单', () => {
  const root = makeLibrary()
  assert.deepEqual(scanTree(root), [
    {
      type: 'dir',
      name: 'sub',
      rel: 'sub',
      children: [{ type: 'file', name: 'b.md', rel: 'sub/b.md' }],
    },
    {
      type: 'dir',
      name: 'sub2',
      rel: 'sub2',
      children: [
        {
          type: 'dir',
          name: 'deep',
          rel: 'sub2/deep',
          children: [{ type: 'file', name: 'f.md', rel: 'sub2/deep/f.md' }],
        },
      ],
    },
    { type: 'file', name: 'a.md', rel: 'a.md' },
  ])
})

test('目录排在文件前面，同类按名字排', () => {
  const root = makeLibrary()
  const tree = scanTree(root)
  assert.deepEqual(
    tree.map((node) => node.name),
    ['sub', 'sub2', 'a.md'],
  )
})

test('超过文件数上限时报错，不静默截断', () => {
  const root = makeLibrary()
  assert.throws(() => scanTree(root, 2), LibraryTooLargeError)
})

test('空目录不产生空枝', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-viewer-scan-empty-'))
  fs.mkdirSync(path.join(root, 'only'), { recursive: true })
  assert.deepEqual(scanTree(root), [])
})
