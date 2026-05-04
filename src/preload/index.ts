import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { BOOTSTRAP_CHANNELS, type BootstrapState } from '../shared/bootstrap'
import { STUDIO_CHANNELS, type StudioState } from '../shared/studio'

const api = {
  bootstrap: {
    getState: (): Promise<BootstrapState> => ipcRenderer.invoke(BOOTSTRAP_CHANNELS.getState),
    start: (): Promise<BootstrapState> => ipcRenderer.invoke(BOOTSTRAP_CHANNELS.start),
    onStateChanged: (cb: (state: BootstrapState) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, state: BootstrapState): void => cb(state)
      ipcRenderer.on(BOOTSTRAP_CHANNELS.stateChanged, listener)
      return () => ipcRenderer.off(BOOTSTRAP_CHANNELS.stateChanged, listener)
    }
  },
  studio: {
    getState: (): Promise<StudioState> => ipcRenderer.invoke(STUDIO_CHANNELS.getState),
    start: (): Promise<StudioState> => ipcRenderer.invoke(STUDIO_CHANNELS.start),
    stop: (): Promise<StudioState> => ipcRenderer.invoke(STUDIO_CHANNELS.stop),
    onStateChanged: (cb: (state: StudioState) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, state: StudioState): void => cb(state)
      ipcRenderer.on(STUDIO_CHANNELS.stateChanged, listener)
      return () => ipcRenderer.off(STUDIO_CHANNELS.stateChanged, listener)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

export type Api = typeof api
