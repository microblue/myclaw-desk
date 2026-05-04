import { test, expect } from '@playwright/test'
import { existsSync } from 'fs'
import { createSandbox, type Sandbox } from './fixtures/sandbox'
import { launchSandboxedApp, type LaunchedApp } from './fixtures/electronApp'

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

test('splash renders the product name', async () => {
  await expect(launched.window.locator('text=MyClaw.One Desktop')).toBeVisible({
    timeout: 10_000
  })
})

test('sandbox env was actually applied (userData redirected)', async () => {
  // The bootstrapper writes its install marker under userData/openclaw/runtime.
  // Even though we haven't wired the install flow yet, the path resolver runs
  // on app startup, so userData should at least be reachable. We just check
  // the dir exists — proves Electron honored MYCLAW_DESK_USERDATA.
  expect(existsSync(sandbox.userData)).toBe(true)
  expect(existsSync(sandbox.openclawState)).toBe(true)
})
