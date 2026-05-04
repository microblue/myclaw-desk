import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..')

export default async function globalSetup(): Promise<void> {
  // Compile main + preload + renderer once before launching Electron.
  // Renderer prod build is enough for splash; the main process is what
  // Playwright's _electron.launch() loads.
  const mainEntry = join(ROOT, 'out', 'main', 'index.js')
  if (process.env.MYCLAW_DESK_SKIP_BUILD === '1' && existsSync(mainEntry)) {
    return
  }
  execSync('pnpm exec electron-vite build', {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' }
  })
}
