import { app } from 'electron'
import { EventEmitter } from 'events'
import * as os from 'os'
import { installLogger } from './installLogger'
import { getInstallId } from './installId'
import type { BootstrapState } from '../shared/bootstrap'
import type { InstallReportState } from '../shared/installReport'

// Override at runtime via env (tests + dev). Production uses the public
// MyClaw.One API. The `api.` subdomain has no DNS record — production
// reverse-proxies /api/* on the apex to the Hono backend. v0.1.0–v0.1.8
// shipped with `api.myclaw.one` and every crash report ENOTFOUND'd, so
// the install_reports table sat empty regardless of how many installs
// failed.
const REPORT_ENDPOINT =
  process.env.MYCLAW_DESK_REPORT_ENDPOINT || 'https://myclaw.one/api/install-reports'

const REPORT_TIMEOUT_MS = 15_000

/**
 * Reasons we'd skip auto-reporting. Sandboxed e2e tests must not spam the
 * production API; dev runs with NODE_ENV=development opt out so a developer
 * iterating on the bootstrap flow doesn't generate noise.
 */
function isReportingDisabled(): { disabled: boolean; reason?: string } {
  if (process.env.MYCLAW_DESK_DISABLE_REPORTS === '1') {
    return { disabled: true, reason: 'MYCLAW_DESK_DISABLE_REPORTS=1' }
  }
  // E2E sandboxes always set MYCLAW_DESK_USERDATA — never report from a
  // throwaway userData root.
  if (process.env.MYCLAW_DESK_USERDATA) {
    return { disabled: true, reason: 'sandbox userData (e2e)' }
  }
  if (process.env.NODE_ENV === 'development' && !process.env.MYCLAW_DESK_REPORT_ENDPOINT) {
    return { disabled: true, reason: 'dev mode (set MYCLAW_DESK_REPORT_ENDPOINT to override)' }
  }
  return { disabled: false }
}

class InstallReporter extends EventEmitter {
  private state: InstallReportState = { status: 'idle', attempts: 0 }
  private lastBootstrapState: BootstrapState | null = null
  private inflight: Promise<void> | null = null

  getState(): InstallReportState {
    return this.state
  }

  /**
   * Attempt to send a crash report for the given bootstrap error state.
   * Idempotent per error event — if a send is already in-flight, wait for it.
   * Subsequent calls (e.g. user clicking "Resend") trigger a fresh attempt.
   */
  async report(bootstrapState: BootstrapState): Promise<void> {
    if (bootstrapState.phase !== 'error') return
    const skip = isReportingDisabled()
    if (skip.disabled) {
      this.update({
        status: 'disabled',
        error: `Auto-report disabled: ${skip.reason}`,
        attempts: 0
      })
      return
    }
    this.lastBootstrapState = bootstrapState
    if (this.inflight) return this.inflight
    this.inflight = this.runReport(bootstrapState).finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  /** Manually retry the last report (UI button). No-op if there's nothing to send. */
  async resend(): Promise<InstallReportState> {
    if (!this.lastBootstrapState) return this.state
    await this.report(this.lastBootstrapState)
    return this.state
  }

  private async runReport(bootstrapState: BootstrapState): Promise<void> {
    this.update({
      status: 'sending',
      attempts: this.state.attempts + 1,
      lastAttemptAt: new Date().toISOString(),
      error: undefined
    })

    const payload = this.buildPayload(bootstrapState)

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS)
      let res: Response
      try {
        res = await fetch(REPORT_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': `MyClaw.One Desktop/${app.getVersion()} (${process.platform}-${process.arch})`
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        })
      } finally {
        clearTimeout(timer)
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}`)
      }
      const json = (await res.json().catch(() => null)) as {
        success: boolean
        data?: { reportId?: string }
        message?: string
      } | null
      const reportId = json?.data?.reportId
      installLogger.log({
        source: 'reporter',
        level: 'info',
        text: reportId
          ? `Crash report accepted by api.myclaw.one (id=${reportId})`
          : 'Crash report accepted by api.myclaw.one'
      })
      this.update({ status: 'sent', reportId, error: undefined })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      installLogger.log({
        source: 'reporter',
        level: 'error',
        text: `Failed to submit crash report: ${message}`
      })
      this.update({ status: 'failed', error: message })
    }
  }

  private buildPayload(bootstrapState: BootstrapState): Record<string, unknown> {
    const stack = bootstrapState.error?.includes('\n at ') ? bootstrapState.error : null
    return {
      installId: getInstallId(),
      desktopVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      nodeVersion: process.version,
      hostname: os.hostname(),
      username: os.userInfo().username,
      bootstrapPhase: bootstrapState.phase,
      error: {
        message: bootstrapState.error || 'Unknown error',
        stack
      },
      logs: installLogger.snapshot().map((l) => {
        const phase = l.phase ? `[${l.phase}]` : ''
        return `${l.ts} ${l.level.toUpperCase()} [${l.source}]${phase} ${l.text}`
      }),
      envInfo: {
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
        v8Version: process.versions.v8,
        locale: app.getLocale(),
        totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
        freeMemMb: Math.round(os.freemem() / 1024 / 1024),
        cpus: os.cpus().length,
        homedir: os.homedir(),
        bootstrapMessage: bootstrapState.message
      }
    }
  }

  private update(patch: Partial<InstallReportState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.state)
  }
}

export const installReporter = new InstallReporter()
