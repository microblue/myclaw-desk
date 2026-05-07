// Wires electron-updater so installed users pick up new releases without
// re-downloading the full installer. electron-builder publishes a
// .blockmap alongside each NSIS / AppImage on the GitHub release page;
// electron-updater diffs the user's local installer against the new
// blockmap and downloads only the changed blocks (typically tens of MB
// instead of ~290MB for a full re-install).
//
// We deliberately keep the UX silent: check on launch, download in the
// background, install on app quit. No prompts that would interrupt
// install-flow users mid-bootstrap.

import { autoUpdater } from 'electron-updater'
import { installLogger } from './installLogger'

let initialized = false

export function initAutoUpdate(): void {
  if (initialized) return
  initialized = true

  // Don't pester the user — quietly fetch + apply on next launch.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  // Mirror updater chatter into our install log so power users (and the
  // crash reporter) can see what's happening without us having to spin up
  // a separate logger.
  autoUpdater.on('checking-for-update', () =>
    installLogger.log({ source: 'updater', text: 'checking for update…' })
  )
  autoUpdater.on('update-available', (info) =>
    installLogger.log({ source: 'updater', text: `update available: v${info.version}` })
  )
  autoUpdater.on('update-not-available', (info) =>
    installLogger.log({ source: 'updater', text: `up to date (v${info.version})` })
  )
  autoUpdater.on('download-progress', (p) =>
    installLogger.log({
      source: 'updater',
      text: `downloading: ${Math.round(p.percent)}% @ ${Math.round(p.bytesPerSecond / 1024)} KB/s`
    })
  )
  autoUpdater.on('update-downloaded', (info) =>
    installLogger.log({
      source: 'updater',
      text: `update v${info.version} downloaded — installs on next quit`
    })
  )
  autoUpdater.on('error', (err) =>
    installLogger.log({
      source: 'updater',
      level: 'warn',
      text: `updater error: ${err instanceof Error ? err.message : String(err)}`
    })
  )

  // checkForUpdatesAndNotify uses GitHub's releases API based on the
  // electron-builder.yml `publish` block; no extra config needed at
  // runtime.
  void autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    installLogger.log({
      source: 'updater',
      level: 'warn',
      text: `update check failed: ${err instanceof Error ? err.message : String(err)}`
    })
  })
}
