import { spawn } from 'child_process'
import { existsSync, readFileSync, symlinkSync } from 'fs'
import { mkdir, stat, writeFile } from 'fs/promises'
import { EventEmitter } from 'events'
import { dirname, join } from 'path'
import { getPaths, resetPathsCache } from './paths'
import { isPortListening, startManagedGateway, type ManagedGatewayHandle } from './daemon'
import { installLogger } from '../installLogger'
import {
  DEFAULT_CHECKS,
  OPENCLAW_VERSION,
  type BootstrapCheck,
  type BootstrapState
} from '../../shared/bootstrap'

export type { BootstrapState } from '../../shared/bootstrap'

const NPM_INSTALL_TIMEOUT_MS = 10 * 60 * 1000

// Env vars that indicate the user has at least one LLM provider configured.
// OpenClaw auto-discovers providers from these env vars at gateway startup
// (no config file). If none of them is set, the LLM gate fails with an
// actionable hint instead of letting the user reach Studio and find chat
// silently broken.
const PROVIDER_ENV_VARS = [
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY'
] as const

// Build-time injected via electron.vite.config.ts:define. Empty string when
// the build didn't have BUNDLED_OPENROUTER_KEY set (local dev, forks).
declare const __BUNDLED_OPENROUTER_KEY__: string
const BUNDLED_OPENROUTER_KEY: string =
  typeof __BUNDLED_OPENROUTER_KEY__ === 'string' ? __BUNDLED_OPENROUTER_KEY__ : ''

class Bootstrapper extends EventEmitter {
  private state: BootstrapState = {
    phase: 'idle',
    progress: 0,
    message: 'Waiting…',
    checks: DEFAULT_CHECKS.map((c) => ({ ...c }))
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

      // Snapshot the resolved runtime paths so install reports document what
      // the user's machine actually saw — particularly helpful for Windows
      // packaging issues where the bundled node may be missing.
      installLogger.log({
        source: 'bootstrap',
        phase: 'idle',
        text: `paths: nodeBin=${paths.nodeBin} npmCli=${paths.npmCli || '(none)'} runtime=${paths.runtime} resourcesPath=${process.resourcesPath ?? '(none)'}`
      })

      this.update({
        phase: 'detecting',
        progress: 0.05,
        message: 'Checking for an existing MyClaw service…'
      })

      // Step 1: if a gateway is already responding on our configured port,
      // we trust it — mark all gates green except studio-connected (which
      // depends on the studio process starting later, in main/index.ts) and
      // exit early. Covers the case where the user runs OpenClaw via systemd
      // outside our control.
      if (await isPortListening(paths.gatewayPort, '127.0.0.1', 1500)) {
        this.markCheck('openclaw', 'ok', 'pre-existing install')
        this.markCheck('gateway', 'ok', `listening on :${paths.gatewayPort}`)
        this.markCheck('studio', existsSync(join(paths.runtime, '..')) ? 'ok' : 'ok')
        this.runProviderCheck()
        this.update({
          phase: 'ready',
          progress: 1,
          message: 'MyClaw service already running.',
          gatewayUrl: paths.gatewayUrl
        })
        return this.state
      }

      // Step 2: locate openclaw. Three resolutions, in priority order:
      //   1. MYCLAW_DESK_OPENCLAW_BIN env override (e2e / dev).
      //   2. Bundled openclaw shipped with the installer (the prod path
      //      since v0.1.17). This eliminates the runtime-install failure
      //      surface entirely.
      //   3. Legacy: the runtime npm-install dir, if a previous build had
      //      already populated it. Falls through to installing if absent.
      const haveBinOverride = !!process.env.MYCLAW_DESK_OPENCLAW_BIN
      const haveBundled = !!paths.bundledOpenclawDir
      const haveInstall = await fileExists(paths.installMarker)
      if (haveBinOverride) {
        this.markCheck('openclaw', 'ok', 'env override')
      } else if (haveBundled) {
        const bundledVersion = this.detectVersionAt(
          join(paths.bundledOpenclawDir, 'vendor_modules', 'openclaw')
        )
        this.markCheck('openclaw', 'ok', bundledVersion ? `${bundledVersion} (bundled)` : 'bundled')
      } else if (haveInstall) {
        this.markCheck(
          'openclaw',
          'ok',
          this.detectVersionAt(join(paths.runtime, 'node_modules', 'openclaw'))
        )
      } else {
        this.update({
          phase: 'preparing',
          progress: 0.15,
          message: 'Preparing install directory…'
        })
        await mkdir(paths.runtime, { recursive: true })

        this.update({
          phase: 'installing',
          progress: -1,
          message: `Installing MyClaw engine ${OPENCLAW_VERSION}…`
        })
        this.markCheck('openclaw', 'active', `installing v${OPENCLAW_VERSION}`)
        await this.runNpmInstall()
        await writeFile(paths.installMarker, new Date().toISOString(), 'utf8')
        this.markCheck(
          'openclaw',
          'ok',
          this.detectVersionAt(join(paths.runtime, 'node_modules', 'openclaw'))
        )
      }

      // Step 3: confirm the resolved CLI entry point exists. After install
      // we must reset the paths cache — the JS bin path is read from the
      // freshly-installed openclaw/package.json.
      resetPathsCache()
      const fresh = getPaths()
      if (!existsSync(fresh.openclaw.existsAt)) {
        this.markCheck('openclaw', 'failed', `engine not found at ${fresh.openclaw.existsAt}`)
        throw new Error(
          `MyClaw engine not found at ${fresh.openclaw.existsAt}. Reinstall or rerun.`
        )
      }

      // Make `<bundle>/node_modules` resolvable for any ESM imports openclaw
      // does internally (ESM module resolution intentionally ignores
      // NODE_PATH and only walks parent node_modules dirs). Same junction
      // trick we apply to the bundled studio in main/studio/process.ts.
      if (fresh.bundledOpenclawDir) {
        ensureVendorModulesSymlink(fresh.bundledOpenclawDir)
      }

      // Seed a default openclaw.json on first run so the gateway uses our
      // bundled OpenRouter key (rather than its hardcoded openai/gpt-5.5
      // default, which fails with "No API key for openai" since we only
      // inject OPENROUTER_API_KEY). No-op if the user already has a config.
      await ensureDefaultConfig(fresh.stateDir)

      // Step 4: spawn managed gateway and wait for the port to listen.
      this.update({
        phase: 'starting-gateway',
        progress: 0.7,
        message: 'Starting MyClaw service…'
      })
      this.markCheck('gateway', 'active', `binding :${fresh.gatewayPort}…`)
      // Hand the bundled OpenRouter key to the gateway as an env var. Only
      // applies when no user-set key was already in process.env — we don't
      // want the bundled fallback to clobber an env var the user explicitly
      // configured. openclaw auto-discovers from env at startup.
      const extraEnv: Record<string, string> = {}
      if (BUNDLED_OPENROUTER_KEY && !process.env.OPENROUTER_API_KEY) {
        extraEnv.OPENROUTER_API_KEY = BUNDLED_OPENROUTER_KEY
      }
      this.managedGateway = await startManagedGateway({
        openclaw: fresh.openclaw,
        port: fresh.gatewayPort,
        stateDir: fresh.stateDir,
        extraEnv,
        onLog: (line) => {
          this.update({ logTail: line })
          installLogger.log({ source: 'gateway', text: line, phase: this.state.phase })
        }
      })
      this.markCheck('gateway', 'ok', `listening on :${fresh.gatewayPort}`)

      // Step 5: provider check. Quick env-var probe — openclaw auto-discovers
      // providers from these at gateway startup (no config file involved).
      this.update({
        phase: 'configuring-provider',
        progress: 0.85,
        message: 'Checking AI provider configuration…'
      })
      this.runProviderCheck()

      // Step 6: studio embedded build verification. The studio prod tree is
      // shipped under <resourcesPath>/studio/.next/BUILD_ID — present means
      // `next start` will boot. (In dev/e2e it falls back to `next dev`,
      // which the studio process handles independently.)
      this.update({
        phase: 'verifying-studio',
        progress: 0.95,
        message: 'Verifying MyClaw workspace…'
      })
      this.runStudioCheck()

      // The 'studio-connected' gate flips when main/index.ts swaps the window
      // URL to the studio. We seed it as 'active' here so the splash UI
      // shows progress on the last gate while the studio child boots.
      this.markCheck('studio-connected', 'active', 'waiting for Studio…')

      this.update({
        phase: 'ready',
        progress: 1,
        message: 'MyClaw service is ready.',
        gatewayUrl: this.managedGateway.url
      })
      return this.state
    } catch (err) {
      this.shutdown()
      const message = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      installLogger.log({
        source: 'bootstrap',
        level: 'error',
        phase: this.state.phase,
        text: stack || message
      })
      this.update({
        phase: 'error',
        progress: 0,
        message: 'Bootstrap failed.',
        error: stack || message
      })
      return this.state
    }
  }

  /**
   * Surface from the renderer when the user navigates the window onto the
   * Studio URL. Called from main/index.ts so the bootstrap state remains the
   * single source of truth for the splash checklist.
   */
  markStudioConnected(detail?: string): void {
    this.markCheck('studio-connected', 'ok', detail ?? 'connected')
  }

  /**
   * Pipe Studio's latest stdout line into the studio-connected gate's
   * detail + the global logTail. Gives the user real-time visibility into
   * "Compiling…", "Ready in 12s", etc. instead of staring at a static
   * "waiting for Studio…" while Next.js takes its time.
   */
  setStudioActivity(line: string): void {
    if (this.state.phase !== 'ready') return
    if (this.state.checks?.find((c) => c.id === 'studio-connected')?.status === 'ok') return
    const trimmed = line.trim()
    if (!trimmed) return
    this.markCheck('studio-connected', 'active', trimmed)
    this.update({ logTail: trimmed })
  }

  markStudioFailed(detail: string): void {
    this.markCheck('studio-connected', 'failed', detail)
  }

  /**
   * Probe well-known env vars for at least one LLM provider key. We don't
   * try to auto-write keys — that needs sourcing infra (managed by
   * MyClaw.One) we haven't built yet. Surfacing the gate as 'warn' with an
   * actionable hint is the honest behavior.
   */
  private runProviderCheck(): void {
    const fromEnv = PROVIDER_ENV_VARS.filter((k) => !!process.env[k])
    if (fromEnv.length > 0) {
      this.markCheck(
        'provider',
        'ok',
        `${fromEnv.length} provider${fromEnv.length > 1 ? 's' : ''} via env (${fromEnv.join(', ')})`
      )
    } else if (BUNDLED_OPENROUTER_KEY) {
      this.markCheck('provider', 'ok', 'OpenRouter (bundled with installer)')
    } else {
      this.markCheck(
        'provider',
        'warn',
        'No AI provider key detected — set OPENROUTER_API_KEY (or ANTHROPIC_API_KEY) before chat'
      )
    }
  }

  private runStudioCheck(): void {
    // Match the resolution rules in main/studio/process.ts: prefer the
    // packaged studio under resourcesPath; fall back to the dev studio dir.
    const candidates: string[] = []
    if (process.env.MYCLAW_DESK_STUDIO_DIR) candidates.push(process.env.MYCLAW_DESK_STUDIO_DIR)
    if (process.resourcesPath) candidates.push(join(process.resourcesPath, 'studio'))
    candidates.push(join(__dirname, '..', '..', 'studio'))

    for (const dir of candidates) {
      if (existsSync(join(dir, 'server', 'index.js'))) {
        const hasProdBuild = existsSync(join(dir, '.next', 'BUILD_ID'))
        this.markCheck('studio', 'ok', hasProdBuild ? 'prod build present' : 'dev mode (next dev)')
        return
      }
    }
    this.markCheck('studio', 'warn', 'Workspace entry not found — falling back to remote')
  }

  private detectVersionAt(openclawPkgDir: string): string | undefined {
    try {
      const pkg = JSON.parse(readFileSync(join(openclawPkgDir, 'package.json'), 'utf8'))
      return typeof pkg.version === 'string' ? `v${pkg.version}` : undefined
    } catch {
      return undefined
    }
  }

  private markCheck(
    id: BootstrapCheck['id'],
    status: BootstrapCheck['status'],
    detail?: string
  ): void {
    const checks = (this.state.checks ?? DEFAULT_CHECKS).map((c) =>
      c.id === id ? { ...c, status, detail } : c
    )
    this.update({ checks })
  }

  private runNpmInstall(): Promise<void> {
    const paths = getPaths()
    const pkgSpec = `openclaw@${OPENCLAW_VERSION}`
    if (!paths.npmCli) {
      // No bundled npm-cli.js and `where npm` couldn't locate one. We refuse
      // to fall back to spawning `npm` directly because Node's spawn() can't
      // execute the .cmd shim on Windows (ENOENT) without `shell: true`,
      // which we avoid for safety. Surface a real error so the splash shows
      // it instead of silently failing.
      return Promise.reject(
        new Error(
          'MyClaw runtime missing: the installer did not ship a Node binary and no system npm was found. ' +
            'Reinstall MyClaw.One Desktop.'
        )
      )
    }
    const cmd = paths.nodeBin
    const argv = [
      paths.npmCli,
      'install',
      '--prefix',
      paths.runtime,
      '--no-audit',
      '--no-fund',
      pkgSpec
    ]

    // Prepend the bundled node directory to PATH so npm's lifecycle
    // scripts (preinstall, postinstall) — which npm spawns via
    // `cmd.exe /c node …` on Windows — can find a node binary. Without
    // this, npm install dies on the openclaw package's preinstall hook
    // with "'node' is not recognized as an internal or external command".
    // Also set npm_node_execpath so npm itself uses our bundled binary
    // for any internal child-process work.
    const nodeBinDir = dirname(paths.nodeBin)
    const pathSep = process.platform === 'win32' ? ';' : ':'
    const pathKey =
      process.platform === 'win32'
        ? (Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'Path')
        : 'PATH'
    const childEnv = {
      ...process.env,
      [pathKey]: `${nodeBinDir}${pathSep}${process.env[pathKey] ?? ''}`,
      npm_node_execpath: paths.nodeBin,
      npm_config_yes: 'true'
    }

    return new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, argv, {
        cwd: paths.runtime,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`npm install timed out after ${NPM_INSTALL_TIMEOUT_MS / 1000}s`))
      }, NPM_INSTALL_TIMEOUT_MS)

      const onData = (buf: Buffer): void => {
        const text = buf.toString('utf8')
        for (const raw of text.split(/\r?\n/)) {
          const line = raw.trim()
          if (line) installLogger.log({ source: 'npm', phase: 'installing', text: line })
        }
        const tail = text.split(/\r?\n/).filter(Boolean).pop()
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
    const prev = this.state
    this.state = { ...this.state, ...patch }
    if (patch.phase && patch.phase !== prev.phase) {
      installLogger.log({
        source: 'bootstrap',
        phase: patch.phase,
        text: `→ phase=${patch.phase} ${this.state.message ? '· ' + this.state.message : ''}`
      })
    } else if (patch.message && patch.message !== prev.message) {
      installLogger.log({
        source: 'bootstrap',
        phase: this.state.phase,
        text: this.state.message
      })
    }
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

/**
 * Make a `<dir>/node_modules` entry that resolves to `<dir>/vendor_modules`,
 * so any ESM `import` from inside the bundled tree finds packages where
 * Node expects them. electron-builder strips literally-named node_modules
 * during packaging, so we create the link on the user's machine after
 * install. junction on Windows: doesn't need the elevated symlink
 * privilege; dir symlink on POSIX is the standard kind.
 */
function ensureVendorModulesSymlink(dir: string): void {
  const link = join(dir, 'node_modules')
  const target = join(dir, 'vendor_modules')
  if (!existsSync(target) || existsSync(link)) return
  try {
    symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (err) {
    installLogger.log({
      source: 'bootstrap',
      level: 'warn',
      text: `Failed to symlink ${link} → ${target}: ${
        err instanceof Error ? err.message : String(err)
      }`
    })
  }
}

/**
 * Default openclaw model. We pin to a Claude family route on OpenRouter so
 * the bundled OPENROUTER_API_KEY actually resolves a working provider.
 * openclaw's hardcoded fallback is "openai/gpt-5.5", which would require an
 * OPENAI_API_KEY we don't bundle and produces "No API key for openai" at
 * chat time — silently broken from the user's POV.
 */
const DEFAULT_MODEL_PRIMARY = 'openrouter/anthropic/claude-haiku-4.5'

/**
 * Write a minimal openclaw.json into the state dir on first run so the
 * gateway points at our bundled-key provider out of the box. No-op if a
 * config already exists — we never overwrite user customization.
 */
async function ensureDefaultConfig(stateDir: string): Promise<void> {
  const configPath = join(stateDir, 'openclaw.json')
  if (await fileExists(configPath)) return
  await mkdir(stateDir, { recursive: true })
  const seed = {
    agents: {
      defaults: {
        model: { primary: DEFAULT_MODEL_PRIMARY }
      }
    }
  }
  try {
    await writeFile(configPath, JSON.stringify(seed, null, 2) + '\n', 'utf8')
    installLogger.log({
      source: 'bootstrap',
      text: `Seeded default config at ${configPath} (model: ${DEFAULT_MODEL_PRIMARY})`
    })
  } catch (err) {
    installLogger.log({
      source: 'bootstrap',
      level: 'warn',
      text: `Failed to seed ${configPath}: ${err instanceof Error ? err.message : String(err)}`
    })
  }
}

export const bootstrapper = new Bootstrapper()
