import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, stat, writeFile } from 'fs/promises'
import { EventEmitter } from 'events'
import { getPaths } from './paths'
import {
  isPortListening,
  startManagedGateway,
  type ManagedGatewayHandle
} from './daemon'
import type { BootstrapState } from '../../shared/bootstrap'

export type { BootstrapState } from '../../shared/bootstrap'

const NPM_INSTALL_TIMEOUT_MS = 10 * 60 * 1000

class Bootstrapper extends EventEmitter {
  private state: BootstrapState = {
    phase: 'idle',
    progress: 0,
    message: 'Waiting…'
  }

  private inflight: Promise<BootstrapState> | null = null
  private managedGateway: ManagedGatewayHandle | null = null

  getState(): BootstrapState {
    return this.state
  }

  /** Idempotent: re-entrant calls return the in-flight promise. After 'ready',
   * subsequent calls short-circuit. */
  async ensureReady(): Promise<BootstrapState> {
    if (this.state.phase === 'ready') return this.state
    if (this.inflight) return this.inflight
    this.inflight = this.run().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  /** Stop the managed gateway child if we own one. Called on app quit. */
  shutdown(): void {
    if (this.managedGateway) {
      this.managedGateway.stop()
      this.managedGateway = null
    }
  }

  private async run(): Promise<BootstrapState> {
    try {
      const paths = getPaths()

      this.update({
        phase: 'detecting',
        progress: 0.05,
        message: 'Checking for an existing OpenClaw gateway…'
      })

      // Step 1: if a gateway is already responding on our configured port,
      // we're done. Covers two cases: the user runs OpenClaw via systemd
      // outside our control, or we restarted the app while our managed child
      // is still alive in another process tree.
      if (await isPortListening(paths.gatewayPort, '127.0.0.1', 1500)) {
        this.update({
          phase: 'ready',
          progress: 1,
          message: 'OpenClaw gateway already running.',
          gatewayUrl: paths.gatewayUrl
        })
        return this.state
      }

      // Step 2: ensure we have an openclaw CLI to spawn.
      const haveBinOverride = !!process.env.MYCLAW_DESK_OPENCLAW_BIN
      const haveInstall = await fileExists(paths.installMarker)
      if (!haveBinOverride && !haveInstall) {
        this.update({
          phase: 'preparing',
          progress: 0.15,
          message: 'Preparing install directory…'
        })
        await mkdir(paths.runtime, { recursive: true })

        this.update({
          phase: 'installing',
          progress: -1,
          message: 'Installing OpenClaw (this can take a minute on first launch)…'
        })
        await this.runNpmInstall()
        await writeFile(paths.installMarker, new Date().toISOString(), 'utf8')
      }

      if (!existsSync(paths.openclaw.existsAt)) {
        throw new Error(
          `OpenClaw CLI not found at ${paths.openclaw.existsAt}. Set MYCLAW_DESK_OPENCLAW_BIN or rerun install.`
        )
      }

      // Step 3: spawn managed gateway and wait for the port to listen.
      this.update({
        phase: 'starting-gateway',
        progress: 0.85,
        message: 'Starting OpenClaw gateway…'
      })
      this.managedGateway = await startManagedGateway({
        openclaw: paths.openclaw,
        port: paths.gatewayPort,
        stateDir: paths.stateDir,
        onLog: (line) => this.update({ logTail: line })
      })

      this.update({
        phase: 'ready',
        progress: 1,
        message: 'OpenClaw gateway is ready.',
        gatewayUrl: this.managedGateway.url
      })
      return this.state
    } catch (err) {
      this.shutdown()
      const message = err instanceof Error ? err.message : String(err)
      this.update({ phase: 'error', progress: 0, message: 'Bootstrap failed.', error: message })
      return this.state
    }
  }

  private runNpmInstall(): Promise<void> {
    const paths = getPaths()
    const useBundledNpmCli = !!paths.npmCli
    const cmd = useBundledNpmCli ? paths.nodeBin : 'npm'
    const argv = useBundledNpmCli
      ? [paths.npmCli, 'install', '--prefix', paths.runtime, '--no-audit', '--no-fund', 'openclaw@latest']
      : ['install', '--prefix', paths.runtime, '--no-audit', '--no-fund', 'openclaw@latest']

    return new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, argv, {
        cwd: paths.runtime,
        env: { ...process.env, npm_config_yes: 'true' },
        stdio: ['ignore', 'pipe', 'pipe']
      })

      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`npm install timed out after ${NPM_INSTALL_TIMEOUT_MS / 1000}s`))
      }, NPM_INSTALL_TIMEOUT_MS)

      const onData = (buf: Buffer): void => {
        const tail = buf.toString('utf8').split(/\r?\n/).filter(Boolean).pop()
        if (tail) this.update({ logTail: tail })
      }
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onData)

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

  private update(patch: Partial<BootstrapState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.state)
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
