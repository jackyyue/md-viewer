// 路径安全的测试。这是全项目最不能出错的一块：越界读文件。

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  OutsideLibraryError,
  resolveInsideRoot,
  resolveLinkRel,
  toPosix,
} from '../src/paths.ts'

function makeLibrary(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-viewer-test-'))
  fs.writeFileSync(path.join(root, 'a.md'), '# a\n')
  fs.mkdirSync(path.join(root, 'sub'))
  fs.writeFileSync(path.join(root, 'sub', 'b.md'), '# b\n')
  return fs.realpathSync.native(root)
}

test('接受库内的相对路径', () => {
  const root = makeLibrary()
  assert.equal(toPosix(path.relative(root, resolveInsideRoot(root, 'a.md'))), 'a.md')
  assert.equal(toPosix(path.relative(root, resolveInsideRoot(root, 'sub/b.md'))), 'sub/b.md')
})

test('反斜杠写法的库内路径也接受', () => {
  const root = makeLibrary()
  assert.equal(toPosix(path.relative(root, resolveInsideRoot(root, 'sub\\b.md'))), 'sub/b.md')
})

test('拒绝越界', () => {
  const root = makeLibrary()
  for (const bad of [
    '../outside.md',
    'sub/../../outside.md',
    '..\\..\\outside.md',
    'sub/../..',
    '',
    '.',
    '\0',
  ]) {
    assert.throws(() => resolveInsideRoot(root, bad), OutsideLibraryError, `应当拒绝：${bad}`)
  }
})

test('拒绝绝对路径', () => {
  const root = makeLibrary()
  for (const bad of ['C:/Windows/win.ini', 'C:\\Windows\\win.ini', '/etc/passwd', '\\\\server\\share\\x.md']) {
    assert.throws(() => resolveInsideRoot(root, bad), OutsideLibraryError, `应当拒绝：${bad}`)
  }
})

test('拒绝不存在的路径', () => {
  const root = makeLibrary()
  assert.throws(() => resolveInsideRoot(root, 'nope.md'), OutsideLibraryError)
})

test('拒绝指向库外的符号链接', () => {
  const root = makeLibrary()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'md-viewer-outside-'))
  fs.writeFileSync(path.join(outside, 'secret.md'), '# secret\n')

  const link = path.join(root, 'link')
  try {
    fs.symlinkSync(fs.realpathSync.native(outside), link, 'junction')
  } catch (error) {
    // 这条测的是越界读文件，不许静默跳过：建不出链接就说清楚，让套件红着，
    // 否则这台机器上这条保护就永远没人验证，而测试仍然报绿。
    assert.fail(
      `这个环境建不了符号链接（${error instanceof Error ? error.message : String(error)}），` +
        '符号链接越界这条保护无法验证',
    )
  }

  assert.throws(() => resolveInsideRoot(root, 'link/secret.md'), OutsideLibraryError)
})

test('resolveLinkRel：库内、库外、外链分得清', () => {
  assert.equal(resolveLinkRel('a.md', 'b.md'), 'b.md')
  assert.equal(resolveLinkRel('sub/a.md', 'b.md'), 'sub/b.md')
  assert.equal(resolveLinkRel('sub/a.md', '../b.md'), 'b.md')
  assert.equal(resolveLinkRel('sub/a.md', './c/d.md'), 'sub/c/d.md')
  assert.equal(resolveLinkRel('a.md', '../../pi/wiki/x.md'), null)
  assert.equal(resolveLinkRel('a.md', 'https://example.com/x.md'), null)
  assert.equal(resolveLinkRel('a.md', 'mailto:a@b.c'), null)
  assert.equal(resolveLinkRel('a.md', '/abs/x.md'), null)
  assert.equal(resolveLinkRel('a.md', '#sec-1'), null)
  assert.equal(resolveLinkRel('a.md', 'b.md#sec-2'), 'b.md')
  assert.equal(resolveLinkRel('a.md', '2026-09-14=作者.md'), '2026-09-14=作者.md')
})
