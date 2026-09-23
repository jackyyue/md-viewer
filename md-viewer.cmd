@echo off
rem md-viewer 入口。有参数用参数，没参数弹文件夹选择框。
rem 用法：md-viewer.cmd D:\oss-agent\paseo\wiki
rem      或把文件夹直接拖到本文件上。

chcp 65001 >nul
setlocal
set "HERE=%~dp0"

node "%HERE%src\main.ts" %*
if errorlevel 1 (
  echo.
  echo md-viewer 退出时带错误，按任意键关闭窗口。
  pause >nul
)
