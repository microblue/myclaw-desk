#!/usr/bin/env node
// Verify that electron-builder's unpacked output contains a complete bundled
// Node runtime (node.exe + npm-cli.js). Releases v0.1.3–v0.1.5 each shipped
// a different incomplete subset — this guard runs in CI right after
// packaging so we don't upload another broken installer.

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const target = process.argv[2]
if (!target) {
  console.error('usage: verify-unpacked.mjs <target>   e.g. win32-x64, linux-x64')
  process.exit(2)
}

const [platform, arch] = target.split('-')
const ROOT = resolve(import.meta.dirname, '..')

// electron-builder's per-target unpacked dir name.
const unpackedDir =
  platform === 'win32'
    ? join(ROOT, 'dist', 'win-unpacked')
    : platform === 'linux'
      ? join(ROOT, 'dist', `linux-unpacked${arch === 'arm64' ? '-arm64' : ''}`)
      : join(ROOT, 'dist', `mac${arch === 'arm64' ? '-arm64' : ''}`)

const resourcesDir =
  platform === 'darwin'
    ? join(unpackedDir, 'MyClaw.One Desktop.app', 'Contents', 'Resources')
    : join(unpackedDir, 'resources')

const nodeRoot = join(resourcesDir, 'node', target)

const required = [
  platform === 'win32' ? join(nodeRoot, 'node.exe') : join(nodeRoot, 'bin', 'node'),
  platform === 'win32'
    ? join(nodeRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : join(nodeRoot, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  join(resourcesDir, 'studio', 'server', 'index.js')
]

let ok = true
for (const p of required) {
  const present = existsSync(p)
  console.log(`${present ? '✓' : '✗'} ${p}`)
  if (!present) ok = false
}

if (!ok) {
  console.error(
    '\n[verify-unpacked] FAIL: required files missing from electron-builder output. ' +
      'Refusing to ship another broken installer.'
  )
  process.exit(1)
}
console.log('[verify-unpacked] OK')
