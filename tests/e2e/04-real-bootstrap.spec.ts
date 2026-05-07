import { test, expect } from '@playwright/test'
import { existsSync, readFileSync } from 'fs'
import * as net from 'net'
import { join } from 'path'
import { createSandbox, type Sandbox } from './fixtures/sandbox'
import { launchSandboxedApp, type LaunchedApp } from './fixtures/electronApp'
import { packagedBinaryPath } from './fixtures/packaged'
import type { BootstrapState, BootstrapCheck } from '../../src/shared/bootstrap'
import type { StudioState } from '../../src/shared/studio'

// Full-stack smoke. Runs the packaged binary against a real `npm install
// openclaw@<pinned>`, real managed gateway, real embedded Studio. This is
// the only test that catches problems like:
//   - bundled npm not finding `node` for lifecycle scripts (v0.1.10 bug)
//   - openclaw exiting 78 without --allow-unconfigured (v0.1.11 bug)
//   - Studio failing to log "Open in browser:" (current symptom)
// Slow (~3 min on a clean cache) — gated to Linux runs because the Windows
// path needs cmd shims for openclaw and macOS isn't built yet.

const binPath = packagedBinaryPath()

const skipReason = (() => {
  if (!binPath) return `no packaged binary at expected dist path for ${process.platform}`
  if (process.platform !== 'linux') return 'real-bootstrap currently linux-only'
  return null
})()

// Roomy: cold npm install ≈2 min, gateway first-boot ≈30s with token gen,
// Studio cold start ≈15s, plus slack for slower runners.
const REAL_BOOT_TIMEOUT_MS = 5 * 60_000

test.describe('full-stack smoke (real openclaw + studio)', () => {
  test.skip(skipReason !== null, skipReason ?? '')
  test.setTimeout(REAL_BOOT_TIMEOUT_MS + 60_000)

  let sandbox: Sandbox
  let launched: LaunchedApp

  test.beforeAll(async () => {
    sandbox = createSandbox({ realOpenclaw: true })
    launched = await launchSandboxedApp(sandbox, { executablePath: binPath! })
  })

  test.afterAll(async () => {
    await launched?.close()
    sandbox?.cleanup()
  })

  test('bootstrap reaches ready with all four pre-studio gates green', async () => {
    const final = await waitForBootstrapPhase(
      launched.window,
      (s) => s.phase === 'ready' || s.phase === 'error',
      REAL_BOOT_TIMEOUT_MS
    )

    if (final.phase === 'error') {
      throw new Error(`bootstrap entered error: ${final.error ?? '(no error message)'}`)
    }

    expect(final.phase).toBe('ready')

    const gates = byId(final.checks ?? [])
    // 'ok' or 'warn' both count — 'warn' is the soft-fail allowed for
    // provider (no key) and studio (dev fallback). Surface the gate labels
    // so a future regression tells us exactly which one degraded.
    for (const id of ['openclaw', 'gateway', 'provider', 'studio'] as const) {
      const g = gates[id]
      expect(g, `gate ${id} present`).toBeDefined()
      expect(
        g.status === 'ok' || g.status === 'warn',
        `gate ${id} status (got ${g.status}, detail=${g.detail ?? 'none'})`
      ).toBe(true)
    }

    expect(await isPortListening(sandbox.gatewayPort)).toBe(true)
  })

  test('window swaps to Studio URL and Studio responds', async () => {
    // Once the bootstrap is ready, main/index.ts swaps the BrowserWindow to
    // the Studio URL — at that point our preload (window.api) is gone, so
    // we wait on the window's URL changing instead of polling bootstrap state.
    const deadline = Date.now() + REAL_BOOT_TIMEOUT_MS
    let url = launched.window.url()
    while (Date.now() < deadline) {
      url = launched.window.url()
      if (/^http:\/\/127\.0\.0\.1:\d+/.test(url)) break
      await new Promise((r) => setTimeout(r, 500))
    }

    if (!/^http:\/\/127\.0\.0\.1:\d+/.test(url)) {
      // The window URL never swapped — surface what Studio was doing so the
      // CI log says *why* instead of just "URL didn't match". We can still
      // hit window.api here because the swap never happened.
      const studio = await safeStudioState(launched.window)
      const installLog = readInstallLogTail(sandbox)
      throw new Error(
        `window URL never changed to a Studio URL within ${REAL_BOOT_TIMEOUT_MS / 1000}s.\n` +
          `Last URL: ${url}\n` +
          `Studio state: ${JSON.stringify(studio, null, 2)}\n` +
          `Install log tail (last 80 lines):\n${installLog}`
      )
    }

    // Studio is HTTP — fetch from the test runner directly. We only require
    // that the server responds; Studio's exact HTML isn't pinned.
    const ok = await fetchOk(url)
    expect(ok, `GET ${url} should succeed`).toBe(true)
  })
})

function byId(checks: BootstrapCheck[]): Record<string, BootstrapCheck> {
  return Object.fromEntries(checks.map((c) => [c.id, c]))
}

async function isPortListening(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host })
    sock.once('connect', () => {
      sock.destroy()
      resolve(true)
    })
    sock.once('error', () => resolve(false))
  })
}

async function safeStudioState(
  window: LaunchedApp['window']
): Promise<StudioState | { error: string }> {
  try {
    return (await window.evaluate(() => window.api?.studio.getState())) as StudioState
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

function readInstallLogTail(sandbox: Sandbox, lines = 80): string {
  const candidates = [
    join(sandbox.userData, 'install.log'),
    // Older layout in case the app rolls userData layout in future:
    join(sandbox.userData, 'logs', 'install.log')
  ]
  for (const p of candidates) {
    if (!existsSync(p)) continue
    try {
      const all = readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean)
      return all.slice(-lines).join('\n')
    } catch (e) {
      return `(failed to read ${p}: ${e instanceof Error ? e.message : String(e)})`
    }
  }
  return '(no install.log present in sandbox)'
}

async function fetchOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'GET' })
    return res.ok || res.status < 500
  } catch {
    return false
  }
}

async function waitForBootstrapPhase(
  window: LaunchedApp['window'],
  predicate: (s: BootstrapState) => boolean,
  timeoutMs: number
): Promise<BootstrapState> {
  const deadline = Date.now() + timeoutMs
  let last: BootstrapState | null = null
  while (Date.now() < deadline) {
    // After the URL swap to Studio, window.api is gone (Studio's preload
    // doesn't expose it). We treat that as the implicit success signal:
    // bootstrap had to be 'ready' before main/index.ts initiated the swap.
    let state: BootstrapState | null = null
    try {
      state = (await window.evaluate(() => window.api?.bootstrap.getState())) as BootstrapState
    } catch {
      // Page navigated mid-eval — fall through and let the next URL probe
      // handle the success path.
      return last ?? ({ phase: 'ready', progress: 1, message: '' } as BootstrapState)
    }
    if (state) {
      last = state
      if (predicate(state)) return state
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(
    `bootstrap predicate not satisfied within ${timeoutMs}ms; last phase=${last?.phase} ` +
      `error=${last?.error ?? '-'} checks=${JSON.stringify(last?.checks ?? [])}`
  )
}
