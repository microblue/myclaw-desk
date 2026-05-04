import { BrowserWindow, ipcMain } from 'electron'
import { bootstrapper } from '../openclaw/bootstrap'
import { BOOTSTRAP_CHANNELS, type BootstrapState } from '../../shared/bootstrap'

export function registerBootstrapIpc(): void {
  ipcMain.handle(BOOTSTRAP_CHANNELS.getState, () => bootstrapper.getState())
  ipcMain.handle(BOOTSTRAP_CHANNELS.start, () => bootstrapper.ensureInstalled())

  bootstrapper.on('state', (state: BootstrapState) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(BOOTSTRAP_CHANNELS.stateChanged, state)
    }
  })
}
