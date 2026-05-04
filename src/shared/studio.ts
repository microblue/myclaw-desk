export type StudioPhase = 'idle' | 'starting' | 'ready' | 'error' | 'stopped'

export interface StudioState {
  phase: StudioPhase
  url?: string
  message?: string
  error?: string
  /** Last log line from the studio child process. */
  logTail?: string
}

export const STUDIO_CHANNELS = {
  getState: 'studio:getState',
  start: 'studio:start',
  stop: 'studio:stop',
  stateChanged: 'studio:stateChanged'
} as const
