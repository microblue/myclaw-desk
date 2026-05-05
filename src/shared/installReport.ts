// Cross-process types for the install logger + crash reporter. Lives in
// `shared/` so renderer + main can both reference the same shape.

export interface InstallLogLine {
  /** ISO timestamp. */
  ts: string
  /** Where the line came from: bootstrap state machine, studio child, npm install, etc. */
  source: 'bootstrap' | 'gateway' | 'studio' | 'npm' | 'reporter'
  level: 'info' | 'warn' | 'error'
  /** Bootstrap phase tag (when known) — e.g. 'installing', 'starting-gateway'. */
  phase?: string
  text: string
}

export type InstallReportStatus = 'idle' | 'sending' | 'sent' | 'failed' | 'disabled'

export interface InstallReportState {
  status: InstallReportStatus
  /** Server-assigned id once accepted. */
  reportId?: string
  /** Error from the last attempt (network failure, 4xx/5xx, etc.). */
  error?: string
  /** Number of attempts made for the current install error. */
  attempts: number
  /** Last attempt timestamp. */
  lastAttemptAt?: string
}

export const INSTALL_REPORT_CHANNELS = {
  getState: 'installReport:getState',
  /** Manually retry sending the latest crash report. */
  resend: 'installReport:resend',
  /** Latest log lines for the splash UI. */
  getLog: 'installReport:getLog',
  stateChanged: 'installReport:stateChanged',
  logAppended: 'installReport:logAppended'
} as const
