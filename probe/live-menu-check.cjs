// Drive the LIVE (warm-standby) pet's right-click menu through CDP and verify each
// item's side effect. Attaches to the running renderer, so the owner's real pet is
// used -- not a throwaway copy.
const http = require('node:http')
const fs = require('node:fs')

const LOG = 'E:\dsh\dual-screen\pet-host.log'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Discover the pet's renderer debug port from the electron command line.
const { execSync } = require('node:child_process')
let port = 0
try {
  const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'electron.exe\'\\" | Where-Object { $_.CommandLine -like \'*pet-electron*\' } | Select-Object -ExpandProperty CommandLine"', { encoding: 'utf8' })
  const m = out.match(/--remote-debugging-port=(\d+)/)
  if (m) port = Number(m[1])
} catch { }
console.log('debug port from cmdline:', port || '(none - pet not launched with CDP)')
process.exit(0)
