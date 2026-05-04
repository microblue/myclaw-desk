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

console.log('[build-studio] (2/3) installing prod deps (npm ci --omit=dev)…')
const npmRun = (...args) =>
  execFileSync(BUNDLED_NODE, [BUNDLED_NPM_CLI, ...args], {
    cwd: DIST,
    stdio: 'inherit',
    env: { ...process.env, npm_config_yes: 'true' }
  })

// Tell better-sqlite3's prebuild-install to fetch the prebuilt for our bundled
// Node version, not the host Node.
const npmEnv = {
  ...process.env,
  npm_config_target: process.env.NODE_VERSION || undefined,
  npm_config_runtime: 'node',
  npm_config_target_arch: process.arch,
  npm_config_target_platform: process.platform === 'win32' ? 'win32' : process.platform
}
execFileSync(BUNDLED_NODE, [BUNDLED_NPM_CLI, 'ci', '--omit=dev', '--no-audit', '--no-fund'], {
  cwd: DIST,
  stdio: 'inherit',
  env: npmEnv
})

console.log('[build-studio] (3/3) running next build…')
npmRun('run', 'build')

console.log(`[build-studio] done — dist-studio/ ready (${DIST})`)
