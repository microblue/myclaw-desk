import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export interface Sandbox {
  /** Root tmp dir; cleanup deletes everything beneath this. */
  root: string
  /** Electron userData (replaces ~/.config/MyClaw.One Desktop). */
  userData: string
  /** OPENCLAW_STATE_DIR (replaces ~/.openclaw). */
  openclawState: string
  /** Port the sandboxed openclaw gateway should bind. */
  gatewayPort: number
  /** Env vars to pass to the Electron child to activate the sandbox. */
  env: NodeJS.ProcessEnv
  /** Run from afterAll(). Idempotent. */
  cleanup: () => void
}

let nextPortOffset = 0
const BASE_GATEWAY_PORT = 28789

/**
 * Create an isolated sandbox under /tmp/myclaw-test-XXXXXX/. Each call returns
 * a fresh directory and a fresh gateway port (incremented), so multiple test
 * files running serially don't collide.
 */
export function createSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'myclaw-test-'))
  const userData = join(root, 'userdata')
  const openclawState = join(root, 'openclaw')
  mkdirSync(userData, { recursive: true })
  mkdirSync(openclawState, { recursive: true })

  const gatewayPort = BASE_GATEWAY_PORT + nextPortOffset
  nextPortOffset = (nextPortOffset + 1) % 100

  const env: NodeJS.ProcessEnv = {
    MYCLAW_DESK_USERDATA: userData,
    OPENCLAW_STATE_DIR: openclawState,
    MYCLAW_DESK_GATEWAY_PORT: String(gatewayPort),
    MYCLAW_DESK_DAEMON_MODE: 'managed' // never touch the host's systemd
  }

  let cleaned = false
  const cleanup = (): void => {
    if (cleaned) return
    cleaned = true
    rmSync(root, { recursive: true, force: true })
  }

  return { root, userData, openclawState, gatewayPort, env, cleanup }
}
