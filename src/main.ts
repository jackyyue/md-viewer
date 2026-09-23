// 入口。有参数就用参数，没参数就弹系统文件夹选择框。
//
// 用法：
//   node src/main.ts <文件夹路径>
//   md-viewer.cmd <文件夹路径>
//   把文件夹拖到 md-viewer.cmd 上
//   不带参数双击 md-viewer.cmd → 弹选择框

import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from './server.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(here, '..', 'public')

const FOLDER_DIALOG = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择要用 md-viewer 打开的文件夹'
$dialog.ShowNewFolderButton = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.SelectedPath)
}
`

function pickFolder(): string | null {
  for (const shell of ['pwsh', 'powershell']) {
    const result = spawnSync(shell, ['-NoProfile', '-Command', FOLDER_DIALOG], {
      encoding: 'utf8',
    })
    if (result.error !== undefined && result.error !== null) continue // 这个 shell 不存在，换下一个
    const picked = (result.stdout ?? '').trim()
    if (picked !== '') return picked
    return null // shell 在，但用户取消了
  }
  return null
}

function fail(message: string): never {
  process.stderr.write(`md-viewer: ${message}\n`)
  process.exit(1)
}

function resolveRoot(argv: string[]): string {
  const arg = argv[0]
  if (arg !== undefined && arg.trim() !== '') return arg

  const picked = pickFolder()
  if (picked === null) fail('没有选择文件夹，退出。也可以直接把文件夹路径作为参数传进来。')
  return picked
}

function openBrowser(url: string): void {
  const child = spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' })
  child.on('error', () => {
    process.stdout.write('没能自动打开浏览器，请手动访问上面的地址。\n')
  })
  child.unref()
}

async function main(): Promise<void> {
  const rawRoot = resolveRoot(process.argv.slice(2))

  let rootReal: string
  try {
    rootReal = fs.realpathSync.native(path.resolve(rawRoot))
  } catch {
    fail(`找不到这个文件夹：${rawRoot}`)
  }

  if (!fs.statSync(rootReal).isDirectory()) {
    fail(`这不是一个文件夹：${rootReal}`)
  }

  const handle = await startServer({ rootReal, publicDir })

  process.stdout.write(`md-viewer 已启动\n`)
  process.stdout.write(`  库根：${rootReal}\n`)
  process.stdout.write(`  地址：${handle.url}\n`)
  process.stdout.write(`关掉这个窗口即停止。\n`)

  openBrowser(handle.url)

  const shutdown = (): void => {
    void handle.close().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
