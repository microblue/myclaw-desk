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

function normalizePlatform(p) {
  if (p === 'darwin') return 'darwin'
  if (p === 'win32') return 'win'
  if (p === 'linux') return 'linux'
  throw new Error(`Unsupported platform: ${p}`)
}

function normalizeArch(a) {
  if (a === 'x64' || a === 'arm64') return a
  throw new Error(`Unsupported arch: ${a}`)
}

function detectHostTarget() {
  return `${normalizePlatform(process.platform)}-${normalizeArch(process.arch)}`
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
  return platform === 'win' ? join(targetDir, 'node.exe') : join(targetDir, 'bin', 'node')
}

async function downloadOne(target, version) {
  const [platform, arch] = target.split('-')
  if (!platform || !arch) throw new Error(`Invalid target: ${target}`)

  const targetDir = join(RESOURCES_DIR, target)
  if (existsSync(targetBinPath(targetDir, platform))) {
    console.log(`[node] ${target} v${version} already present, skipping`)
    return
  }

  const ext = platform === 'win' ? 'zip' : 'tar.xz'
  const folder = `node-v${version}-${platform}-${arch}`
  const url = `https://nodejs.org/dist/v${version}/${folder}.${ext}`
  console.log(`[node] downloading ${url}`)

  const stage = join(tmpdir(), `myclaw-node-${process.pid}-${target}`)
  mkdirSync(stage, { recursive: true })
  try {
    const archivePath = join(stage, `${folder}.${ext}`)
    execFileSync('curl', ['-fsSL', '-o', archivePath, url], { stdio: 'inherit' })

    if (ext === 'tar.xz') {
      execFileSync('tar', ['-xJf', archivePath, '-C', stage], { stdio: 'inherit' })
    } else {
      execFileSync('unzip', ['-q', archivePath, '-d', stage], { stdio: 'inherit' })
    }

    await mkdir(dirname(targetDir), { recursive: true })
    await rm(targetDir, { recursive: true, force: true })
    // cp handles cross-filesystem moves where rename gets EXDEV.
    await cp(join(stage, folder), targetDir, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true
    })
    console.log(`[node] installed ${target} at ${targetDir}`)
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

const targets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [detectHostTarget()]
const version = resolveNodeVersion()
console.log(`[node] target version: ${version}`)
for (const target of targets) await downloadOne(target, version)
