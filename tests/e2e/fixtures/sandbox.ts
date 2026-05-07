import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const FAKE_OPENCLAW_BIN = join(__dirname, 'fake-openclaw', 'openclaw')

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

export interface SandboxOptions {
  /**
   * If true, skip the fake-openclaw override so the bootstrap actually does
   * `npm install openclaw@<pinned>` and starts the real gateway + Studio.
   * Used by the full-stack CI smoke (tests/e2e/04-real-bootstrap.spec.ts).
   */
  realOpenclaw?: boolean
}

/**
 * Create an isolated sandbox under /tmp/myclaw-test-XXXXXX/. Each call returns
 * a fresh directory and a fresh gateway port (incremented), so multiple test
 * files running serially don't collide.
 */
export function createSandbox(opts: SandboxOptions = {}): Sandbox {
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
    MYCLAW_DESK_DAEMON_MODE: 'managed', // never touch the host's systemd
    // Disable crash reporting from CI/dev sandboxes — we don't want test
    // failures filling the production reports table.
    MYCLAW_DESK_DISABLE_REPORTS: '1'
  }
  if (!opts.realOpenclaw) {
    // Default: point at the fake openclaw bin so tests don't depend on host
    // having real openclaw installed (and don't trigger our slow npm install
    // path). The full-stack spec opts out of this.
    env.MYCLAW_DESK_OPENCLAW_BIN = FAKE_OPENCLAW_BIN
    // Studio's prod-grade ready timeout (3 min) is unrelated to fake-gateway
    // tests — and a real `next dev` started against the dev studio dir
    // outlives the test, hanging afterAll. Cap it so studio.start fails fast
    // in fake mode and the test can clean up.
    env.MYCLAW_DESK_STUDIO_TIMEOUT_MS = '3000'
  }

  let cleaned = false
  const cleanup = (): void => {
    if (cleaned) return
    cleaned = true
    rmSync(root, { recursive: true, force: true })
  }

  return { root, userData, openclawState, gatewayPort, env, cleanup }
}
