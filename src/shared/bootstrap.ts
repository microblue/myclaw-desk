export type BootstrapPhase =
  | 'idle'
  | 'checking'
  | 'preparing'
  | 'installing'
  | 'ready'
  | 'error'

export interface BootstrapState {
  phase: BootstrapPhase
  /** 0..1 progress estimate. -1 = indeterminate. */
  progress: number
  message: string
  logTail?: string
  error?: string
}

export const BOOTSTRAP_CHANNELS = {
  getState: 'bootstrap:getState',
  start: 'bootstrap:start',
  stateChanged: 'bootstrap:stateChanged'
} as const
