@echo off
rem run-on-secondary.cmd -- start a console that is born on the second screen.
rem ASCII-only. See run-on-secondary.ps1 for why (window position is decided at
rem CreateProcess time; any later move already let one frame flash on the primary).
rem
rem Usage:
rem   bin\run-on-secondary.cmd                     -> cmd /k, minimised on secondary
rem   bin\run-on-secondary.cmd /k "npm run dev"    -> extra args passed to cmd /k
rem   bin\run-on-secondary.cmd -Show               -> visible, but never focused
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-on-secondary.ps1" %*