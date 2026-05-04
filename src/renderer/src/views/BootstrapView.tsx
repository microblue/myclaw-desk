import type { BootstrapState } from '../../../shared/bootstrap'

interface Props {
  state: BootstrapState
  onRetry: () => void
}

export function BootstrapView({ state, onRetry }: Props): React.JSX.Element {
  const indeterminate = state.progress < 0
  const pct = Math.round(Math.max(0, Math.min(1, state.progress)) * 100)

  return (
    <div className="hero min-h-full bg-base-200">
      <div className="hero-content w-full max-w-xl flex-col text-center">
        <h1 className="text-4xl font-bold">Setting up myclaw-desk</h1>
        <p className="text-base-content/70">{state.message}</p>

        {state.phase !== 'error' ? (
          indeterminate ? (
            <progress className="progress progress-primary w-full" />
          ) : (
            <progress className="progress progress-primary w-full" value={pct} max={100} />
          )
        ) : null}

        {state.logTail && state.phase !== 'error' ? (
          <p className="font-mono text-xs text-base-content/50 truncate w-full">
            {state.logTail}
          </p>
        ) : null}

        {state.phase === 'error' ? (
          <div className="alert alert-error flex-col items-start text-left">
            <span className="font-semibold">Install failed</span>
            <span className="font-mono text-xs whitespace-pre-wrap">{state.error}</span>
            <button className="btn btn-sm btn-neutral mt-2" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
