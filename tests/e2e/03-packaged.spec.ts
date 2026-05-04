import { test, expect } from '@playwright/test'
import * as net from 'net'
import { createSandbox, type Sandbox } from './fixtures/sandbox'
import { launchSandboxedApp, type LaunchedApp } from './fixtures/electronApp'
import { packagedBinaryPath } from './fixtures/packaged'
import type { BootstrapState } from '../../src/shared/bootstrap'

const binPath = packagedBinaryPath()

// On Windows, the fake openclaw is a Node shebang script. Windows can't run
// shebangs, so spawn(binPath, ['gateway']) inside the packaged app fails to
// find an interpreter. Skip until we add a .cmd shim.
const skipReason = (() => {
  if (!binPath) return `no packaged binary at expected dist path for ${process.platform}`
  if (process.platform === 'win32') return 'fake-openclaw shebang not honored on Windows'
  return null
})()

test.describe('packaged app smoke', () => {
  test.skip(skipReason !== null, skipReason ?? '')

  let sandbox: Sandbox
  let launched: LaunchedApp

  test.beforeAll(async () => {
    sandbox = createSandbox()
    launched = await launchSandboxedApp(sandbox, { executablePath: binPath! })
  })

  test.afterAll(async () => {
    await launched?.close()
    sandbox?.cleanup()
  })

  test('packaged binary boots and shows splash', async () => {
    await expect(launched.window.locator('text=MyClaw.One Desktop')).toBeVisible({
      timeout: 15_000
    })
  })

  test('bootstrap reaches ready against fake gateway', async () => {
    const ready = await waitForBootstrapPhase(
      launched.window,
      (s) => s.phase === 'ready' || s.phase === 'error',
      45_000
    )
    expect(ready.phase).toBe('ready')
    expect(ready.gatewayUrl).toBe(`ws://127.0.0.1:${sandbox.gatewayPort}`)
    expect(await isPortListening(sandbox.gatewayPort)).toBe(true)
  })
})

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

async function waitForBootstrapPhase(
  window: LaunchedApp['window'],
  predicate: (s: BootstrapState) => boolean,
  timeoutMs: number
): Promise<BootstrapState> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await window.evaluate(async () => {
      return await window.api.bootstrap.getState()
    })
    if (predicate(state as BootstrapState)) return state as BootstrapState
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`bootstrap predicate not satisfied within ${timeoutMs}ms`)
}
