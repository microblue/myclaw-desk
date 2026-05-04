export type BootstrapPhase =
  | 'idle'
  | 'detecting' // probing if a gateway is already running
  | 'preparing' // creating dirs, deciding install vs skip
  | 'installing' // npm install openclaw
  | 'starting-gateway' // spawning the managed gateway child
  | 'ready' // gateway is reachable on the configured port
  | 'error'

export interface BootstrapState {
  phase: BootstrapPhase
  /** 0..1 progress estimate. -1 = indeterminate. */
  progress: number
  message: string
  /** Last log line from npm or the gateway child. */
  logTail?: string
  error?: string
  /** Resolved ws URL once phase === 'ready'. */
  gatewayUrl?: string
}

export const BOOTSTRAP_CHANNELS = {
  getState: 'bootstrap:getState',
  start: 'bootstrap:start',
  stateChanged: 'bootstrap:stateChanged'
} as const
