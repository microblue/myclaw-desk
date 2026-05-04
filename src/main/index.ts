import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerBootstrapIpc } from './ipc/bootstrap'
import { registerStudioIpc } from './ipc/studio'
import { studio } from './studio/process'
import type { StudioState } from '../shared/studio'

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
  void mainWindow.loadURL(state.url)
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('ai.openclaw.desktop')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerBootstrapIpc()
  registerStudioIpc()

  createWindow()

  studio.on('state', swapToStudio)
  // Kick off the studio child as soon as the app is ready. Splash UI will
  // observe its state via IPC; URL swap happens automatically on 'ready'.
  void studio.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  studio.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
