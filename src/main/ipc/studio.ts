import { BrowserWindow, ipcMain } from 'electron'
import { studio } from '../studio/process'
import { STUDIO_CHANNELS, type StudioState } from '../../shared/studio'

export function registerStudioIpc(): void {
  ipcMain.handle(STUDIO_CHANNELS.getState, () => studio.getState())
  ipcMain.handle(STUDIO_CHANNELS.start, () => studio.start())
  ipcMain.handle(STUDIO_CHANNELS.stop, () => {
    studio.stop()
    return studio.getState()
  })

  studio.on('state', (state: StudioState) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(STUDIO_CHANNELS.stateChanged, state)
    }
  })
}
