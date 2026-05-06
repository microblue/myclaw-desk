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

function locate7z() {
  // windows-latest preinstalls 7-Zip but doesn't always have its dir on the
  // bash PATH that node sees — fall back to the canonical install path.
  const candidates = [process.env.MYCLAW_DESK_7Z, '7z', 'C:\\Program Files\\7-Zip\\7z.exe'].filter(
    Boolean
  )
  for (const c of candidates) {
    try {
      execFileSync(c, ['--help'], { stdio: 'ignore' })
      return c
    } catch {
      // try next
    }
  }
  throw new Error('7z not found — install 7-Zip or set MYCLAW_DESK_7Z')
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
  // On Windows we fetch the .7z because npm's nested deps include paths
  // longer than MAX_PATH (260 chars). PowerShell's Expand-Archive silently
  // skips those — exactly how v0.1.4 shipped node.exe alone with no
  // node_modules/npm/. 7z handles long paths reliably and is preinstalled
  // on the windows-latest runner.
  const ext = platform === 'win32' ? '7z' : 'tar.xz'
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
      // Windows .7z. Try `7z` on PATH first; fall back to the well-known
      // install path on the GitHub-hosted runner.
      const sevenZip = locate7z()
      execFileSync(sevenZip, ['x', `-o${stage}`, '-y', archivePath], {
        stdio: 'inherit'
      })
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
    // Also verify npm-cli.js made it through. Long-path issues during
    // extraction historically dropped node_modules/ silently; assert the
    // CLI entrypoint is present so prepack fails loudly instead of
    // shipping a half-bundle.
    const npmCliRel =
      platform === 'win32'
        ? join('node_modules', 'npm', 'bin', 'npm-cli.js')
        : join('lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
    const npmCli = join(targetDir, npmCliRel)
    if (!existsSync(npmCli)) {
      throw new Error(
        `[node] expected npm-cli.js missing after extraction: ${npmCli}. ` +
          `Long-path or extraction layout issue — half-bundle would ship.`
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
