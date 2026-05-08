import { spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import * as net from 'net'
import { existsSync, rmSync, symlinkSync } from 'fs'
import { dirname as pathDirname, join } from 'path'
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

// Studio entry point: in prod we ship Next's `output: 'standalone'` tree
// where the server lives at <studioDir>/server.js; in dev the studio
// source still has its custom server at <studioDir>/server/index.js.
function resolveStudioEntry(studioDir: string): { entry: string; isStandalone: boolean } {
  const standalone = join(studioDir, 'server.js')
  if (existsSync(standalone)) return { entry: standalone, isStandalone: true }
  return { entry: join(studioDir, 'server', 'index.js'), isStandalone: false }
}

function resolveStudioDir(): string {
  if (process.env.MYCLAW_DESK_STUDIO_DIR) return process.env.MYCLAW_DESK_STUDIO_DIR
  // Dev: studio/ is at the repo root, two levels up from out/main/index.js.
  // Prod: electron-builder unpacks `dist-studio/` to <resourcesPath>/studio/.
  // We can't import { is } here without circulars; check process.resourcesPath
  // and prefer it if it actually contains studio (i.e., we're packaged).
  const packaged = join(process.resourcesPath, 'studio')
  if (existsSync(join(packaged, 'server.js')) || existsSync(join(packaged, 'server', 'index.js'))) {
    return packaged
  }
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
      const { entry: serverEntry, isStandalone } = resolveStudioEntry(studioDir)
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

      // Two modes:
      //   - Standalone (prod): Next emits server.js at <studioDir>/server.js
      //     with output:'standalone'. It reads PORT + HOSTNAME from env;
      //     no extra args needed.
      //   - Custom server (dev): the studio source's server/index.js,
      //     which still supports `--dev` for `next dev`.
      const hasProdBuild =
        isStandalone || existsSync(join(studioDir, '.next', 'BUILD_ID'))
      const args = isStandalone
        ? [serverEntry]
        : hasProdBuild
          ? ['server/index.js']
          : ['server/index.js', '--dev']

      // Dev mode leaves `.next/dev/lock` behind on crash/force-quit, blocking
      // the next launch with "is another next dev running?". We're a single
      // Electron instance per user, so it's safe to clear it pre-spawn.
      if (!isStandalone && !hasProdBuild) {
        try {
          rmSync(join(studioDir, '.next', 'dev', 'lock'), { force: true })
        } catch {
          // best-effort
        }
      }

      // Studio's deps (notably `next`) live under <studioDir>/vendor_modules
      // because electron-builder's extraResources strips anything named
      // `node_modules` at packaging time. Two complementary fallbacks for
      // resolving them at runtime:
      //   - NODE_PATH=<studioDir>/vendor_modules — covers CJS require()
      //   - <studioDir>/node_modules → vendor_modules symlink — covers ESM
      //     `import` (which intentionally ignores NODE_PATH and only walks
      //     parent node_modules dirs). Next 16's Turbopack runtime does ESM
      //     imports of NFT-hashed packages like ws-24bb32dcb9424f99, so
      //     without this Studio crashed on first request. Symlink is
      //     created on user's machine post-install since electron-builder
      //     would otherwise strip it during packaging.
      const vendorModules = join(studioDir, 'vendor_modules')
      const nodeModulesLink = join(studioDir, 'node_modules')
      if (existsSync(vendorModules) && !existsSync(nodeModulesLink)) {
        try {
          // 'junction' on Windows doesn't require the elevated symlink
          // privilege; 'dir' on POSIX is the standard kind.
          symlinkSync(
            vendorModules,
            nodeModulesLink,
            process.platform === 'win32' ? 'junction' : 'dir'
          )
        } catch (err) {
          installLogger.log({
            source: 'studio',
            level: 'warn',
            text: `Failed to symlink node_modules → vendor_modules: ${
              err instanceof Error ? err.message : String(err)
            } — falling back to NODE_PATH only`
          })
        }
      }

      const existingNodePath = process.env.NODE_PATH ?? ''
      const sep = process.platform === 'win32' ? ';' : ':'
      const nodePath = [vendorModules, existingNodePath].filter(Boolean).join(sep)

      // Same PATH fix as bootstrap/daemon: Studio's Next.js sometimes shells
      // out (e.g. to `npm install` if it detects a missing TypeScript dep
      // at runtime), which on Windows resolves through the user's PATH.
      // Without our bundled node dir prepended, `spawn npm` ENOENT-crashes
      // and Studio gets stuck logging the error but never serving
      // requests — exactly the 'still spinning' symptom one user reported.
      const nodeBinDir = pathDirname(node)
      const pathKey =
        process.platform === 'win32'
          ? (Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'Path')
          : 'PATH'
      const childPath = `${nodeBinDir}${sep}${process.env[pathKey] ?? ''}`

      const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        PORT: String(port),
        HOSTNAME: '127.0.0.1',
        NODE_ENV: hasProdBuild ? 'production' : 'development',
        NODE_PATH: nodePath,
        [pathKey]: childPath
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
