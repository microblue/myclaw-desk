#!/usr/bin/env node
// Trim the bundled Node tree to runtime-only essentials.
//
// download-node.mjs grabs Node's full distribution because we need npm to
// run our build-time `npm install / next build` against the bundled ABI
// (otherwise prebuilt natives like better-sqlite3 mismatch the user's
// runtime). Once the openclaw + studio bundles are baked, the user's
// machine never needs npm again — we ship pre-installed trees and never
// shell out to it at runtime.
//
// Strip in this script (runs *last* in prepack so build-openclaw + build-
// studio still have npm available):
//   - include/                    Node header files for native compilation
//   - share/                      man pages, system images
//   - CHANGELOG.md, README.md     metadata
//   - lib/vendor_modules/npm      npm CLI + its 1500+ files
//   - lib/vendor_modules/corepack pnpm/yarn shim, unused
//   - bin/npm, bin/npx, …         symlinks dangling after npm is removed
//
// Saves ~80 MB and ~3000 files per target — translates directly to faster
// NSIS extraction (Windows Defender scans every file written) and a
// smaller installer download.

import { existsSync } from 'node:fs'
import { rm, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const NODE_ROOT = join(ROOT, 'resources', 'node')

let bytesReclaimed = 0
let filesRemoved = 0

async function dirSize(p) {
  let total = 0
  try {
    for (const entry of await readdir(p, { withFileTypes: true })) {
      const full = join(p, entry.name)
      total += entry.isDirectory() ? await dirSize(full) : (await stat(full)).size
    }
  } catch {
    // ignore
  }
  return total
}

async function reclaim(path) {
  if (!existsSync(path)) return
  try {
    const s = await stat(path)
    bytesReclaimed += s.isDirectory() ? await dirSize(path) : s.size
    await rm(path, { recursive: true, force: true })
    filesRemoved++
  } catch {
    // best-effort
  }
}

async function stripTarget(targetDir) {
  const target = targetDir.split('/').pop()
  console.log(`[strip-runtime] ${target}`)

  // Layout differs between Windows (flat) and POSIX (./bin, ./lib, …).
  const isWin = target.startsWith('win32')
  const libVendor = isWin
    ? join(targetDir, 'vendor_modules')
    : join(targetDir, 'lib', 'vendor_modules')

  const drops = [
    join(targetDir, 'include'),
    join(targetDir, 'share'),
    join(targetDir, 'CHANGELOG.md'),
    join(targetDir, 'README.md'),
    join(libVendor, 'npm'),
    join(libVendor, 'corepack'),
    // POSIX has shim launchers in bin/; on Windows the shims live next
    // to node.exe at the target root.
    isWin ? join(targetDir, 'npm') : join(targetDir, 'bin', 'npm'),
    isWin ? join(targetDir, 'npm.cmd') : null,
    isWin ? join(targetDir, 'npx') : join(targetDir, 'bin', 'npx'),
    isWin ? join(targetDir, 'npx.cmd') : null,
    isWin ? join(targetDir, 'corepack') : join(targetDir, 'bin', 'corepack'),
    isWin ? join(targetDir, 'corepack.cmd') : null
  ].filter(Boolean)

  for (const p of drops) await reclaim(p)
}

if (!existsSync(NODE_ROOT)) {
  console.warn(`[strip-runtime] ${NODE_ROOT} not found — skipping (run prepack:node first)`)
  process.exit(0)
}

const targets = await readdir(NODE_ROOT)
for (const t of targets) {
  const dir = join(NODE_ROOT, t)
  if ((await stat(dir)).isDirectory()) await stripTarget(dir)
}

console.log(
  `[strip-runtime] reclaimed ${(bytesReclaimed / 1024 / 1024).toFixed(1)} MB across ${filesRemoved} top-level entries`
)
