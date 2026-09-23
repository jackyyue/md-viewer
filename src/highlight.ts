// 代码块高亮。离线、零依赖。
//
// 规格见 docs/spec.md 第 8 条：
//   - 绝不用深色底
//   - 关键字除了颜色还要加粗（黑白打印机上颜色会变灰）
// 所以这里只输出 span 和类名，配色全在 style.css 里。

import { esc } from './html.ts'

type Rule = { cls: string; re: RegExp }

/** 所有规则都用粘性匹配，扫描位置由主循环控制，避免重复匹配同一段。
 *
 * 这些正则对象是模块级共享的可变状态（粘性匹配靠 lastIndex）。
 * 目前安全，因为 highlight() 不递归、且全程同步，每次 exec 前都会
 * 显式重置 lastIndex。改动时守住这两条，否则会出现外层游标被里层
 * 重置、循环转不出去的情况（本项目踩过一次，见 AGENTS.md 判断规则）。 */
function sticky(source: string): RegExp {
  return new RegExp(source, 'y')
}

const JS_KW =
  'const|let|var|function|return|if|else|for|while|do|class|new|import|export|from|async|await|' +
  'try|catch|finally|throw|typeof|instanceof|interface|type|enum|extends|implements|public|private|' +
  'protected|readonly|static|as|of|in|switch|case|break|continue|default|void|null|undefined|' +
  'true|false|this|super|yield|delete|declare|satisfies'

const PY_KW =
  'def|class|if|elif|else|for|while|return|import|from|as|with|try|except|finally|raise|lambda|yield|' +
  'pass|break|continue|and|or|not|in|is|None|True|False|self|async|await|global|nonlocal|assert|del'

const SH_KW =
  'if|then|else|elif|fi|for|in|do|done|while|until|case|esac|function|return|exit|local|export|' +
  'source|set|unset|read|echo|printf|cd|pwd|rm|cp|mv|mkdir|rmdir|touch|cat|grep|sed|awk|sort|head|' +
  'tail|find|xargs|curl|wget|git|npm|npx|node|pnpm|yarn|python|pwsh|powershell|test|true|false'

const JS_RULES: Rule[] = [
  { cls: 'hl-cm', re: sticky('//[^\\n]*|/\\*[\\s\\S]*?\\*/') },
  { cls: 'hl-st', re: sticky("'(?:\\\\.|[^'\\\\\\n])*'|\"(?:\\\\.|[^\"\\\\\\n])*\"|`(?:\\\\.|[^`\\\\])*`") },
  { cls: 'hl-nu', re: sticky('\\b(?:0[xXbBoO][0-9a-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?)\\b') },
  { cls: 'hl-kw', re: sticky(`\\b(?:${JS_KW})\\b`) },
  { cls: 'hl-fn', re: sticky('\\b[A-Za-z_$][\\w$]*(?=\\()') },
]

const PY_RULES: Rule[] = [
  { cls: 'hl-cm', re: sticky('#[^\\n]*') },
  { cls: 'hl-st', re: sticky("'''[\\s\\S]*?'''|\"\"\"[\\s\\S]*?\"\"\"|'(?:\\\\.|[^'\\\\\\n])*'|\"(?:\\\\.|[^\"\\\\\\n])*\"") },
  { cls: 'hl-nu', re: sticky('\\b\\d[\\d_]*(?:\\.\\d+)?\\b') },
  { cls: 'hl-kw', re: sticky(`\\b(?:${PY_KW})\\b`) },
  { cls: 'hl-fn', re: sticky('\\b[A-Za-z_][\\w]*(?=\\()') },
]

const SH_RULES: Rule[] = [
  { cls: 'hl-cm', re: sticky('#[^\\n]*') },
  { cls: 'hl-st', re: sticky("'(?:[^']*)'|\"(?:\\\\.|[^\"\\\\])*\"") },
  { cls: 'hl-nu', re: sticky('\\b\\d+\\b') },
  { cls: 'hl-kw', re: sticky(`\\b(?:${SH_KW})\\b`) },
]

const JSON_RULES: Rule[] = [
  { cls: 'hl-st', re: sticky('"(?:\\\\.|[^"\\\\])*"') },
  { cls: 'hl-nu', re: sticky('-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b') },
  { cls: 'hl-kw', re: sticky('\\b(?:true|false|null)\\b') },
]

const YAML_RULES: Rule[] = [
  { cls: 'hl-cm', re: sticky('#[^\\n]*') },
  { cls: 'hl-st', re: sticky("'(?:[^']*)'|\"(?:\\\\.|[^\"\\\\])*\"") },
  { cls: 'hl-nu', re: sticky('\\b\\d+(?:\\.\\d+)?\\b') },
  { cls: 'hl-kw', re: sticky('\\b(?:true|false|null|yes|no|on|off)\\b') },
]

// 认不出的语言：只认注释、字符串、数字。宁可少上色，不要乱上色。
const FALLBACK_RULES: Rule[] = [
  { cls: 'hl-cm', re: sticky('//[^\\n]*|#[^\\n]*|/\\*[\\s\\S]*?\\*/') },
  { cls: 'hl-st', re: sticky("'(?:\\\\.|[^'\\\\\\n])*'|\"(?:\\\\.|[^\"\\\\\\n])*\"") },
  { cls: 'hl-nu', re: sticky('\\b\\d+(?:\\.\\d+)?\\b') },
]

function rulesFor(lang: string): Rule[] {
  switch (lang) {
    case 'js':
    case 'jsx':
    case 'javascript':
    case 'mjs':
    case 'cjs':
    case 'ts':
    case 'tsx':
    case 'typescript':
      return JS_RULES
    case 'py':
    case 'python':
      return PY_RULES
    case 'sh':
    case 'bash':
    case 'shell':
    case 'zsh':
    case 'console':
      return SH_RULES
    case 'json':
    case 'jsonc':
      return JSON_RULES
    case 'yaml':
    case 'yml':
      return YAML_RULES
    default:
      return FALLBACK_RULES
  }
}

/** diff 是逐行判断的，单独走一条路。 */
function highlightDiff(code: string): string {
  return code
    .split('\n')
    .map((line) => {
      if (line.startsWith('@@')) return `<span class="hl-meta">${esc(line)}</span>`
      if (line.startsWith('+')) return `<span class="hl-add">${esc(line)}</span>`
      if (line.startsWith('-')) return `<span class="hl-del">${esc(line)}</span>`
      return esc(line)
    })
    .join('\n')
}

/** 纯文本（ASCII 树、日志、表格）不标任何颜色，只做转义。 */
function highlightPlain(code: string): string {
  return esc(code)
}

export function highlight(code: string, lang: string): string {
  const language = lang.trim().toLowerCase()

  if (language === 'diff' || language === 'patch') return highlightDiff(code)
  if (language === '' || language === 'text' || language === 'txt' || language === 'log') {
    return highlightPlain(code)
  }

  const rules = rulesFor(language)
  let out = ''
  let i = 0

  outer: while (i < code.length) {
    for (const rule of rules) {
      rule.re.lastIndex = i
      const match = rule.re.exec(code)
      if (match !== null && match[0].length > 0) {
        out += `<span class="${rule.cls}">${esc(match[0])}</span>`
        i += match[0].length
        continue outer
      }
    }
    out += esc(code[i])
    i += 1
  }

  return out
}
