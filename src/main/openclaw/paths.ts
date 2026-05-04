import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

export interface OpenclawPaths {
  /** Root directory we manage on the user's machine. */
  home: string
  /** Where the bundled npm-installed openclaw package and its deps live. */
  runtime: string
  /** Path to the bundled `node` binary (or system fallback in dev). */
  nodeBin: string
  /** Path to the bundled `npm` cli script (or system fallback in dev). */
  npmCli: string
  /** Path to the openclaw CLI shim once installed. */
  openclawBin: string
  /** Marker file written after a successful install. */
  installMarker: string
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
  // Dev fallback: use whatever `node` resolves on PATH. The renderer's bootstrap
  // step will surface a clear error if it isn't 22.14+ or 24.x.
  const node = process.env.MYCLAW_DESK_NODE || 'node'
  const npm = process.env.MYCLAW_DESK_NPM_CLI || ''
  return { node, npm }
}

let cached: OpenclawPaths | null = null

export function getPaths(): OpenclawPaths {
  if (cached) return cached
  const home = join(app.getPath('userData'), 'openclaw')
  const runtime = join(home, 'runtime')
  const bundled = resolveBundledNode()
  const fromBundle = bundled !== null
  const { node, npm } = bundled ?? resolveSystemNode()
  const openclawBin = join(
    runtime,
    isWin ? 'openclaw.cmd' : join('bin', 'openclaw')
  )
  cached = {
    home,
    runtime,
    nodeBin: node,
    npmCli: npm,
    openclawBin,
    installMarker: join(runtime, '.installed')
  }
  if (is.dev && !fromBundle) {
    // eslint-disable-next-line no-console
    console.warn(
      '[openclaw/paths] Using system node — bundled runtime not found at',
      bundledNodeRoot()
    )
  }
  return cached
}
