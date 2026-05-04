import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

export interface OpenclawPaths {
  /** Root we manage on the user's machine, under userData. */
  home: string
  /** Where `npm install --prefix <runtime> openclaw` puts node_modules/. */
  runtime: string
  /** Path to the bundled `node` binary (or system fallback in dev). */
  nodeBin: string
  /** Path to the bundled npm-cli.js (or empty string in dev → use system npm). */
  npmCli: string
  /** Resolved openclaw CLI: env override → installed runtime → empty. */
  openclawBin: string
  /** Marker file written after a successful install. */
  installMarker: string
  /** TCP port the gateway should listen on. */
  gatewayPort: number
  /** ws://127.0.0.1:<gatewayPort> */
  gatewayUrl: string
  /** OPENCLAW_STATE_DIR (env override else ~/.openclaw). */
  stateDir: string
}

const isWin = process.platform === 'win32'

function bundledNodeRoot(): string {
  return join(process.resourcesPath, 'node')
}

function resolveBundledNode(): { node: string; npm: string } | null {
  const root = bundledNodeRoot()
  if (!existsSync(root)) return null
  if (isWin) {
    return {
      node: join(root, 'node.exe'),
      npm: join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    }
  }
  return {
    node: join(root, 'bin', 'node'),
    npm: join(root, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  }
}

function resolveSystemNode(): { node: string; npm: string } {
  // Dev fallback: use whatever `node` resolves on PATH. Empty npmCli means
  // the bootstrap installer will spawn `npm` directly instead of `node npm-cli.js`.
  const node = process.env.MYCLAW_DESK_NODE || 'node'
  const npm = process.env.MYCLAW_DESK_NPM_CLI || ''
  return { node, npm }
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

function resolveOpenclawBin(runtime: string): string {
  // Test/dev override — point at any existing openclaw CLI on the host. Lets
  // e2e tests skip the slow npm install step and use a pre-installed copy.
  if (process.env.MYCLAW_DESK_OPENCLAW_BIN) {
    return process.env.MYCLAW_DESK_OPENCLAW_BIN
  }
  // Standard layout after `npm install --prefix runtime openclaw`.
  return join(runtime, 'node_modules', '.bin', isWin ? 'openclaw.cmd' : 'openclaw')
}

let cached: OpenclawPaths | null = null

export function getPaths(): OpenclawPaths {
  if (cached) return cached
  const home = join(app.getPath('userData'), 'openclaw')
  const runtime = join(home, 'runtime')
  const bundled = resolveBundledNode()
  const { node, npm } = bundled ?? resolveSystemNode()
  const gatewayPort = resolveGatewayPort()
  cached = {
    home,
    runtime,
    nodeBin: node,
    npmCli: npm,
    openclawBin: resolveOpenclawBin(runtime),
    installMarker: join(runtime, '.installed'),
    gatewayPort,
    gatewayUrl: `ws://127.0.0.1:${gatewayPort}`,
    stateDir: resolveStateDir()
  }
  if (is.dev && !bundled) {
    // eslint-disable-next-line no-console
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
