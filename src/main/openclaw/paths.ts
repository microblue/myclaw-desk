import { app } from 'electron'
import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { is } from '@electron-toolkit/utils'

export interface OpenclawCommand {
  /**
   * Executable to spawn. For an env override (tests) this is the override
   * binary itself. In prod this is the bundled `node` binary, and
   * `prefixArgs` carries the absolute path to openclaw's JS entry.
   *
   * Why not `runtime/node_modules/.bin/openclaw(.cmd)`? Node's spawn() on
   * Windows can't run `.cmd` shims without `shell: true` — bypassing the
   * shim and calling node + JS file directly works on every platform with
   * identical kill/signal semantics.
   */
  cmd: string
  prefixArgs: string[]
  /** File whose existence proves openclaw is installed. */
  existsAt: string
}

export interface OpenclawPaths {
  /** Root we manage on the user's machine, under userData. */
  home: string
  /** Where `npm install --prefix <runtime> openclaw` puts node_modules/. */
  runtime: string
  /** Path to the bundled `node` binary (or system fallback in dev). */
  nodeBin: string
  /** Path to the bundled npm-cli.js (or empty string in dev → use system npm). */
  npmCli: string
  /** How to spawn the openclaw CLI cross-platform. */
  openclaw: OpenclawCommand
  /** Marker file written after a successful install. */
  installMarker: string
  /**
   * Read-only directory where the desktop installer pre-bundled openclaw
   * (vendor_modules/openclaw/...). Empty when no bundled tree is present
   * (dev / unpacked / forks without prepack:openclaw run). Set this means
   * we can skip runtime npm install entirely.
   */
  bundledOpenclawDir: string
  /** TCP port the gateway should listen on. */
  gatewayPort: number
  /** ws://127.0.0.1:<gatewayPort> */
  gatewayUrl: string
  /** OPENCLAW_STATE_DIR (env override else ~/.openclaw). */
  stateDir: string
}

const isWin = process.platform === 'win32'

// Directory naming uses process.platform verbatim ('win32', not 'win') to
// match electron-builder's ${platform} macro. extraResources silently
// no-ops when from= doesn't exist, so any drift here means the package
// ships without the bundled runtime.
function hostTarget(): string {
  return `${process.platform}-${process.arch}`
}

/**
 * Where the bundled Node 24 runtime lives. Two layouts, same shape:
 *   dev:  <repo>/resources/node/<platform>-<arch>/{bin/node,lib/node_modules/npm/...}
 *   prod: <process.resourcesPath>/node/<platform>-<arch>/{bin/node,...}
 *
 * The latter comes from electron-builder's extraResources (see
 * electron-builder.yml). Run `node scripts/download-node.mjs` to populate
 * the dev location.
 */
function bundledNodeRoot(): string {
  if (is.dev) {
    return join(__dirname, '..', '..', 'resources', 'node', hostTarget())
  }
  return join(process.resourcesPath, 'node', hostTarget())
}

function resolveBundledNode(): { node: string; npm: string } | null {
  // The npm tree lives under `vendor_modules/`, not `node_modules/`.
  // electron-builder's extraResources hard-strips anything named
  // node_modules even with `filter: ['**/*']`; download-node.mjs renames
  // to dodge that filter. See scripts/download-node.mjs for the rename.
  const root = bundledNodeRoot()
  if (!existsSync(root)) return null
  if (isWin) {
    return {
      node: join(root, 'node.exe'),
      npm: join(root, 'vendor_modules', 'npm', 'bin', 'npm-cli.js')
    }
  }
  return {
    node: join(root, 'bin', 'node'),
    npm: join(root, 'lib', 'vendor_modules', 'npm', 'bin', 'npm-cli.js')
  }
}

function resolveSystemNode(): { node: string; npm: string } {
  // Dev fallback: use whatever `node` / `npm` resolve on PATH. We must always
  // produce a real npm-cli.js path because spawning the `npm` shim directly
  // breaks on Windows (Node's spawn() refuses .cmd shims since CVE-2024-27980
  // without `shell: true`). Locate the JS via `where`/`which npm` and read
  // the shim contents to find npm-cli.js's absolute path.
  const node = process.env.MYCLAW_DESK_NODE || 'node'
  let npm = process.env.MYCLAW_DESK_NPM_CLI || ''
  if (!npm) npm = locateSystemNpmCli() ?? ''
  return { node, npm }
}

function locateSystemNpmCli(): string | null {
  try {
    const lookup = isWin ? 'where' : 'which'
    const out = execFileSync(lookup, ['npm'], { encoding: 'utf8' }).trim()
    if (!out) return null
    // `where` may print multiple lines (one per match); take the first.
    const first = out.split(/\r?\n/)[0].trim()
    if (!first) return null
    // The shim sits next to (or in a parent of) node_modules/npm/bin/npm-cli.js.
    // Try the typical official-installer / nvm-windows layout first, then
    // walk up looking for npm/bin/npm-cli.js.
    let dir: string = dirname(first)
    for (let i = 0; i < 4; i++) {
      const candidate = join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
      if (existsSync(candidate)) return candidate
      const candidateLib = join(dir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
      if (existsSync(candidateLib)) return candidateLib
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    return null
  } catch {
    return null
  }
}

function resolveGatewayPort(): number {
  const env = process.env.MYCLAW_DESK_GATEWAY_PORT
  if (env) {
    const p = Number.parseInt(env, 10)
    if (Number.isInteger(p) && p > 0 && p < 65536) return p
  }
  return 18789
}

function resolveStateDir(): string {
  if (process.env.OPENCLAW_STATE_DIR) return process.env.OPENCLAW_STATE_DIR
  return join(app.getPath('home'), '.openclaw')
}

/**
 * Where the bundled openclaw tree lives. dev: <repo>/dist-openclaw/, prod:
 * <process.resourcesPath>/openclaw/. Returns empty string when the
 * directory isn't present (forks / unfinished prepack).
 */
function resolveBundledOpenclawDir(): string {
  const candidates = is.dev
    ? [join(__dirname, '..', '..', 'dist-openclaw')]
    : [join(process.resourcesPath, 'openclaw')]
  for (const c of candidates) {
    if (existsSync(join(c, 'vendor_modules', 'openclaw', 'package.json'))) return c
  }
  return ''
}

function readOpenclawJsBin(openclawPkgDir: string): string | null {
  const pkgPath = join(openclawPkgDir, 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (typeof pkg.bin === 'string') return pkg.bin
    if (pkg.bin && typeof pkg.bin.openclaw === 'string') return pkg.bin.openclaw
  } catch {
    // ignore
  }
  return null
}

function resolveOpenclawCommand(
  runtime: string,
  bundledDir: string,
  nodeBin: string
): OpenclawCommand {
  // Test/dev override — point at any existing openclaw CLI on the host (the
  // e2e fake-openclaw is a Node shebang script). Spawn it directly; tests
  // run on Linux/macOS where shebangs work, and the Windows packaged spec
  // self-skips.
  const env = process.env.MYCLAW_DESK_OPENCLAW_BIN
  if (env) return { cmd: env, prefixArgs: [], existsAt: env }

  // Bundled openclaw shipped with the installer. Preferred path —
  // eliminates the runtime-install failure surface entirely (no npm,
  // no network, no lifecycle scripts on the user's machine).
  if (bundledDir) {
    const pkgDir = join(bundledDir, 'vendor_modules', 'openclaw')
    const jsRel = readOpenclawJsBin(pkgDir)
    if (jsRel) {
      const jsAbs = join(pkgDir, jsRel)
      return { cmd: nodeBin, prefixArgs: [jsAbs], existsAt: jsAbs }
    }
  }

  // Legacy / fallback: the user-runtime install path. Spawning
  // `node <jsPath>` instead of through `node_modules/.bin/openclaw(.cmd)`
  // avoids the Windows .cmd-shim ENOENT trap and works identically on all
  // platforms. Falls back to the unix shim path if package.json isn't
  // there yet (pre-install) — that way `existsSync(existsAt)` still gates
  // the install step correctly.
  const runtimePkgDir = join(runtime, 'node_modules', 'openclaw')
  const jsRel = readOpenclawJsBin(runtimePkgDir)
  if (jsRel) {
    const jsAbs = join(runtimePkgDir, jsRel)
    return { cmd: nodeBin, prefixArgs: [jsAbs], existsAt: jsAbs }
  }
  const shim = join(runtime, 'node_modules', '.bin', isWin ? 'openclaw.cmd' : 'openclaw')
  return { cmd: nodeBin, prefixArgs: [], existsAt: shim }
}

let cached: OpenclawPaths | null = null

export function getPaths(): OpenclawPaths {
  if (cached) return cached
  const home = join(app.getPath('userData'), 'openclaw')
  const runtime = join(home, 'runtime')
  const bundled = resolveBundledNode()
  const { node, npm } = bundled ?? resolveSystemNode()
  const bundledOpenclawDir = resolveBundledOpenclawDir()
  const gatewayPort = resolveGatewayPort()
  cached = {
    home,
    runtime,
    nodeBin: node,
    npmCli: npm,
    openclaw: resolveOpenclawCommand(runtime, bundledOpenclawDir, node),
    installMarker: join(runtime, '.installed'),
    bundledOpenclawDir,
    gatewayPort,
    gatewayUrl: `ws://127.0.0.1:${gatewayPort}`,
    stateDir: resolveStateDir()
  }
  if (is.dev && !bundled) {
    console.warn(
      '[openclaw/paths] Using system node — bundled runtime not found at',
      bundledNodeRoot()
    )
  }
  return cached
}

/** Reset cached paths — only for tests that change env between scenarios. */
export function resetPathsCache(): void {
  cached = null
}
