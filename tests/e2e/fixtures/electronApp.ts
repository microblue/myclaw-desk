import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { join } from 'path'
import type { Sandbox } from './sandbox'

const ROOT = join(__dirname, '..', '..', '..')
const MAIN_ENTRY = join(ROOT, 'out', 'main', 'index.js')

export interface LaunchedApp {
  app: ElectronApplication
  window: Page
  close: () => Promise<void>
}

export interface LaunchOptions {
  /**
   * Path to a packaged Electron binary (dist/linux-unpacked/myclaw-desk,
   * dist/win-unpacked/myclaw-desk.exe, or the .app bundle MacOS executable).
   * When set, we launch the packaged binary directly instead of `electron
   * out/main/index.js` — exercises the same code path users get post-install.
   */
  executablePath?: string
}

/**
 * Launch the Electron app with sandbox env vars applied. Returns the first
 * window once it has finished loading the splash. Caller is responsible for
 * calling close().
 */
export async function launchSandboxedApp(
  sandbox: Sandbox,
  opts: LaunchOptions = {}
): Promise<LaunchedApp> {
  const app = await electron.launch({
    args: opts.executablePath ? [] : [MAIN_ENTRY],
    executablePath: opts.executablePath,
    cwd: opts.executablePath ? undefined : ROOT,
    env: { ...process.env, ...sandbox.env }
  })

  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  const close = async (): Promise<void> => {
    try {
      await app.close()
    } catch {
      // already closed
    }
  }

  return { app, window, close }
}
