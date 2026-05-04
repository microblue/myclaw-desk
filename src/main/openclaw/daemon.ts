import { spawn, type ChildProcess } from 'child_process'
import * as net from 'net'

const READY_TIMEOUT_MS = 30_000
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
  /** openclaw CLI binary path. */
  openclawBin: string
  /** Port to listen on. */
  port: number
  /** OPENCLAW_STATE_DIR override (test sandbox). */
  stateDir: string
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
  const child = spawn(opts.openclawBin, ['gateway', '--port', String(opts.port)], {
    env: { ...process.env, OPENCLAW_STATE_DIR: opts.stateDir },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  // Detach from parent's reference count: Electron's main owns lifecycle via
  // app.quit(); we don't want pipes/exit listeners on the child keeping the
  // event loop alive when the user closes the window.
  child.unref()

  const onData = (buf: Buffer): void => {
    if (!opts.onLog) return
    const tail = buf.toString('utf8').split(/\r?\n/).filter(Boolean).pop()
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

  await waitForReadyOrExit(child, opts.port)
  return handle
}

async function waitForReadyOrExit(child: ChildProcess, port: number): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | undefined
  child.once('exit', (code, signal) => {
    exitInfo = { code, signal }
  })

  while (Date.now() < deadline) {
    if (exitInfo) {
      throw new Error(
        `openclaw gateway exited before listening (code=${exitInfo.code}, signal=${exitInfo.signal})`
      )
    }
    if (await isPortListening(port, '127.0.0.1', 500)) return
    await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL_MS))
  }
  // Time's up. Best-effort kill so the caller doesn't leak the child.
  if (child.exitCode === null) child.kill('SIGTERM')
  throw new Error(`openclaw gateway did not start listening on port ${port} within ${READY_TIMEOUT_MS / 1000}s`)
}
