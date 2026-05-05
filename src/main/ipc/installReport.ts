import { BrowserWindow, ipcMain } from 'electron'
import { installReporter } from '../installReporter'
import { installLogger } from '../installLogger'
import {
  INSTALL_REPORT_CHANNELS,
  type InstallReportState,
  type InstallLogLine
} from '../../shared/installReport'

export function registerInstallReportIpc(): void {
  ipcMain.handle(INSTALL_REPORT_CHANNELS.getState, () => installReporter.getState())
  ipcMain.handle(INSTALL_REPORT_CHANNELS.resend, () => installReporter.resend())
  ipcMain.handle(INSTALL_REPORT_CHANNELS.getLog, () => installLogger.snapshot())

  installReporter.on('state', (state: InstallReportState) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(INSTALL_REPORT_CHANNELS.stateChanged, state)
    }
  })

  installLogger.on('line', (line: InstallLogLine) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(INSTALL_REPORT_CHANNELS.logAppended, line)
    }
  })
}
