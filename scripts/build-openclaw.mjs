#!/usr/bin/env node
// Pre-install openclaw@<pinned> at desktop build time so the desktop ships
// with a complete, known-good copy of the runtime instead of asking the
// user's machine to npm-install on first launch.
//
// This eliminates the entire 'install on user machine' failure surface:
// PATH not having node, lifecycle scripts blowing up, npm registry hiccups,
// long-path issues on Windows, Defender slowing the install to multi-minute,
// proxy/firewall blocking registry.npmjs.org, etc.
//
// Layout produced under dist-openclaw/:
//   package.json (minimal)
//   vendor_modules/openclaw/...     ← the actual openclaw package
//   vendor_modules/<deps>/...
//
// node_modules → vendor_modules rename is the same dance we apply to the
// bundled Node tree and to dist-studio/: electron-builder's extraResources
// step strips anything literally named `node_modules`, even with explicit
// filter overrides. Renaming sidesteps the strip; src/main/openclaw/paths.ts
// resolves the bundled CLI through the vendor_modules path.
//
// Re-runs are clean: dist-openclaw/ is wiped first.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { rm, mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const DIST = join(ROOT, 'dist-openclaw')

// Pull the pinned version from src/shared/bootstrap.ts so we never drift
// between what we install at build time and what we tell users we shipped.
function readPinnedVersion() {
  const src = readFileSync(join(ROOT, 'src', 'shared', 'bootstrap.ts'), 'utf8')
  const m = src.match(/OPENCLAW_VERSION\s*=\s*'([^']+)'/)
  if (!m) throw new Error('Could not parse OPENCLAW_VERSION from src/shared/bootstrap.ts')
  return m[1]
}

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
  console.error(`[build-openclaw] bundled Node not found at ${BUNDLED_NODE}`)
  console.error('[build-openclaw] run: node scripts/download-node.mjs')
  process.exit(1)
}
if (!existsSync(BUNDLED_NPM_CLI)) {
  console.error(`[build-openclaw] bundled npm-cli.js not found at ${BUNDLED_NPM_CLI}`)
  process.exit(1)
}

const VERSION = readPinnedVersion()
console.log(`[build-openclaw] target openclaw@${VERSION}`)

console.log('[build-openclaw] (1/3) staging dist-openclaw/')
await rm(DIST, { recursive: true, force: true })
await mkdir(DIST, { recursive: true })
// Minimal package.json so npm has somewhere to write node_modules. We use
// explicit dependency rather than `npm install <pkg>` to keep the lockfile
// reproducible.
await writeFile(
  join(DIST, 'package.json'),
  JSON.stringify(
    {
      name: 'myclaw-desk-openclaw-bundle',
      version: '0.0.0',
      private: true,
      dependencies: { openclaw: VERSION }
    },
    null,
    2
  ) + '\n',
  'utf8'
)

// Inject bundled node onto PATH for the install — openclaw's preinstall
// lifecycle script does `cmd.exe /c node …` on Windows and would otherwise
// ENOENT on a clean machine. Same fix we apply at user-runtime install
// (when we still had dynamic install).
const pathSep = process.platform === 'win32' ? ';' : ':'
const pathKey =
  process.platform === 'win32'
    ? Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'Path'
    : 'PATH'
const installEnv = {
  ...process.env,
  [pathKey]: `${dirname(BUNDLED_NODE)}${pathSep}${process.env[pathKey] ?? ''}`,
  npm_node_execpath: BUNDLED_NODE,
  npm_config_yes: 'true'
}

console.log(`[build-openclaw] (2/3) npm install openclaw@${VERSION} (this takes ~30s)`)
execFileSync(
  BUNDLED_NODE,
  [BUNDLED_NPM_CLI, 'install', '--no-audit', '--no-fund', '--omit=dev'],
  { cwd: DIST, stdio: 'inherit', env: installEnv }
)

console.log('[build-openclaw] (3/3) renaming node_modules → vendor_modules')
const NM = join(DIST, 'node_modules')
const VM = join(DIST, 'vendor_modules')
if (existsSync(NM)) {
  await rm(VM, { recursive: true, force: true })
  await rename(NM, VM)
}

if (!existsSync(join(VM, 'openclaw', 'package.json'))) {
  throw new Error(
    `[build-openclaw] expected openclaw package missing at ${VM}/openclaw — install or rename failed`
  )
}

console.log(`[build-openclaw] done — dist-openclaw/ ready (${DIST})`)
