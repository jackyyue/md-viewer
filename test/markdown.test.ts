// Markdown 渲染的测试。范围见 docs/spec.md 第 8 条。

import test from 'node:test'
import assert from 'node:assert/strict'
import { plainText, renderMarkdown, type LinkTarget } from '../src/markdown.ts'

function classify(target: string): LinkTarget {
  if (/^https?:/.test(target)) return { kind: 'external' }
  if (target.startsWith('..') || target.startsWith('/')) return { kind: 'outside' }
  return { kind: 'inside', rel: target }
}

function render(md: string): string {
  return renderMarkdown(md, { currentRel: 'a.md', classifyLink: classify }).html
}

test('标题进大纲，并且带上锚点 id', () => {
  const result = renderMarkdown('# 一\n\n## 二\n\ntext', {
    currentRel: 'a.md',
    classifyLink: classify,
  })
  assert.deepEqual(result.outline, [
    { level: 1, text: '一', id: 'sec-1' },
    { level: 2, text: '二', id: 'sec-2' },
  ])
  assert.match(result.html, /<h1 id="sec-1">一<\/h1>/)
  assert.match(result.html, /<h2 id="sec-2">二<\/h2>/)
})

test('代码块按语言上色，关键字是加粗的那一类', () => {
  const html = render('```typescript\nconst x = 1\n```')
  assert.match(html, /<pre><code class="lang-typescript">/)
  assert.match(html, /<span class="hl-kw">const<\/span>/)
})

test('text 代码块不上色，只转义', () => {
  const html = render('```text\nconst x = 1\n```')
  assert.doesNotMatch(html, /hl-kw/)
  assert.match(html, /const x = 1/)
})

test('代码块里的尖括号被转义，不会变成标签', () => {
  const html = render('```ts\nconst a = <T>(x: T) => x\n```')
  assert.match(html, /&lt;T&gt;/)
  assert.doesNotMatch(html, /<T>/)
})

test('diff 代码块按行分加减', () => {
  const html = render('```diff\n-a\n+b\n@@ x @@\n```')
  assert.match(html, /hl-del/)
  assert.match(html, /hl-add/)
  assert.match(html, /hl-meta/)
})

test('表格有表头', () => {
  const html = render('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
  assert.match(html, /<thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead>/)
  assert.match(html, /<tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody>/)
})

test('链接分三类：库内可点、库外置灰、外链正常', () => {
  const html = render('[内](b.md) [外](../out.md) [网](https://example.com)')
  assert.match(html, /<a class="md-link" href="#" data-rel="b\.md">内<\/a>/)
  assert.match(html, /<span class="inert"[^>]*>外<\/span>/)
  assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noreferrer">网<\/a>/)
})

test('含等号和中文的链接目标原样保留', () => {
  const html = render('[x](2026-09-14=作者如何一个人做出paseo.md)')
  assert.match(html, /data-rel="2026-09-14=作者如何一个人做出paseo\.md"/)
})

test('frontmatter 用灰色小字显示，不当正文', () => {
  const html = render('---\ntitle: x\ndate: 2026-09-23\n---\n\n# 正文\n')
  assert.match(html, /<div class="frontmatter">/)
  assert.match(html, /title: x/)
  assert.match(html, /<h1 id="sec-1">正文<\/h1>/)
  assert.doesNotMatch(html, /<hr>/)
})

test('缩进列表会嵌套', () => {
  const html = render('- a\n  - b\n- c\n')
  assert.match(html, /<ul><li>a<ul><li>b<\/li><\/ul><\/li><li>c<\/li><\/ul>/)
})

test('有序列表用 ol', () => {
  const html = render('1. a\n2. b\n')
  assert.match(html, /<ol><li>a<\/li><li>b<\/li><\/ol>/)
})

test('引用块和分隔线', () => {
  const html = render('> 引用\n\n---\n\n正文\n')
  assert.match(html, /<blockquote>引用<\/blockquote>/)
  assert.match(html, /<hr>/)
})

test('正文里的 HTML 被转义', () => {
  const html = render('a < b & <script>alert(1)</script>')
  assert.match(html, /a &lt; b &amp; &lt;script&gt;/)
  assert.doesNotMatch(html, /<script>/)
})

test('图片不渲染，只留一句提示', () => {
  const html = render('![图](x.png)')
  assert.match(html, /\[图片：图\]/)
  assert.doesNotMatch(html, /<img/)
})

test('plainText 去掉行内标记', () => {
  assert.equal(plainText('**a** `b` [c](d.md) ![e](f.png)'), 'a b c e')
})
