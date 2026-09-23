@echo off
rem md-viewer entry point.
rem Usage: md-viewer.cmd <folder>
rem Or drag a folder onto this file. Without a folder it opens a picker.
rem Keep this file ASCII-only: cmd.exe reads it in the local code page, so
rem non-ASCII text here turns into garbage and can break parsing.

chcp 65001 >nul
setlocal
set "HERE=%~dp0"

node "%HERE%src\main.ts" %*
if errorlevel 1 (
  echo.
  echo md-viewer exited with an error. Press any key to close.
  pause >nul
)
