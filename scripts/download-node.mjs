#!/usr/bin/env node
// Download a Node 24 binary into resources/node/<platform>-<arch>/.
// We bundle Node so the packaged Electron app can spawn `openclaw gateway`
// and `node studio/server/index.js` without depending on the user having
// the right Node version on PATH.
//
// Usage:
//   node scripts/download-node.mjs                       # current host
//   node scripts/download-node.mjs linux-x64 darwin-arm64 # multiple targets
//   NODE_VERSION=24.12.1 node scripts/download-node.mjs   # pin a version
//
// Re-running with the binary already present is a no-op.

import { existsSync, mkdirSync } from 'node:fs'
import { mkdir, rm, cp } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const RESOURCES_DIR = join(ROOT, 'resources', 'node')

const MAJOR = '24'

function validatePlatform(p) {
  if (p === 'darwin' || p === 'linux' || p === 'win32') return p
  throw new Error(`Unsupported platform: ${p}`)
}

function normalizeArch(a) {
  if (a === 'x64' || a === 'arm64') return a
  throw new Error(`Unsupported arch: ${a}`)
}

// Target dir names use Node's `process.platform` (and electron-builder's
// `${platform}` macro) verbatim — `win32`, not `win`. Node.js's *download
// URL* still uses the short form (`node-vX-win-x64.zip`); we map only the
// URL, not the directory layout, otherwise extraResources expands
// `${platform}-${arch}` to `win32-x64` and the bundle goes missing.
function detectHostTarget() {
  return `${validatePlatform(process.platform)}-${normalizeArch(process.arch)}`
}

function nodeUrlPlatform(p) {
  return p === 'win32' ? 'win' : p
}

function resolveNodeVersion() {
  if (process.env.NODE_VERSION) return process.env.NODE_VERSION
  // Probe nodejs.org for the latest 24.x release.
  const json = execFileSync('curl', ['-fsSL', 'https://nodejs.org/dist/index.json'], {
    encoding: 'utf8'
  })
  const releases = JSON.parse(json)
  const latest = releases.find((r) => r.version.startsWith(`v${MAJOR}.`))
  if (!latest) throw new Error(`No Node ${MAJOR}.x release found on nodejs.org`)
  return latest.version.slice(1) // strip leading 'v'
}

function targetBinPath(targetDir, platform) {
  return platform === 'win32' ? join(targetDir, 'node.exe') : join(targetDir, 'bin', 'node')
}

async function downloadOne(target, version) {
  const [platform, arch] = target.split('-')
  if (!platform || !arch) throw new Error(`Invalid target: ${target}`)

  const targetDir = join(RESOURCES_DIR, target)
  if (existsSync(targetBinPath(targetDir, platform))) {
    console.log(`[node] ${target} v${version} already present, skipping`)
    return
  }

  // Node.js's URL uses 'win' but our directory layout uses 'win32' to match
  // electron-builder's ${platform} macro.
  const urlPlatform = nodeUrlPlatform(platform)
  const ext = platform === 'win32' ? 'zip' : 'tar.xz'
  const urlFolder = `node-v${version}-${urlPlatform}-${arch}`
  const url = `https://nodejs.org/dist/v${version}/${urlFolder}.${ext}`
  console.log(`[node] downloading ${url}`)

  const stage = join(tmpdir(), `myclaw-node-${process.pid}-${target}`)
  mkdirSync(stage, { recursive: true })
  try {
    const archivePath = join(stage, `${urlFolder}.${ext}`)
    execFileSync('curl', ['-fsSL', '-o', archivePath, url], { stdio: 'inherit' })

    if (ext === 'tar.xz') {
      execFileSync('tar', ['-xJf', archivePath, '-C', stage], { stdio: 'inherit' })
    } else {
      // Windows zip. Use PowerShell Expand-Archive directly — it's reliably
      // present on every Windows runner. Git's MSYS tar interprets `C:\…`
      // paths as remote hosts and fails ("Cannot connect to C: resolve
      // failed"), and `unzip` isn't on PATH on windows-latest.
      execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${stage}" -Force`
        ],
        { stdio: 'inherit' }
      )
    }

    await mkdir(dirname(targetDir), { recursive: true })
    await rm(targetDir, { recursive: true, force: true })
    // cp handles cross-filesystem moves where rename gets EXDEV.
    await cp(join(stage, urlFolder), targetDir, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true
    })

    // Hard-fail if the binary we promised isn't actually there. Silent
    // mismatch (e.g. wrong layout from extractor) would propagate into
    // electron-builder, which only logs a warning when extraResources
    // can't find a source dir — exactly how v0.1.3 shipped without node.
    const finalBin = targetBinPath(targetDir, platform)
    if (!existsSync(finalBin)) {
      throw new Error(
        `[node] expected binary missing after extraction: ${finalBin}. ` +
          `Stage: ${stage}. Archive layout may have changed.`
      )
    }
    console.log(`[node] installed ${target} at ${targetDir}`)
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

const targets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [detectHostTarget()]
const version = resolveNodeVersion()
console.log(`[node] target version: ${version}`)
for (const target of targets) await downloadOne(target, version)
