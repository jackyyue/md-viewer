// Markdown → HTML。离线、零依赖，只为这个查看器服务。
//
// 覆盖范围见 docs/spec.md 第 8 条：
//   做：标题、段落、列表（含缩进嵌套）、有序列表、引用块、加粗斜体、行内代码、
//       围栏代码块（带浅色高亮）、表格（带表头）、链接、分隔线、frontmatter
//   不做：脚注、任务列表勾选框、数学公式、mermaid、图片渲染
//
// 链接分三类，由调用方判定（因为只有调用方知道库根在哪）：
//   inside   库内的 md，点了跳转
//   outside  指向库外，置灰不可点
//   external http/https 等外链，正常打开

import { highlight } from './highlight.ts'

export type OutlineItem = { level: number; text: string; id: string }

export type LinkTarget =
  | { kind: 'inside'; rel: string }
  | { kind: 'outside' }
  | { kind: 'external' }

export type RenderOptions = {
  currentRel: string
  classifyLink: (target: string) => LinkTarget
}

export type RenderResult = { html: string; outline: OutlineItem[] }

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escAttr = (s: string): string => esc(s).replace(/"/g, '&quot;')

/** 去掉行内标记，只留文字。给大纲用。 */
export function plainText(text: string): string {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
}

// 1 反引号围栏 / 2 行内代码
// 3 加粗 / 4 斜体
// 5 图片 alt / 6 图片 src
// 7 链接文字 / 8 链接目标
//
// 只存模式串。inline() 是递归的（链接文字要再过一遍行内解析），
// 而带 /g 的正则对象会带 lastIndex 状态——共享一个实例的话，
// 递归一进去就把外层游标重置了，外层循环永远走不完。
const INLINE_PATTERN =
  '(`+)([\\s\\S]*?)\\1|\\*\\*([^*]+)\\*\\*|\\*([^*\\n]+)\\*|!\\[([^\\]]*)\\]\\(([^)]*)\\)|\\[([^\\]]*)\\]\\(([^)]*)\\)'

function renderLink(text: string, target: string, options: RenderOptions): string {
  const resolved = options.classifyLink(target)
  const label = inline(text, options)

  if (resolved.kind === 'external') {
    return `<a href="${escAttr(target)}" target="_blank" rel="noreferrer">${label}</a>`
  }
  if (resolved.kind === 'inside') {
    return `<a class="md-link" href="#" data-rel="${escAttr(resolved.rel)}">${label}</a>`
  }
  return `<span class="inert" title="这个链接指向库外">${label}</span>`
}

function inline(text: string, options: RenderOptions): string {
  let out = ''
  let last = 0
  const re = new RegExp(INLINE_PATTERN, 'g')

  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    out += esc(text.slice(last, match.index))
    last = match.index + match[0].length

    if (match[2] !== undefined) out += `<code>${esc(match[2])}</code>`
    else if (match[3] !== undefined) out += `<strong>${esc(match[3])}</strong>`
    else if (match[4] !== undefined) out += `<em>${esc(match[4])}</em>`
    else if (match[5] !== undefined) {
      out += `<span class="inert" title="md-viewer 不渲染图片">[图片：${esc(match[5])}]</span>`
    } else if (match[7] !== undefined) {
      out += renderLink(match[7], match[8] ?? '', options)
    }
  }

  out += esc(text.slice(last))
  return out
}

// ---- 块级解析 ----

type ListItem = { text: string; nested: string }
type ListFrame = { indent: number; ordered: boolean; items: ListItem[] }

const HEADING_RE = /^(#{1,6})\s+(.*)$/
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const TABLE_SEP_RE = /^\s*\|?[\s:|-]*-{3,}[\s:|-]*\|?\s*$/
const FENCE_RE = /^\s*```\s*([^\s`]*)/

function indentWidth(leading: string): number {
  let width = 0
  for (const ch of leading) width += ch === '\t' ? 4 : 1
  return width
}

function isTableRow(line: string): boolean {
  return line.includes('|') && line.trim().length > 0
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

export function renderMarkdown(md: string, options: RenderOptions): RenderResult {
  const outline: OutlineItem[] = []
  const out: string[] = []
  const lines = md.replace(/\r\n?/g, '\n').split('\n')

  let index = 0

  // frontmatter：用灰色小字显示，不隐藏（隐藏会让人以为文件是空的）
  if (lines[0] !== undefined && lines[0].trim() === '---') {
    let end = -1
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        end = i
        break
      }
    }
    if (end > 0) {
      const body = lines.slice(1, end).map((line) => esc(line)).join('<br>')
      out.push(`<div class="frontmatter">${body}</div>`)
      index = end + 1
    }
  }

  let inCode = false
  let codeLang = ''
  let codeBuf: string[] = []
  let paraBuf: string[] = []
  let quoteBuf: string[] = []
  const listStack: ListFrame[] = []

  const flushPara = (): void => {
    if (paraBuf.length === 0) return
    out.push(`<p>${paraBuf.join(' ')}</p>`)
    paraBuf = []
  }

  const flushQuote = (): void => {
    if (quoteBuf.length === 0) return
    out.push(`<blockquote>${quoteBuf.join('<br>')}</blockquote>`)
    quoteBuf = []
  }

  const closeListFrame = (): void => {
    const frame = listStack.pop()
    if (frame === undefined) return
    const tag = frame.ordered ? 'ol' : 'ul'
    const items = frame.items
      .map((item) => `<li>${item.text}${item.nested}</li>`)
      .join('')
    const html = `<${tag}>${items}</${tag}>`
    const parent = listStack[listStack.length - 1]
    if (parent !== undefined && parent.items.length > 0) {
      parent.items[parent.items.length - 1].nested += html
    } else {
      out.push(html)
    }
  }

  const flushList = (): void => {
    while (listStack.length > 0) closeListFrame()
  }

  const flushAll = (): void => {
    flushList()
    flushQuote()
    flushPara()
  }

  const emitCode = (): void => {
    const code = codeBuf.join('\n')
    const langClass = codeLang === '' ? '' : ` class="lang-${escAttr(codeLang)}"`
    out.push(`<pre><code${langClass}>${highlight(code, codeLang)}</code></pre>`)
    codeBuf = []
    codeLang = ''
  }

  const nextNonBlank = (from: number): string | undefined => {
    for (let i = from; i < lines.length; i++) {
      if (lines[i].trim() !== '') return lines[i]
    }
    return undefined
  }

  while (index < lines.length) {
    const line = lines[index]

    if (inCode) {
      if (line.trim().startsWith('```')) {
        inCode = false
        emitCode()
      } else {
        codeBuf.push(line)
      }
      index += 1
      continue
    }

    if (FENCE_RE.test(line)) {
      flushAll()
      inCode = true
      codeLang = (line.match(FENCE_RE)?.[1] ?? '').trim()
      index += 1
      continue
    }

    if (line.trim() === '') {
      // 空行如果后面还接着列表，就当成列表内部的空行，不切断列表
      const upcoming = nextNonBlank(index + 1)
      if (upcoming !== undefined && LIST_RE.test(upcoming)) {
        index += 1
        continue
      }
      flushAll()
      index += 1
      continue
    }

    const heading = line.match(HEADING_RE)
    if (heading !== null) {
      flushAll()
      const level = heading[1].length
      const text = heading[2]
      const id = `sec-${outline.length + 1}`
      outline.push({ level, text: plainText(text), id })
      out.push(`<h${level} id="${id}">${inline(text, options)}</h${level}>`)
      index += 1
      continue
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushAll()
      out.push('<hr>')
      index += 1
      continue
    }

    const next = lines[index + 1]
    if (isTableRow(line) && next !== undefined && TABLE_SEP_RE.test(next) && next.includes('-')) {
      flushAll()
      const header = parseTableRow(line)
      index += 2
      const body: string[][] = []
      while (index < lines.length && isTableRow(lines[index])) {
        body.push(parseTableRow(lines[index]))
        index += 1
      }
      const head = `<tr>${header.map((c) => `<th>${inline(c, options)}</th>`).join('')}</tr>`
      const rows = body
        .map((cells) => `<tr>${cells.map((c) => `<td>${inline(c, options)}</td>`).join('')}</tr>`)
        .join('')
      out.push(`<table><thead>${head}</thead><tbody>${rows}</tbody></table>`)
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      flushList()
      flushPara()
      quoteBuf.push(inline(line.replace(/^\s*>\s?/, ''), options))
      index += 1
      continue
    }

    const listItem = line.match(LIST_RE)
    if (listItem !== null) {
      flushQuote()
      flushPara()
      const indent = indentWidth(listItem[1])
      const ordered = /^\d/.test(listItem[2])
      const text = inline(listItem[3], options)

      while (listStack.length > 0) {
        const top = listStack[listStack.length - 1]
        if (top.indent > indent) {
          closeListFrame()
          continue
        }
        if (top.indent === indent && top.ordered !== ordered) closeListFrame()
        break
      }

      const top = listStack[listStack.length - 1]
      if (top === undefined || top.indent < indent) {
        listStack.push({ indent, ordered, items: [] })
      }
      listStack[listStack.length - 1].items.push({ text, nested: '' })
      index += 1
      continue
    }

    flushList()
    flushQuote()
    paraBuf.push(inline(line, options))
    index += 1
  }

  if (inCode) emitCode()
  flushAll()

  return { html: out.join('\n'), outline }
}
