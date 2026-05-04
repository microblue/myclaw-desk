import type { StudioState } from '../../../shared/studio'

interface Props {
  studio: StudioState
  onRetry: () => void
}

const PHASE_COPY: Record<StudioState['phase'], string> = {
  idle: 'Preparing…',
  starting: 'Launching OpenClaw Studio…',
  ready: 'Studio is ready. Loading…',
  error: 'Studio failed to start.',
  stopped: 'Studio stopped.'
}

export function SplashView({ studio, onRetry }: Props): React.JSX.Element {
  const headline = studio.message ?? PHASE_COPY[studio.phase]
  return (
    <div className="hero min-h-full bg-base-200">
      <div className="hero-content w-full max-w-xl flex-col text-center">
        <h1 className="text-4xl font-bold">MyClaw.One Desktop</h1>
        <p className="text-base-content/70">{headline}</p>

        {studio.phase === 'starting' || studio.phase === 'ready' ? (
          <progress className="progress progress-primary w-full" />
        ) : null}

        {studio.logTail && studio.phase !== 'error' ? (
          <p className="font-mono text-xs text-base-content/50 truncate w-full">
            {studio.logTail}
          </p>
        ) : null}

        {studio.phase === 'error' ? (
          <div className="alert alert-error flex-col items-start text-left">
            <span className="font-semibold">Studio failed to start</span>
            <span className="font-mono text-xs whitespace-pre-wrap">
              {studio.error ?? 'Unknown error'}
            </span>
            <button className="btn btn-sm btn-neutral mt-2" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
