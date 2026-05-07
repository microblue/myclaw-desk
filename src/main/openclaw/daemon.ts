import { spawn, type ChildProcess } from 'child_process'
import * as net from 'net'
import { dirname } from 'path'
import type { OpenclawCommand } from './paths'

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
  /** Resolved openclaw spawn command (from paths.ts). */
  openclaw: OpenclawCommand
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
    [
      ...opts.openclaw.prefixArgs,
      'gateway',
      '--port',
      String(opts.port),
      '--allow-unconfigured'
    ],
    {
      env: {
        ...process.env,
        [pathKey]: `${nodeBinDir}${pathSep}${process.env[pathKey] ?? ''}`,
        OPENCLAW_STATE_DIR: opts.stateDir
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
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
        `MyClaw service exited before listening (code=${exitInfo.code}, signal=${exitInfo.signal})`
      )
    }
    if (await isPortListening(port, '127.0.0.1', 500)) return
    await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL_MS))
  }
  // Time's up. Best-effort kill so the caller doesn't leak the child.
  if (child.exitCode === null) child.kill('SIGTERM')
  throw new Error(
    `MyClaw service did not start listening on port ${port} within ${READY_TIMEOUT_MS / 1000}s`
  )
}
