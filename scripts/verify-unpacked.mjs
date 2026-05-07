#!/usr/bin/env node
// Verify that electron-builder's unpacked output contains a complete bundled
// Node runtime (node.exe + npm-cli.js). Releases v0.1.3–v0.1.5 each shipped
// a different incomplete subset — this guard runs in CI right after
// packaging so we don't upload another broken installer.

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const matrixTarget = process.argv[2]
if (!matrixTarget) {
  console.error('usage: verify-unpacked.mjs <matrix-target>   e.g. win-x64, linux-x64')
  process.exit(2)
}

// Matrix target labels (win-x64) → runtime/extraResources dir names
// (win32-x64). Linux/macOS already match.
const [matrixPlatform, arch] = matrixTarget.split('-')
const platform =
  matrixPlatform === 'win' ? 'win32' : matrixPlatform === 'mac' ? 'darwin' : matrixPlatform
const target = `${platform}-${arch}`
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
    ? join(nodeRoot, 'vendor_modules', 'npm', 'bin', 'npm-cli.js')
    : join(nodeRoot, 'lib', 'vendor_modules', 'npm', 'bin', 'npm-cli.js'),
  join(resourcesDir, 'studio', 'server', 'index.js'),
  // Studio's deps must survive electron-builder's extraResources stripping
  // — see scripts/build-studio.mjs for the node_modules → vendor_modules
  // rename. Without `next` reachable, server/index.js crashes on its first
  // require() call (caught by 04-real-bootstrap, would otherwise ship).
  join(resourcesDir, 'studio', 'vendor_modules', 'next', 'package.json'),
  // Bundled openclaw — same node_modules → vendor_modules rename so the
  // tree survives extraResources packaging. paths.ts looks here first
  // before falling back to the legacy runtime-install path.
  join(resourcesDir, 'openclaw', 'vendor_modules', 'openclaw', 'package.json')
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
