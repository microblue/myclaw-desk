#!/usr/bin/env node
// Build the embedded Studio for production and stage it under dist-studio/
// for electron-builder to consume.
//
// Why a separate dir? studio/node_modules has both runtime and dev deps; we
// want only runtime in the shipped app. Approach:
//   1. Copy studio source files (no node_modules, no .next) to dist-studio/
//   2. `npm ci --omit=dev` in dist-studio/ (production-only deps)
//   3. `npm run build` in dist-studio/ (next build → .next/)
//   4. Rebuild better-sqlite3 against the bundled Node 24 ABI so it loads on
//      the user's machine without runtime recompile.
//
// Re-runs are clean: dist-studio/ is wiped first.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm, cp, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const STUDIO_SRC = join(ROOT, 'studio')
const DIST = join(ROOT, 'dist-studio')

const BUNDLED_NODE_DIR = join(
  ROOT,
  'resources',
  'node',
  `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`
)
const BUNDLED_NODE = process.platform === 'win32'
  ? join(BUNDLED_NODE_DIR, 'node.exe')
  : join(BUNDLED_NODE_DIR, 'bin', 'node')
const BUNDLED_NPM_CLI = process.platform === 'win32'
  ? join(BUNDLED_NODE_DIR, 'node_modules', 'npm', 'bin', 'npm-cli.js')
  : join(BUNDLED_NODE_DIR, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')

if (!existsSync(BUNDLED_NODE)) {
  console.error(`[build-studio] bundled Node not found at ${BUNDLED_NODE}`)
  console.error('[build-studio] run: node scripts/download-node.mjs')
  process.exit(1)
}

const SOURCE_FILTER = (src) => {
  // Skip these so cp doesn't copy a half-gigabyte of dev artifacts. node_modules
  // gets re-installed in dist-studio/, and .next gets rebuilt by `next build`.
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
console.log('[build-studio] (1/3) staging source → dist-studio/')
await rm(DIST, { recursive: true, force: true })
await mkdir(DIST, { recursive: true })
await cp(STUDIO_SRC, DIST, {
  recursive: true,
  filter: SOURCE_FILTER,
  preserveTimestamps: true
})

// Tell better-sqlite3's prebuild-install to fetch the prebuilt for the bundled
// Node ABI, not the host Node ABI. Without this we get a NODE_MODULE_VERSION
// mismatch when the packaged app (Node 24) loads a binary built for the
// install-time Node.
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
const runNpm = (...args) =>
  execFileSync(BUNDLED_NODE, [BUNDLED_NPM_CLI, ...args], {
    cwd: DIST,
    stdio: 'inherit',
    env: npmEnv
  })

// We need devDeps (postcss, tailwind, typescript, etc.) at build time even
// though we don't ship them — Tailwind v4 + Next.js compile through them.
// Order: full install → build → prune to ship-only.
console.log('[build-studio] (2/4) installing all deps (npm ci)…')
runNpm('ci', '--no-audit', '--no-fund')

console.log('[build-studio] (3/4) running next build…')
runNpm('run', 'build')

console.log('[build-studio] (4/5) pruning dev deps…')
runNpm('prune', '--omit=dev')

console.log(`[build-studio] (5/5) rebuilding native modules against bundled Node ${bundledNodeVersion}…`)
runNpm('rebuild', 'better-sqlite3', '--update-binary')

console.log(`[build-studio] done — dist-studio/ ready (${DIST})`)
