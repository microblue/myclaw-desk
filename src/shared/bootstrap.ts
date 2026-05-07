export type BootstrapPhase =
  | 'idle'
  | 'detecting' // probing if a gateway is already running
  | 'preparing' // creating dirs, deciding install vs skip
  | 'installing' // npm install openclaw@<pinned>
  | 'verifying-openclaw' // confirming the CLI is in place + version matches
  | 'starting-gateway' // spawning the managed gateway child
  | 'configuring-provider' // checking that an LLM provider is reachable
  | 'verifying-studio' // checking the embedded Studio prod build is present
  | 'ready' // gateway is reachable on the configured port
  | 'error'

/**
 * Pinned OpenClaw version that the desktop installer requests. Bumping this
 * ships a new desktop release; users get a known-good combination of CLI
 * + bundled Studio rather than `latest` (which can drift between the desktop
 * release and what's published on npm).
 */
export const OPENCLAW_VERSION = '2026.5.3'

export type CheckStatus = 'pending' | 'active' | 'ok' | 'failed' | 'warn'

export interface BootstrapCheck {
  id: 'openclaw' | 'provider' | 'gateway' | 'studio' | 'studio-connected'
  label: string
  status: CheckStatus
  /** Optional one-line detail (version string, error, hint). */
  detail?: string
}

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
  /** 5 deterministic acceptance gates the splash UI renders as a checklist. */
  checks?: BootstrapCheck[]
}

export const BOOTSTRAP_CHANNELS = {
  getState: 'bootstrap:getState',
  start: 'bootstrap:start',
  stateChanged: 'bootstrap:stateChanged'
} as const

export const DEFAULT_CHECKS: BootstrapCheck[] = [
  { id: 'openclaw', label: `MyClaw engine ${OPENCLAW_VERSION} installed`, status: 'pending' },
  { id: 'gateway', label: 'MyClaw service running', status: 'pending' },
  { id: 'provider', label: 'AI provider configured', status: 'pending' },
  { id: 'studio', label: 'MyClaw workspace installed', status: 'pending' },
  { id: 'studio-connected', label: 'Workspace connected to service', status: 'pending' }
]
