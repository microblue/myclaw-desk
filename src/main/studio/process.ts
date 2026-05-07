import { spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import * as net from 'net'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { getPaths } from '../openclaw/paths'
import { installLogger } from '../installLogger'
import type { StudioState } from '../../shared/studio'

// First-run on Windows can take a while: Next.js cold-compiles on the
// first request, Defender real-time-scans every node_modules file the
// server touches, and better-sqlite3 may init the SQLite db. 60s was not
// enough on at least one user's machine — the splash kept spinning past
// the test timeout. 3 min covers slow paths without making genuinely
// stuck failure modes intolerable. Overridable via env so test sandboxes
// can fail fast without inheriting the prod-grade timeout.
const READY_TIMEOUT_MS = (() => {
  const env = process.env.MYCLAW_DESK_STUDIO_TIMEOUT_MS
  if (env) {
    const n = Number.parseInt(env, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 180_000
})()

function resolveStudioDir(): string {
  if (process.env.MYCLAW_DESK_STUDIO_DIR) return process.env.MYCLAW_DESK_STUDIO_DIR
  // Dev: studio/ is at the repo root, two levels up from out/main/index.js.
  // Prod: electron-builder unpacks `dist-studio/` to <resourcesPath>/studio/.
  // We can't import { is } here without circulars; check process.resourcesPath
  // and prefer it if it actually contains studio (i.e., we're packaged).
  const packaged = join(process.resourcesPath, 'studio')
  if (existsSync(join(packaged, 'server', 'index.js'))) return packaged
  return join(__dirname, '..', '..', 'studio')
}

class StudioProcess extends EventEmitter {
  private state: StudioState = { phase: 'idle' }
  private child: ChildProcess | null = null
  private startInflight: Promise<StudioState> | null = null

  getState(): StudioState {
    return this.state
  }

  async start(): Promise<StudioState> {
    if (this.state.phase === 'ready' && this.state.url) return this.state
    if (this.startInflight) return this.startInflight
    this.startInflight = this.runStart().finally(() => {
      this.startInflight = null
    })
    return this.startInflight
  }

  stop(): void {
    const c = this.child
    if (c) {
      // Detach piped stdio so the parent's event loop isn't held alive by the
      // child's pipes — without this Electron hangs on quit.
      c.stdout?.destroy()
      c.stderr?.destroy()
      if (c.exitCode === null) {
        c.kill('SIGTERM')
        setTimeout(() => {
          if (c.exitCode === null) c.kill('SIGKILL')
        }, 1_500)
      }
    }
    this.child = null
    this.update({ phase: 'stopped', url: undefined })
  }

  private async runStart(): Promise<StudioState> {
    try {
      this.update({ phase: 'starting', message: 'Starting OpenClaw Studio…', error: undefined })

      const studioDir = resolveStudioDir()
      const serverEntry = join(studioDir, 'server', 'index.js')
      if (!existsSync(serverEntry)) {
        throw new Error(`Studio server not found at ${serverEntry}`)
      }

      const port = await getFreePort()
      // Initial URL guess; Next.js prints the actual bound URL as "Open in
      // browser: http://…" — we capture that line in waitForReady and use
      // it instead of this guess. Avoids mismatches when Next binds to
      // localhost (IPv6 ::1 sometimes) but our loadURL goes to 127.0.0.1.
      const url = `http://127.0.0.1:${port}`
      const node = getPaths().nodeBin

      // Prefer prod mode if a Next build exists; fall back to --dev otherwise.
      // Lets us ship a prebuilt Studio in production and still iterate on raw
      // checkouts in development without a manual `next build` step.
      const hasProdBuild = existsSync(join(studioDir, '.next', 'BUILD_ID'))
      const args = hasProdBuild ? ['server/index.js'] : ['server/index.js', '--dev']

      // Dev mode leaves `.next/dev/lock` behind on crash/force-quit, blocking
      // the next launch with "is another next dev running?". We're a single
      // Electron instance per user, so it's safe to clear it pre-spawn.
      if (!hasProdBuild) {
        try {
          rmSync(join(studioDir, '.next', 'dev', 'lock'), { force: true })
        } catch {
          // best-effort
        }
      }

      // Studio's deps (notably `next`) live under <studioDir>/vendor_modules
      // because electron-builder's extraResources strips anything named
      // `node_modules`. Tell Node to search there too — works in both prod
      // (where vendor_modules is the only place) and dev (where node_modules
      // is the canonical spot, vendor_modules may not exist).
      const vendorModules = join(studioDir, 'vendor_modules')
      const existingNodePath = process.env.NODE_PATH ?? ''
      const sep = process.platform === 'win32' ? ';' : ':'
      const nodePath = [vendorModules, existingNodePath].filter(Boolean).join(sep)

      const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        PORT: String(port),
        HOSTNAME: '127.0.0.1',
        NODE_ENV: hasProdBuild ? 'production' : 'development',
        NODE_PATH: nodePath
      }
      // Sandbox: when a test sets MYCLAW_DESK_GATEWAY_PORT, point Studio at
      // that gateway instead of the default 18789. OPENCLAW_STATE_DIR is
      // already inherited from process.env above and is what isolates Studio's
      // settings.json + runtime.db onto the sandbox path.
      const sandboxPort = process.env.MYCLAW_DESK_GATEWAY_PORT
      if (sandboxPort && !process.env.NEXT_PUBLIC_GATEWAY_URL) {
        childEnv.NEXT_PUBLIC_GATEWAY_URL = `ws://127.0.0.1:${sandboxPort}`
      }

      const child = spawn(node, args, {
        cwd: studioDir,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      child.unref()
      this.child = child

      child.once('exit', (code, signal) => {
        const wasReady = this.state.phase === 'ready'
        this.child = null
        if (wasReady) {
          this.update({
            phase: 'error',
            url: undefined,
            error: `Studio exited (code=${code}, signal=${signal})`
          })
        }
      })

      const observedUrl = await this.waitForReady(child, url)
      this.update({ phase: 'ready', url: observedUrl ?? url, message: 'Studio is running.' })
      return this.state
    } catch (err) {
      if (this.child && this.child.exitCode === null) this.child.kill('SIGTERM')
      this.child = null
      const message = err instanceof Error ? err.message : String(err)
      this.update({ phase: 'error', error: message })
      return this.state
    }
  }

  /**
   * Resolve to the URL Studio actually printed (preferred, may differ from
   * our hostname/port guess on IPv6/dual-stack), or undefined if we matched
   * via a fallback signal. Reject on timeout / process exit / spawn error.
   */
  private waitForReady(child: ChildProcess, url: string): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        reject(new Error(`Studio did not signal ready within ${READY_TIMEOUT_MS / 1000}s`))
      }, READY_TIMEOUT_MS)

      const onLine = (chunk: Buffer): void => {
        const text = chunk.toString('utf8')
        for (const raw of text.split(/\r?\n/)) {
          const line = raw.trim()
          if (line) installLogger.log({ source: 'studio', text: line })
        }
        const lastLine = text.split(/\r?\n/).filter(Boolean).pop()
        if (lastLine) this.update({ logTail: lastLine })
        if (settled) return
        // Match Studio's "Open in browser:" line and capture the URL it
        // printed. Falls back to substring match against our guessed URL,
        // then to "Ready in" / "Local: …" patterns Next 15+ uses.
        const m =
          text.match(/Open in browser:\s*(https?:\/\/\S+)/i) ??
          text.match(/(?:Local|URL):\s*(https?:\/\/\S+)/i) ??
          text.match(/(https?:\/\/(?:127\.0\.0\.1|localhost):\d+)/i)
        if (m || text.includes(url) || /\bReady\b\s*(?:in|on)/i.test(text)) {
          settled = true
          cleanup()
          resolve(m?.[1])
        }
      }
      child.stdout?.on('data', onLine)
      child.stderr?.on('data', onLine)

      child.once('error', (e) => {
        if (settled) return
        settled = true
        cleanup()
        reject(e)
      })
      child.once('exit', (code) => {
        if (settled) return
        settled = true
        cleanup()
        reject(new Error(`Studio exited before ready (code=${code})`))
      })

      const cleanup = (): void => {
        clearTimeout(timer)
        // We intentionally keep the data listeners attached so logTail
        // continues to update after we resolve, until the child exits.
      }
    })
  }

  private update(patch: Partial<StudioState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.state)
  }
}

async function getFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const port = addr.port
        srv.close(() => resolve(port))
      } else {
        reject(new Error('Failed to allocate ephemeral port'))
      }
    })
  })
}

export const studio = new StudioProcess()
