import { spawn } from 'child_process'
import { mkdir, stat, writeFile } from 'fs/promises'
import { EventEmitter } from 'events'
import { getPaths } from './paths'
import type { BootstrapState } from '../../shared/bootstrap'

export type { BootstrapState } from '../../shared/bootstrap'

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000

class Bootstrapper extends EventEmitter {
  private state: BootstrapState = {
    phase: 'idle',
    progress: 0,
    message: 'Waiting…'
  }

  private inflight: Promise<BootstrapState> | null = null

  getState(): BootstrapState {
    return this.state
  }

  private update(patch: Partial<BootstrapState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.state)
  }

  /**
   * Idempotent: if the install marker exists we short-circuit to 'ready'.
   * If a run is in flight, callers receive the same promise.
   */
  async ensureInstalled(): Promise<BootstrapState> {
    if (this.state.phase === 'ready') return this.state
    if (this.inflight) return this.inflight
    this.inflight = this.run().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  private async run(): Promise<BootstrapState> {
    try {
      this.update({ phase: 'checking', progress: 0.05, message: 'Checking local OpenClaw…' })

      const paths = getPaths()
      if (await fileExists(paths.installMarker)) {
        this.update({ phase: 'ready', progress: 1, message: 'OpenClaw is installed.' })
        return this.state
      }

      this.update({ phase: 'preparing', progress: 0.15, message: 'Preparing install directory…' })
      await mkdir(paths.runtime, { recursive: true })

      this.update({
        phase: 'installing',
        progress: -1,
        message: 'Installing OpenClaw (this can take a minute)…'
      })

      await this.runNpmInstall()

      await writeFile(paths.installMarker, new Date().toISOString(), 'utf8')
      this.update({ phase: 'ready', progress: 1, message: 'OpenClaw is installed.' })
      return this.state
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.update({ phase: 'error', progress: 0, message: 'Install failed.', error: message })
      return this.state
    }
  }

  private runNpmInstall(): Promise<void> {
    const paths = getPaths()
    const args = paths.npmCli
      ? [paths.npmCli, 'install', '--prefix', paths.runtime, '--no-audit', '--no-fund', 'openclaw@latest']
      : ['npm', 'install', '--prefix', paths.runtime, '--no-audit', '--no-fund', 'openclaw@latest']
    const cmd = paths.npmCli ? paths.nodeBin : 'npm'
    const argv = paths.npmCli ? args : args.slice(1)

    return new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, argv, {
        cwd: paths.runtime,
        env: { ...process.env, npm_config_yes: 'true' },
        stdio: ['ignore', 'pipe', 'pipe']
      })

      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`npm install timed out after ${INSTALL_TIMEOUT_MS}ms`))
      }, INSTALL_TIMEOUT_MS)

      const onData = (buf: Buffer): void => {
        const tail = buf.toString('utf8').split(/\r?\n/).filter(Boolean).pop()
        if (tail) this.update({ logTail: tail })
      }
      child.stdout.on('data', onData)
      child.stderr.on('data', onData)

      child.once('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve()
        else reject(new Error(`npm install exited with code ${code}`))
      })
    })
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

export const bootstrapper = new Bootstrapper()
