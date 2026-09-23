// 界面偏好的读写与夹取。重点是坏输入不许把它写坏。

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  MAX_PANEL_WIDTH,
  normalizePrefs,
  prefsFilePath,
  readPrefs,
  writePrefs,
} from '../src/prefs.ts'

test('只接受有限的数字', () => {
  assert.deepEqual(normalizePrefs({ sidebarWidth: 320 }), { sidebarWidth: 320 })
  assert.deepEqual(normalizePrefs({ sidebarWidth: 320.6 }), { sidebarWidth: 321 })
  assert.deepEqual(normalizePrefs({ sidebarWidth: '320' }), {})
  assert.deepEqual(normalizePrefs({ sidebarWidth: Number.NaN }), {})
  assert.deepEqual(normalizePrefs({ sidebarWidth: Number.POSITIVE_INFINITY }), {})
  assert.deepEqual(normalizePrefs({ sidebarWidth: null }), {})
  assert.deepEqual(normalizePrefs({}), {})
  assert.deepEqual(normalizePrefs(null), {})
  assert.deepEqual(normalizePrefs('320'), {})
})

test('两个面板的宽度各自独立', () => {
  assert.deepEqual(normalizePrefs({ sidebarWidth: 300, outlineWidth: 240 }), {
    sidebarWidth: 300,
    outlineWidth: 240,
  })
  assert.deepEqual(normalizePrefs({ outlineWidth: 240 }), { outlineWidth: 240 })
  assert.deepEqual(normalizePrefs({ sidebarWidth: 300, outlineWidth: 'x' }), { sidebarWidth: 300 })
})

test('超出范围夹住，不报错', () => {
  assert.deepEqual(normalizePrefs({ sidebarWidth: -50 }), { sidebarWidth: 0 })
  assert.deepEqual(normalizePrefs({ sidebarWidth: 1e9 }), { sidebarWidth: MAX_PANEL_WIDTH })
  assert.deepEqual(normalizePrefs({ outlineWidth: -1 }), { outlineWidth: 0 })
})

test('坏文件当作没有偏好，不当错误', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-viewer-prefs-'))
  const file = path.join(dir, 'prefs.json')
  assert.deepEqual(readPrefs(file), {})
  fs.writeFileSync(file, '{ this is not json')
  assert.deepEqual(readPrefs(file), {})
})

test('写进去再读出来是同一个值', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-viewer-prefs-'))
  const file = path.join(dir, 'nested', 'prefs.json')
  writePrefs(file, { sidebarWidth: 412, outlineWidth: 188 })
  assert.deepEqual(readPrefs(file), { sidebarWidth: 412, outlineWidth: 188 })
})

test('偏好文件落在本机应用数据目录下', () => {
  const file = prefsFilePath()
  assert.ok(file.endsWith(path.join('md-viewer', 'prefs.json')), file)
})
