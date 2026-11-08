@echo off
rem ============================================================================
rem whale-console.cmd -- start a console window that dsh-dual-screen can move.
rem
rem WHY THIS EXISTS (P0 finding F-A, owner-approved option C):
rem   On Windows 11 the default terminal is Windows Terminal, which is a
rem   SINGLETON reparented to svchost. A console launched the normal way becomes
rem   a TAB inside that singleton, so the window cannot be attributed to whoever
rem   started it -- moving it would drag the owner's own tabs to the second
rem   screen. So the mover never touches it.
rem
rem   Launching through conhost.exe produces a classic window instead:
rem     window class = ConsoleWindowClass
rem     window process = the console app itself (cmd.exe), which IS in the DSH
rem     process tree -> attributable -> safely movable.
rem
rem Usage (from any tool call or shell):
rem   bin\whale-console.cmd                       -> plain cmd in a moved window
rem   bin\whale-console.cmd cd /d J:\work ^&^& npm run dev
rem   bin\whale-console.cmd /k title my-task      (args are passed to cmd.exe)
rem
rem Anything after the script name is handed to cmd.exe as-is.
rem ============================================================================
setlocal
if "%~1"=="" (
  start "" "%SystemRoot%\System32\conhost.exe" cmd.exe /k
) else (
  start "" "%SystemRoot%\System32\conhost.exe" cmd.exe %*
)
endlocal