import { useEffect, useState } from 'react'
import type { BootstrapState, BootstrapCheck, CheckStatus } from '../../../shared/bootstrap'
import { DEFAULT_CHECKS } from '../../../shared/bootstrap'
import type { InstallReportState, InstallLogLine } from '../../../shared/installReport'

interface Props {
  state: BootstrapState
  onRetry: () => void
}

// Friendly title per phase. Pretty + concrete; the splash already shows the
// raw `state.message` underneath, so this stays short.
const PHASE_TITLES: Record<string, string> = {
  idle: 'Getting ready…',
  detecting: 'Looking for an existing install',
  preparing: 'Preparing your machine',
  installing: 'Downloading MyClaw',
  'verifying-openclaw': 'Verifying MyClaw engine',
  'starting-gateway': 'Starting MyClaw service',
  'configuring-provider': 'Configuring AI provider',
  'verifying-studio': 'Verifying MyClaw workspace',
  ready: 'Ready — opening workspace',
  error: 'Install failed'
}

export function BootstrapView({ state, onRetry }: Props): React.JSX.Element {
  const indeterminate = state.progress < 0
  const pct = Math.round(Math.max(0, Math.min(1, state.progress)) * 100)
  const isError = state.phase === 'error'
  const checks = state.checks ?? DEFAULT_CHECKS
  const phaseTitle = PHASE_TITLES[state.phase] ?? state.phase

  const [report, setReport] = useState<InstallReportState>({
    status: 'idle',
    attempts: 0
  })
  const [log, setLog] = useState<InstallLogLine[]>([])
  const [showLog, setShowLog] = useState(false)

  // Subscribe to report state + log lines. The log feed also drives the
  // tiny scrolling status under the progress bar — gives the splash some
  // life while npm install / `next build` are doing their thing.
  useEffect(() => {
    void window.api.installReport.getState().then(setReport)
    void window.api.installReport.getLog().then(setLog)
    const offState = window.api.installReport.onStateChanged(setReport)
    const offLog = window.api.installReport.onLogAppended((line) =>
      setLog((prev) => [...prev.slice(-499), line])
    )
    return () => {
      offState()
      offLog()
    }
  }, [])

  const onCopyLog = async (): Promise<void> => {
    const text = log
      .map(
        (l) =>
          `${l.ts} ${l.level.toUpperCase()} [${l.source}]${l.phase ? '[' + l.phase + ']' : ''} ${l.text}`
      )
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // best-effort; the inline log is also selectable
    }
  }

  const onResendReport = async (): Promise<void> => {
    const next = await window.api.installReport.resend()
    setReport(next)
  }

  return (
    <div className="relative min-h-full overflow-hidden bg-base-200">
      <AnimatedBackdrop />
      <div className="hero relative min-h-full">
        <div className="hero-content w-full max-w-2xl flex-col">
          <BrandHeader />

          <div className="text-center">
            <h2 className="text-2xl font-semibold tracking-tight">{phaseTitle}</h2>
            <p className="mt-1 min-h-6 text-sm text-base-content/70">{state.message}</p>
          </div>

          {/* Progress bar with % label. Indeterminate during npm install. */}
          {!isError ? (
            <div className="w-full max-w-md">
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-base-300">
                {indeterminate ? (
                  <div className="absolute inset-y-0 -left-1/3 h-full w-1/3 animate-[shimmer_1.4s_linear_infinite] rounded-full bg-gradient-to-r from-transparent via-primary to-transparent" />
                ) : (
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                )}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-base-content/60">
                <span className="inline-flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                  </span>
                  <span className="truncate font-mono">{state.logTail || '…'}</span>
                </span>
                <span className="font-mono tabular-nums">{indeterminate ? '—' : `${pct}%`}</span>
              </div>
            </div>
          ) : null}

          {/* The 5 acceptance gates as a checklist. Drives the user's
              confidence — they can see which step is currently working
              and which ones already passed. */}
          <Checklist checks={checks} />

          {isError ? (
            <ErrorPanel
              error={state.error}
              onRetry={onRetry}
              report={report}
              log={log}
              showLog={showLog}
              setShowLog={setShowLog}
              onCopyLog={onCopyLog}
              onResendReport={onResendReport}
            />
          ) : (
            <p className="mt-2 text-center text-xs text-base-content/40">
              MyClaw engine {opt(checks.find((c) => c.id === 'openclaw')?.detail)}
            </p>
          )}
        </div>
      </div>

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(0); }
          100% { transform: translateX(400%); }
        }
        @keyframes float {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.55; }
          50% { transform: translate(20px, -30px) scale(1.05); opacity: 0.8; }
        }
        @keyframes float2 {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.45; }
          50% { transform: translate(-30px, 20px) scale(1.08); opacity: 0.65; }
        }
        .marquee-mask {
          mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
          -webkit-mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
        }
      `}</style>
    </div>
  )
}

function opt(s: string | undefined): string {
  return s ? `(${s})` : ''
}

function BrandHeader(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative mb-3">
        <div className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-primary/40 to-secondary/40 blur-xl" />
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-base-100 shadow-md ring-1 ring-base-content/10">
          <span className="text-3xl font-black bg-gradient-to-br from-primary to-secondary bg-clip-text text-transparent">
            M
          </span>
        </div>
      </div>
      <h1 className="text-3xl font-bold tracking-tight">MyClaw.One Desktop</h1>
      <p className="text-xs uppercase tracking-widest text-base-content/50">
        setting things up for you
      </p>
    </div>
  )
}

function AnimatedBackdrop(): React.JSX.Element {
  // Two soft blobs floating in the background — give the splash motion
  // without being noisy. CSS-only, no JS animation cost.
  return (
    <>
      <div
        className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/30 blur-3xl"
        style={{ animation: 'float 8s ease-in-out infinite' }}
      />
      <div
        className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-secondary/30 blur-3xl"
        style={{ animation: 'float2 10s ease-in-out infinite' }}
      />
    </>
  )
}

function Checklist({ checks }: { checks: BootstrapCheck[] }): React.JSX.Element {
  return (
    <ul className="mt-2 w-full max-w-md space-y-1.5">
      {checks.map((c) => (
        <ChecklistRow key={c.id} check={c} />
      ))}
    </ul>
  )
}

function ChecklistRow({ check }: { check: BootstrapCheck }): React.JSX.Element {
  const tone = toneFor(check.status)
  return (
    <li
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${tone.row}`}
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${tone.iconBg}`}
      >
        <StatusIcon status={check.status} />
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-medium ${tone.label}`}>{check.label}</div>
        {check.detail ? (
          <div className="truncate font-mono text-[11px] text-base-content/50">{check.detail}</div>
        ) : null}
      </div>
    </li>
  )
}

function StatusIcon({ status }: { status: CheckStatus }): React.JSX.Element {
  if (status === 'ok') {
    return (
      <svg
        className="h-3.5 w-3.5 text-success-content"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
          clipRule="evenodd"
        />
      </svg>
    )
  }
  if (status === 'failed') {
    return (
      <svg
        className="h-3.5 w-3.5 text-error-content"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-11.707a1 1 0 010 1.414L11.414 10l2.293 2.293a1 1 0 01-1.414 1.414L10 11.414l-2.293 2.293a1 1 0 11-1.414-1.414L8.586 10 6.293 7.707a1 1 0 011.414-1.414L10 8.586l2.293-2.293a1 1 0 011.414 0z"
          clipRule="evenodd"
        />
      </svg>
    )
  }
  if (status === 'warn') {
    return (
      <svg
        className="h-3.5 w-3.5 text-warning-content"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M8.485 2.495a1.75 1.75 0 013.03 0l6.28 10.875A1.75 1.75 0 0116.28 16H3.72a1.75 1.75 0 01-1.515-2.63L8.485 2.495zM10 7a1 1 0 00-1 1v3a1 1 0 002 0V8a1 1 0 00-1-1zm0 7a1 1 0 100-2 1 1 0 000 2z"
          clipRule="evenodd"
        />
      </svg>
    )
  }
  if (status === 'active') {
    return (
      <svg
        className="h-3.5 w-3.5 animate-spin text-primary-content"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="10"
          cy="10"
          r="7"
          stroke="currentColor"
          strokeWidth="3"
          strokeDasharray="14 30"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  // pending
  return <span className="h-2 w-2 rounded-full bg-base-content/30" aria-hidden="true" />
}

function toneFor(status: CheckStatus): {
  row: string
  iconBg: string
  label: string
} {
  switch (status) {
    case 'ok':
      return {
        row: 'border-success/40 bg-success/10',
        iconBg: 'bg-success',
        label: 'text-base-content'
      }
    case 'active':
      return {
        row: 'border-primary/50 bg-primary/10',
        iconBg: 'bg-primary',
        label: 'text-base-content'
      }
    case 'failed':
      return {
        row: 'border-error/50 bg-error/10',
        iconBg: 'bg-error',
        label: 'text-base-content'
      }
    case 'warn':
      return {
        row: 'border-warning/50 bg-warning/10',
        iconBg: 'bg-warning',
        label: 'text-base-content'
      }
    default:
      return {
        row: 'border-base-content/10 bg-base-100/50',
        iconBg: 'bg-base-300',
        label: 'text-base-content/60'
      }
  }
}

function ErrorPanel({
  error,
  onRetry,
  report,
  log,
  showLog,
  setShowLog,
  onCopyLog,
  onResendReport
}: {
  error: string | undefined
  onRetry: () => void
  report: InstallReportState
  log: InstallLogLine[]
  showLog: boolean
  setShowLog: (fn: (prev: boolean) => boolean) => void
  onCopyLog: () => void
  onResendReport: () => void
}): React.JSX.Element {
  return (
    <div className="alert alert-error mt-4 w-full max-w-md flex-col items-start text-left">
      <span className="font-semibold">Install failed</span>
      <span className="font-mono text-xs whitespace-pre-wrap break-all">{error}</span>

      <ReportStatus state={report} onResend={onResendReport} />

      <div className="mt-2 flex flex-wrap gap-2">
        <button className="btn btn-sm btn-neutral" onClick={onRetry}>
          Retry install
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => setShowLog((v) => !v)}>
          {showLog ? 'Hide log' : `Show log (${log.length} lines)`}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onCopyLog}>
          Copy log
        </button>
      </div>

      {showLog ? (
        <pre className="mt-2 max-h-64 w-full overflow-auto rounded bg-base-300 p-2 font-mono text-[11px] leading-tight text-base-content/80">
          {log
            .map(
              (l) =>
                `${l.ts} ${l.level.toUpperCase().padEnd(5)} [${l.source}]${l.phase ? '[' + l.phase + ']' : ''} ${l.text}`
            )
            .join('\n') || '(no log lines yet)'}
        </pre>
      ) : null}
    </div>
  )
}

function ReportStatus({
  state,
  onResend
}: {
  state: InstallReportState
  onResend: () => void
}): React.JSX.Element | null {
  if (state.status === 'idle') return null
  const map = {
    sending: { label: 'Sending crash report to MyClaw.One…', cls: 'text-base-content/70' },
    sent: {
      label: state.reportId ? `Crash report sent · id=${state.reportId}` : 'Crash report sent',
      cls: 'text-success'
    },
    failed: {
      label: `Failed to send crash report: ${state.error ?? 'unknown error'}`,
      cls: 'text-warning'
    },
    disabled: {
      label: state.error ?? 'Crash reports disabled',
      cls: 'text-base-content/50'
    }
  } as const
  const entry = map[state.status as keyof typeof map]
  return (
    <div className="mt-2 flex items-center gap-2 text-xs">
      <span className={entry.cls}>{entry.label}</span>
      {state.status === 'failed' ? (
        <button className="btn btn-xs btn-ghost" onClick={onResend}>
          Retry
        </button>
      ) : null}
    </div>
  )
}
