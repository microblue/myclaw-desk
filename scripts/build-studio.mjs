#!/usr/bin/env node
// Build the embedded Studio for production and stage it under dist-studio/
// for electron-builder to consume.
//
// Why a separate dir? studio/node_modules has both runtime and dev deps; we
// want only runtime in the shipped app. Approach:
//   1. Copy studio source files (no node_modules, no .next) to dist-studio/
//   2. `npm ci` in dist-studio/ (need devDeps to run `next build`)
//   3. `npm run build` in dist-studio/ — with output:'standalone', Next
//      emits a self-contained .next/standalone/ tree containing server.js,
//      a traced node_modules/ subset, and a re-rooted .next/.
//   4. Copy .next/static + public into the standalone tree (per Next docs;
//      build-time output excludes them on purpose since CDNs typically
//      serve those, but Electron has no CDN).
//   5. Rebuild better-sqlite3 in the standalone's node_modules against the
//      bundled Node 24 ABI so it loads on the user's machine without
//      runtime recompile.
//   6. Replace dist-studio/ contents with the standalone tree + rename
//      node_modules → vendor_modules.
//
// Re-runs are clean: dist-studio/ is wiped first.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm, cp, mkdir, rename, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const STUDIO_SRC = join(ROOT, 'studio')
const DIST = join(ROOT, 'dist-studio')

const BUNDLED_NODE_DIR = join(ROOT, 'resources', 'node', `${process.platform}-${process.arch}`)
const BUNDLED_NODE =
  process.platform === 'win32'
    ? join(BUNDLED_NODE_DIR, 'node.exe')
    : join(BUNDLED_NODE_DIR, 'bin', 'node')
const BUNDLED_NPM_CLI =
  process.platform === 'win32'
    ? join(BUNDLED_NODE_DIR, 'vendor_modules', 'npm', 'bin', 'npm-cli.js')
    : join(BUNDLED_NODE_DIR, 'lib', 'vendor_modules', 'npm', 'bin', 'npm-cli.js')

if (!existsSync(BUNDLED_NODE)) {
  console.error(`[build-studio] bundled Node not found at ${BUNDLED_NODE}`)
  console.error('[build-studio] run: node scripts/download-node.mjs')
  process.exit(1)
}

const SOURCE_FILTER = (src) => {
  // Skip these so cp doesn't copy a half-gigabyte of dev artifacts.
  // node_modules gets re-installed in dist-studio/, .next gets rebuilt by
  // `next build`.
  const rel = src.slice(STUDIO_SRC.length)
  if (rel === '/node_modules' || rel.startsWith('/node_modules/')) return false
  if (rel === '/.next' || rel.startsWith('/.next/')) return false
  if (rel === '/.git' || rel.startsWith('/.git/')) return false
  if (rel === '/test-results' || rel.startsWith('/test-results/')) return false
  if (rel === '/playwright-report' || rel.startsWith('/playwright-report/')) return false
  if (rel === '/.tmp-vitest' || rel.startsWith('/.tmp-vitest/')) return false
  return true
}

console.log(`[build-studio] using bundled node: ${BUNDLED_NODE}`)
console.log('[build-studio] (1/8) staging source → dist-studio/')
await rm(DIST, { recursive: true, force: true })
await mkdir(DIST, { recursive: true })
await cp(STUDIO_SRC, DIST, {
  recursive: true,
  filter: SOURCE_FILTER,
  preserveTimestamps: true
})

const bundledNodeVersion = execFileSync(BUNDLED_NODE, ['-p', 'process.version'], {
  encoding: 'utf8'
})
  .trim()
  .replace(/^v/, '')

const npmEnv = {
  ...process.env,
  npm_config_target: bundledNodeVersion,
  npm_config_runtime: 'node',
  npm_config_target_arch: process.arch,
  npm_config_target_platform: process.platform === 'win32' ? 'win32' : process.platform,
  npm_config_yes: 'true'
}
const runNpmIn = (cwd, ...args) =>
  execFileSync(BUNDLED_NODE, [BUNDLED_NPM_CLI, ...args], { cwd, stdio: 'inherit', env: npmEnv })

console.log('[build-studio] (2/8) installing all deps (npm ci)…')
runNpmIn(DIST, 'ci', '--no-audit', '--no-fund')

console.log('[build-studio] (3/8) running next build (output: standalone)…')
runNpmIn(DIST, 'run', 'build')

const STANDALONE_ROOT = join(DIST, '.next', 'standalone')
if (!existsSync(STANDALONE_ROOT)) {
  console.error(
    `[build-studio] expected standalone tree at ${STANDALONE_ROOT} — did studio/next.config.js opt out of output:'standalone'?`
  )
  process.exit(1)
}

// Belt-and-suspenders for the monorepo trace gotcha: even with
// outputFileTracingRoot pinned in next.config.js, if anything ever drifts
// (a stray pnpm-workspace.yaml at the repo root, a future Next version
// changing defaults), standalone might still nest under the workspace
// path. Walk down until we find the dir that actually contains server.js
// — that's our real standalone root.
const STANDALONE = await (async () => {
  let cur = STANDALONE_ROOT
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(cur, 'server.js'))) return cur
    const entries = await readdir(cur, { withFileTypes: true })
    const dirs = entries.filter((e) => e.isDirectory())
    if (dirs.length === 1) {
      cur = join(cur, dirs[0].name)
      continue
    }
    break
  }
  return cur
})()
if (STANDALONE !== STANDALONE_ROOT) {
  console.log(`[build-studio] standalone server.js is at ${STANDALONE} (descended from root)`)
}
if (!existsSync(join(STANDALONE, 'server.js'))) {
  console.error(`[build-studio] no server.js found under ${STANDALONE_ROOT} — standalone build malformed`)
  process.exit(1)
}

console.log('[build-studio] (4/8) copying .next/static + public into standalone tree')
const STATIC_SRC = join(DIST, '.next', 'static')
const STATIC_DST = join(STANDALONE, '.next', 'static')
const PUBLIC_SRC = join(DIST, 'public')
const PUBLIC_DST = join(STANDALONE, 'public')
if (existsSync(STATIC_SRC)) await cp(STATIC_SRC, STATIC_DST, { recursive: true, dereference: true })
if (existsSync(PUBLIC_SRC)) await cp(PUBLIC_SRC, PUBLIC_DST, { recursive: true, dereference: true })

// Native + serverExternalPackages: Next standalone TRACES dependencies but
// our `serverExternalPackages: ["ws", "better-sqlite3"]` config tells Next
// NOT to inline these into the bundle — Next assumes they'll be available
// at runtime, but doesn't itself put them into standalone/node_modules.
// Copy them in from the full install in DIST/node_modules. Then rebuild
// better-sqlite3 against the bundled Node ABI.
const STANDALONE_NM = join(STANDALONE, 'node_modules')
await mkdir(STANDALONE_NM, { recursive: true })
const EXTERNAL_PKGS = ['ws', 'better-sqlite3']
console.log(`[build-studio] (5/8) backfilling external pkgs into standalone: ${EXTERNAL_PKGS.join(', ')}`)
for (const name of EXTERNAL_PKGS) {
  const src = join(DIST, 'node_modules', name)
  const dst = join(STANDALONE_NM, name)
  if (!existsSync(src)) {
    console.warn(`[build-studio] WARN: ${name} not in DIST/node_modules — Studio runtime may fail`)
    continue
  }
  if (existsSync(dst)) await rm(dst, { recursive: true, force: true })
  await cp(src, dst, { recursive: true, dereference: true })
}
if (existsSync(join(STANDALONE_NM, 'better-sqlite3'))) {
  console.log(
    `[build-studio]      rebuilding better-sqlite3 against bundled Node ${bundledNodeVersion}…`
  )
  runNpmIn(STANDALONE, 'rebuild', 'better-sqlite3', '--update-binary')
}

// Next 16's Turbopack writes hashed-name packages under
// .next/server/node_modules/ (e.g. ws-24bb32dcb9424f99). With standalone,
// these are inlined into the standalone server bundle and don't need
// special handling — the trace already covered them.

console.log('[build-studio] (6/8) flattening standalone → dist-studio root')
// Move standalone tree out, wipe dist-studio, move it back in. Stage on
// the *same filesystem* as DIST (workspace) so rename() doesn't EXDEV on
// Windows, where tmpdir() is C:\ but the workspace is D:\.
const STAGE = join(ROOT, '.dist-studio-stage')
await rm(STAGE, { recursive: true, force: true })
await mkdir(STAGE, { recursive: true })
try {
  for (const entry of await readdir(STANDALONE)) {
    await rename(join(STANDALONE, entry), join(STAGE, entry))
  }
  await rm(DIST, { recursive: true, force: true })
  await mkdir(DIST, { recursive: true })
  for (const entry of await readdir(STAGE)) {
    await rename(join(STAGE, entry), join(DIST, entry))
  }
} finally {
  await rm(STAGE, { recursive: true, force: true })
}

// Strip dev cruft (.mts, .cts, .map, sourcemaps, etc.) from the now-flat
// node_modules tree.
console.log('[build-studio] (7/8) pruning dev cruft from node_modules')
const NM = join(DIST, 'node_modules')
execFileSync(BUNDLED_NODE, [join(ROOT, 'scripts', 'prune-bundle.mjs'), NM], { stdio: 'inherit' })

// electron-builder's extraResources strips anything literally named
// `node_modules` even with `filter: ['**/*']`, exactly like it does for
// the bundled-Node tree. Rename to `vendor_modules` here;
// main/studio/process.ts sets NODE_PATH to that dir at spawn time + makes
// a node_modules→vendor_modules junction post-install for ESM resolution.
console.log('[build-studio] (8/8) renaming node_modules → vendor_modules')
const VM = join(DIST, 'vendor_modules')
if (existsSync(NM)) {
  await rm(VM, { recursive: true, force: true })
  await rename(NM, VM)
}

console.log(`[build-studio] done — dist-studio/ ready (${DIST})`)
