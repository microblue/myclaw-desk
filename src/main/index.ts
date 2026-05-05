import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerBootstrapIpc } from './ipc/bootstrap'
import { registerStudioIpc } from './ipc/studio'
import { registerInstallReportIpc } from './ipc/installReport'
import { bootstrapper } from './openclaw/bootstrap'
import { studio } from './studio/process'
import { installReporter } from './installReporter'
import type { BootstrapState } from '../shared/bootstrap'
import type { StudioState } from '../shared/studio'

// Sandbox override: redirect Electron's userData (and thus our paths.ts
// derivatives) into a tmp dir so e2e tests never touch the user's real config.
// Must run before app.whenReady() — setPath has no effect after paths cache.
if (process.env.MYCLAW_DESK_USERDATA) {
  app.setPath('userData', process.env.MYCLAW_DESK_USERDATA)
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Initial load: our splash renderer (BootstrapView). When studio is ready
  // we swap the window URL over to the embedded Studio.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function swapToStudio(state: StudioState): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (state.phase !== 'ready' || !state.url) return
  // Avoid pointless reloads if we're already on the studio URL.
  const current = mainWindow.webContents.getURL()
  if (current.startsWith(state.url)) return
  // Mark the final bootstrap gate green only when the URL actually loads —
  // a load failure (studio crashed, port misbinds) should leave the gate red.
  const onLoaded = (): void => {
    bootstrapper.markStudioConnected(`connected to ${state.url}`)
  }
  mainWindow.webContents.once('did-finish-load', onLoaded)
  void mainWindow.loadURL(state.url)
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('one.myclaw.desktop')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerBootstrapIpc()
  registerStudioIpc()
  registerInstallReportIpc()

  createWindow()

  studio.on('state', swapToStudio)

  // Two-stage launch: bootstrap (install + gateway) first, then studio. Studio
  // depends on the gateway being reachable, so we serialize. Splash UI shows
  // bootstrap progress until phase==='ready', then studio progress until URL
  // swap.
  bootstrapper.on('state', (state: BootstrapState) => {
    if (state.phase === 'ready' && studio.getState().phase === 'idle') {
      void studio.start()
    }
    // Auto-fire crash report once on bootstrap error. Reporter is idempotent:
    // a duplicate trigger while a send is in flight resolves to the same
    // promise; once status is 'sent' we don't repeat.
    if (state.phase === 'error') {
      void installReporter.report(state)
    }
  })
  void bootstrapper.ensureReady()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  studio.stop()
  bootstrapper.shutdown()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
