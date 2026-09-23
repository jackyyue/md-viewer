// 全局常量。要调规格只改这里，不要散落到各处。

// 库的硬上限。超出时明确报错，不卡死。见 docs/spec.md 第 10 条。
export const MAX_FILES = 2000
export const MAX_FILE_BYTES = 2 * 1024 * 1024

// 目录树里永远不显示的目录名。点开头的目录也一律不显示（那条判断在 scan.ts）。
export const IGNORED_DIRS = ['node_modules', 'dist', 'build', '.venv']

// 只认 .md。见 docs/spec.md 第 6 条。
export const MD_EXTENSION = '.md'
