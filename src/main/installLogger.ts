import { app } from 'electron'
import { EventEmitter } from 'events'
import { createWriteStream, mkdirSync, type WriteStream } from 'fs'
import { join } from 'path'
import type { InstallLogLine } from '../shared/installReport'

const MAX_BUFFER_LINES = 500
const MAX_LINE_BYTES = 4096

class InstallLogger extends EventEmitter {
  private buffer: InstallLogLine[] = []
  private fileStream: WriteStream | null = null
  // Resolved lazily on first write so we pick up app.setPath('userData', …)
  // — main/index.ts redirects userData via MYCLAW_DESK_USERDATA before
  // app.whenReady, but module import order means this class is constructed
  // before that redirect runs. Eager resolution captured the unsandboxed
  // ~/.config/<app>/install.log; lazy resolution sees the sandbox path.
  private logFile: string | null = null

  /**
   * Append a structured line. Ignores empty / whitespace-only text. Truncates
   * long lines so a chatty subprocess can't blow our memory budget. Each line
   * is also persisted to userData/install.log so a power user can grep it
   * post-mortem (and so the log survives an Electron crash).
   */
  log(input: {
    source: InstallLogLine['source']
    level?: InstallLogLine['level']
    phase?: string
    text: string
  }): void {
    const text = input.text?.trim()
    if (!text) return
    const truncated = text.length > MAX_LINE_BYTES ? text.slice(0, MAX_LINE_BYTES) : text
    const line: InstallLogLine = {
      ts: new Date().toISOString(),
      source: input.source,
      level: input.level ?? 'info',
      phase: input.phase,
      text: truncated
    }

    this.buffer.push(line)
    if (this.buffer.length > MAX_BUFFER_LINES) this.buffer.shift()

    this.emit('line', line)
    this.appendToFile(line)
  }

  /** Snapshot of recent lines for inclusion in a crash report. */
  snapshot(): InstallLogLine[] {
    return [...this.buffer]
  }

  /** Path to the persisted log — exposed so the renderer can show it / let
   * the user open it. Resolves lazily, see logFile field comment. */
  getLogFile(): string {
    return this.resolveLogFile()
  }

  private resolveLogFile(): string {
    if (this.logFile) return this.logFile
    const dir = app.getPath('userData')
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      // best-effort
    }
    this.logFile = join(dir, 'install.log')
    return this.logFile
  }

  private appendToFile(line: InstallLogLine): void {
    if (!this.fileStream) {
      try {
        this.fileStream = createWriteStream(this.resolveLogFile(), { flags: 'a' })
        this.fileStream.on('error', (err) => {
          console.warn('[installLogger] file stream error', err)
          this.fileStream = null
        })
      } catch (err) {
        console.warn('[installLogger] failed to open log file', err)
        return
      }
    }
    try {
      this.fileStream.write(`${JSON.stringify(line)}\n`)
    } catch {
      // best-effort; in-memory ring buffer is the primary record
    }
  }
}

export const installLogger = new InstallLogger()
