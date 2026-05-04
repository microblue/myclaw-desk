import type { BootstrapState } from '../../../shared/bootstrap'
import type { StudioState } from '../../../shared/studio'

interface Props {
  bootstrap: BootstrapState
  studio: StudioState
  onRetry: () => void
}

interface DisplayState {
  headline: string
  log?: string
  errorTitle?: string
  errorBody?: string
  indeterminate: boolean
  progress: number
}

const BOOTSTRAP_COPY: Record<BootstrapState['phase'], string> = {
  idle: 'Preparing…',
  detecting: 'Checking for an existing OpenClaw gateway…',
  preparing: 'Preparing install directory…',
  installing: 'Installing OpenClaw (first launch only — this can take a minute)…',
  'starting-gateway': 'Starting OpenClaw gateway…',
  ready: 'Gateway ready.',
  error: 'Bootstrap failed.'
}

const STUDIO_COPY: Record<StudioState['phase'], string> = {
  idle: 'Preparing Studio…',
  starting: 'Launching MyClaw Studio…',
  ready: 'Studio is ready. Loading…',
  error: 'Studio failed to start.',
  stopped: 'Studio stopped.'
}

function project(bootstrap: BootstrapState, studio: StudioState): DisplayState {
  if (bootstrap.phase === 'error') {
    return {
      headline: BOOTSTRAP_COPY.error,
      errorTitle: 'OpenClaw bootstrap failed',
      errorBody: bootstrap.error ?? 'Unknown error',
      indeterminate: false,
      progress: 0
    }
  }
  if (bootstrap.phase !== 'ready') {
    return {
      headline: bootstrap.message ?? BOOTSTRAP_COPY[bootstrap.phase],
      log: bootstrap.logTail,
      indeterminate: bootstrap.progress < 0,
      progress: Math.round(Math.max(0, Math.min(1, bootstrap.progress)) * 100)
    }
  }
  // Bootstrap done; reflect studio state.
  if (studio.phase === 'error') {
    return {
      headline: STUDIO_COPY.error,
      errorTitle: 'Studio failed to start',
      errorBody: studio.error ?? 'Unknown error',
      indeterminate: false,
      progress: 0
    }
  }
  return {
    headline: studio.message ?? STUDIO_COPY[studio.phase],
    log: studio.logTail,
    indeterminate: studio.phase === 'starting' || studio.phase === 'ready',
    progress: studio.phase === 'ready' ? 100 : 0
  }
}

export function SplashView({ bootstrap, studio, onRetry }: Props): React.JSX.Element {
  const view = project(bootstrap, studio)
  const showError = !!view.errorTitle

  return (
    <div className="hero min-h-full bg-base-200">
      <div className="hero-content w-full max-w-xl flex-col text-center">
        <h1 className="text-4xl font-bold">MyClaw.One Desktop</h1>
        <p className="text-base-content/70">{view.headline}</p>

        {!showError ? (
          view.indeterminate ? (
            <progress className="progress progress-primary w-full" />
          ) : (
            <progress
              className="progress progress-primary w-full"
              value={view.progress}
              max={100}
            />
          )
        ) : null}

        {view.log && !showError ? (
          <p className="font-mono text-xs text-base-content/50 truncate w-full">{view.log}</p>
        ) : null}

        {showError ? (
          <div className="alert alert-error flex-col items-start text-left">
            <span className="font-semibold">{view.errorTitle}</span>
            <span className="font-mono text-xs whitespace-pre-wrap">{view.errorBody}</span>
            <button className="btn btn-sm btn-neutral mt-2" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
