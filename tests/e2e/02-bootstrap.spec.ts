import { test, expect } from '@playwright/test'
import * as net from 'net'
import { createSandbox, type Sandbox } from './fixtures/sandbox'
import { launchSandboxedApp, type LaunchedApp } from './fixtures/electronApp'
import type { BootstrapState } from '../../src/shared/bootstrap'

let sandbox: Sandbox
let launched: LaunchedApp

test.beforeAll(async () => {
  sandbox = createSandbox()
  launched = await launchSandboxedApp(sandbox)
})

test.afterAll(async () => {
  await launched?.close()
  sandbox?.cleanup()
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

test('bootstrap reaches ready and gateway listens on the sandbox port', async () => {
  const ready = await waitForBootstrapPhase(
    launched.window,
    (s) => s.phase === 'ready' || s.phase === 'error',
    30_000
  )
  expect(ready.phase).toBe('ready')
  expect(ready.gatewayUrl).toBe(`ws://127.0.0.1:${sandbox.gatewayPort}`)

  // Verify the actual TCP listener is bound at the sandbox port.
  const listening = await isPortListening(sandbox.gatewayPort)
  expect(listening).toBe(true)
})

test('does not collide with a gateway on a different port', async () => {
  // The sandbox uses a port distinct from 18789 (the user's real openclaw).
  // This test pins the assumption — if it ever defaults to 18789 we'd
  // accidentally cohabit with the host's gateway.
  expect(sandbox.gatewayPort).not.toBe(18789)
})

test('splash transitions through bootstrap phases without erroring', async () => {
  // Once ready, headline should reflect the gateway-ready state. We don't
  // wait for studio (it would try to do a real handshake against the fake
  // openclaw and fail — that's a different test layer).
  await expect(launched.window.locator('h1', { hasText: 'MyClaw.One Desktop' })).toBeVisible()
})
