// electron-updater integration with delta downloads via .blockmap.
//
// Why dynamic require: the v0.1.19 attempt did `import { autoUpdater } from
// 'electron-updater'` at the top of this module, which made the entire
// updater package load on every main-process startup — including under the
// e2e sandbox. That import-time evaluation took down 03-packaged on Linux
// CI before the splash window could render. Wrapping the call in try/catch
// didn't help because the import itself was the crash site.
//
// `eval('require')` bypasses Vite's static analysis: the bundler can't see
// through the eval, so the dependency stays as a runtime lookup against
// app.asar.unpacked/node_modules. If the require throws, our try/catch
// catches it and the splash continues — auto-update becomes a no-op
// instead of bricking launch.
//
// We also gate on `app.isPackaged` to skip dev runs, and on the sandbox
// env vars so e2e specs never hit GitHub's release API.

import { app } from 'electron'
import { installLogger } from './installLogger'

let initialized = false

export function initAutoUpdate(): void {
  if (initialized) return
  initialized = true

  if (!app.isPackaged) return
  if (process.env.MYCLAW_DESK_USERDATA) return
  if (process.env.MYCLAW_DESK_DISABLE_AUTOUPDATE) return

  try {
    // Hide the require from Vite/Rollup so the module isn't pulled into
    // the main bundle at build time — this is what made v0.1.19 crash on
    // Linux unpacked.
    const dynamicRequire = eval('require') as NodeJS.Require
    const { autoUpdater } = dynamicRequire('electron-updater') as {
      autoUpdater: {
        autoDownload: boolean
        autoInstallOnAppQuit: boolean
        on(event: string, listener: (...args: unknown[]) => void): void
        checkForUpdates(): Promise<unknown>
      }
    }

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () =>
      installLogger.log({ source: 'bootstrap', text: 'updater: checking for update…' })
    )
    autoUpdater.on('update-available', (...args: unknown[]) => {
      const info = args[0] as { version?: string } | undefined
      installLogger.log({ source: 'bootstrap', text: `updater: available v${info?.version}` })
    })
    autoUpdater.on('update-not-available', (...args: unknown[]) => {
      const info = args[0] as { version?: string } | undefined
      installLogger.log({ source: 'bootstrap', text: `updater: up to date (v${info?.version})` })
    })
    autoUpdater.on('download-progress', (...args: unknown[]) => {
      const p = args[0] as { percent?: number } | undefined
      installLogger.log({ source: 'bootstrap', text: `updater: ${Math.round(p?.percent ?? 0)}%` })
    })
    autoUpdater.on('update-downloaded', (...args: unknown[]) => {
      const info = args[0] as { version?: string } | undefined
      installLogger.log({
        source: 'bootstrap',
        text: `updater: v${info?.version} downloaded — installs on next quit`
      })
    })
    autoUpdater.on('error', (...args: unknown[]) => {
      const err = args[0] as Error | undefined
      installLogger.log({
        source: 'bootstrap',
        level: 'warn',
        text: `updater: error: ${err?.message ?? String(err)}`
      })
    })

    void autoUpdater.checkForUpdates().catch((err: unknown) => {
      installLogger.log({
        source: 'bootstrap',
        level: 'warn',
        text: `updater: checkForUpdates failed: ${err instanceof Error ? err.message : String(err)}`
      })
    })
  } catch (err) {
    installLogger.log({
      source: 'bootstrap',
      level: 'warn',
      text: `updater: init failed: ${err instanceof Error ? err.message : String(err)}`
    })
  }
}
