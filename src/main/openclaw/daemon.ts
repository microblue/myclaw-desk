import { spawn, type ChildProcess } from 'child_process'
import * as net from 'net'
import { dirname } from 'path'
import type { OpenclawCommand } from './paths'

// First-run on Windows is *very* slow because Defender's real-time scan
// touches every file openclaw reads (~19k under vendor_modules). One
// real-user report at v0.1.28 took 67s between spawn and gateway's first
// stdout line ("loading configuration…"), and by 126s after spawn the
// WS handler still wasn't up — well past our previous 120s timeout. The
// machine was 4 cores / 5 GB RAM / Defender active, which we should
// treat as a supported config. 5 minutes covers the slow path with
// headroom; subsequent launches are sub-30s once Defender's cache is
// warm. Override via MYCLAW_DESK_GATEWAY_TIMEOUT_MS for tests.
const READY_TIMEOUT_MS = (() => {
  const env = process.env.MYCLAW_DESK_GATEWAY_TIMEOUT_MS
  if (env) {
    const n = Number.parseInt(env, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 300_000
})()
const READY_POLL_INTERVAL_MS = 250

/** Probe whether a TCP listener is up at host:port. Used both to detect an
 * already-running gateway (skip install) and to wait for our managed child
 * to reach the listening state. */
export function isPortListening(
  port: number,
  host = '127.0.0.1',
  timeoutMs = 1000
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (result: boolean): void => {
      if (settled) return
      settled = true
      sock.destroy()
      resolve(result)
    }
    const sock = net.createConnection({ port, host })
    sock.once('connect', () => finish(true))
    sock.once('error', () => finish(false))
    setTimeout(() => finish(false), timeoutMs)
  })
}

export interface ManagedGatewayHandle {
  child: ChildProcess
  port: number
  url: string
  stop: () => void
}

export interface StartManagedGatewayOptions {
  /** Resolved openclaw spawn command (from paths.ts). */
  openclaw: OpenclawCommand
  /** Port to listen on. */
  port: number
  /** OPENCLAW_STATE_DIR override (test sandbox). */
  stateDir: string
  /** Extra env vars for the child (e.g. OPENROUTER_API_KEY from bundled secret). */
  extraEnv?: Record<string, string>
  /** Stream of stdout/stderr lines for UI logTail. */
  onLog?: (line: string) => void
}

/**
 * Spawn `openclaw gateway --port <port>` as a child process and wait until
 * the port is accepting connections. Throws on timeout or early exit.
 */
export async function startManagedGateway(
  opts: StartManagedGatewayOptions
): Promise<ManagedGatewayHandle> {
  // Inject the bundled node dir into PATH so any child process the gateway
  // spawns (e.g. cmd.exe /c node ...) finds our node.exe on Windows where
  // the user's system PATH typically has no node at all.
  const nodeBinDir = dirname(opts.openclaw.cmd)
  const pathSep = process.platform === 'win32' ? ';' : ':'
  const pathKey =
    process.platform === 'win32'
      ? (Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'Path')
      : 'PATH'

  // `--allow-unconfigured` skips the auth-config gate. Without it openclaw
  // exits 78 with "Missing config. Run `openclaw setup`…" — fine for a
  // CLI install where the user has time to walk through setup, fatal for
  // a desktop where Studio is the setup UI. Local-only desktop sessions
  // don't need a remote auth profile.
  const child = spawn(
    opts.openclaw.cmd,
    [...opts.openclaw.prefixArgs, 'gateway', '--port', String(opts.port), '--allow-unconfigured'],
    {
      env: {
        ...process.env,
        [pathKey]: `${nodeBinDir}${pathSep}${process.env[pathKey] ?? ''}`,
        OPENCLAW_STATE_DIR: opts.stateDir,
        ...(opts.extraEnv ?? {})
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  // Detach from parent's reference count: Electron's main owns lifecycle via
  // app.quit(); we don't want pipes/exit listeners on the child keeping the
  // event loop alive when the user closes the window.
  child.unref()

  // Watch gateway stdout for the line it prints when its HTTP+WS server is
  // fully bound and accepting traffic. This is the authoritative ready
  // signal — vastly more reliable than poking the socket from outside,
  // which is what bit us in the v0.1.29 user report:
  //
  //   [gateway] http server listening (6 plugins: …; 203.1s)
  //
  // Once that line appears the gateway IS ready, but our external probe
  // was still spinning because the gateway closes unauthenticated
  // upgrade requests without writing back a status line (code=1006 in
  // its own logs), so `data` never fired and we kept retrying until the
  // 300s deadline. The stdout marker doesn't depend on auth or probe
  // shape, so it works against every supported openclaw version.
  let gatewayLogReady = false
  const READY_LINE = /http\s+server\s+listening/i
  const onData = (buf: Buffer): void => {
    const text = buf.toString('utf8')
    if (!gatewayLogReady && READY_LINE.test(text)) {
      gatewayLogReady = true
    }
    if (!opts.onLog) return
    const tail = text.split(/\r?\n/).filter(Boolean).pop()
    if (tail) opts.onLog(tail)
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)

  const handle: ManagedGatewayHandle = {
    child,
    port: opts.port,
    url: `ws://127.0.0.1:${opts.port}`,
    stop: () => {
      // Detach piped stdio first so the parent's event loop isn't kept alive
      // by drained-but-not-closed read streams. Without this Electron hangs
      // on quit waiting for these pipes to flush.
      child.stdout?.destroy()
      child.stderr?.destroy()
      if (child.exitCode === null) {
        child.kill('SIGTERM')
        setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL')
        }, 1_500)
      }
    }
  }

  await waitForReadyOrExit(child, opts.port, () => gatewayLogReady)
  return handle
}

async function waitForReadyOrExit(
  child: ChildProcess,
  port: number,
  isLogReady: () => boolean
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | undefined
  child.once('exit', (code, signal) => {
    exitInfo = { code, signal }
  })

  // Ready detection, in preference order:
  //   1. Gateway prints its own "http server listening" line — definitive
  //      signal, no probing needed. Works for every real openclaw version.
  //   2. WS upgrade handshake succeeds against the port — fallback for the
  //      fake-openclaw e2e test bin which doesn't print log lines but does
  //      respond with HTTP/1.1 101 on incoming bytes.
  //   3. Plain TCP listening — informational only, used to gate when (2)
  //      becomes worth attempting.
  // We don't rely solely on (2) anymore: it returned false negatives
  // against real openclaw, which closes unauthenticated WS upgrades with
  // code=1006 (no HTTP response body), so the probe's `data` event never
  // fires and we'd hit deadline despite the gateway being fully ready.
  let tcpReady = false
  while (Date.now() < deadline) {
    if (exitInfo) {
      throw new Error(
        `MyClaw service exited before listening (code=${exitInfo.code}, signal=${exitInfo.signal})`
      )
    }
    if (isLogReady()) return
    if (!tcpReady) {
      if (await isPortListening(port, '127.0.0.1', 500)) tcpReady = true
    } else {
      if (await canHandshakeWebSocket(port, 1500)) return
    }
    await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL_MS))
  }
  // Time's up. Best-effort kill so the caller doesn't leak the child.
  if (child.exitCode === null) child.kill('SIGTERM')
  const tcpHint = tcpReady
    ? 'TCP port was listening but the WebSocket handler did not finish initializing'
    : 'TCP port was never reached'
  throw new Error(
    `MyClaw service did not become ready on port ${port} within ${READY_TIMEOUT_MS / 1000}s ` +
      `(${tcpHint}). On Windows this is usually antivirus real-time scanning on first launch — ` +
      `relaunching the app typically succeeds the second time once the file cache is warm.`
  )
}

/** Send a real WebSocket upgrade request and resolve true if the gateway
 * responds with anything other than connection-refused / hang / read-error.
 * Even a 401/403 from the gateway means its WS handler is wired up — that's
 * what Studio's connect attempt is going to hit, so it's a more accurate
 * "ready" signal than plain TCP listening. */
function canHandshakeWebSocket(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: boolean): void => {
      if (settled) return
      settled = true
      sock.destroy()
      resolve(result)
    }
    const sock = net.createConnection({ port, host: '127.0.0.1' })
    sock.setTimeout(timeoutMs)
    sock.once('error', () => finish(false))
    sock.once('timeout', () => finish(false))
    sock.once('connect', () => {
      // 16-byte random key per RFC 6455. We don't validate the response key
      // — just the fact that the server sent any HTTP/1.1 line back means
      // it's past the bare-TCP-accept stage and the WS handler was reached.
      const key = Buffer.alloc(16, 0).toString('base64')
      sock.write(
        [
          `GET / HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          `Upgrade: websocket`,
          `Connection: Upgrade`,
          `Sec-WebSocket-Key: ${key}`,
          `Sec-WebSocket-Version: 13`,
          ``,
          ``
        ].join('\r\n')
      )
    })
    sock.once('data', (chunk) => finish(chunk.toString('utf8').startsWith('HTTP/1.')))
  })
}
