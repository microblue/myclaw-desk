import { existsSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..', '..')
const DIST = join(ROOT, 'dist')

// Locate the packaged Electron binary produced by electron-builder. We launch
// the binary inside dist/<platform>-unpacked/ rather than the installer
// (.AppImage / .dmg / .exe) because the installer is what end users get, but
// the unpacked tree is identical content and starts in milliseconds.
//
// Returns null if no build is present so 03-packaged.spec.ts can self-skip
// (it lives in the same test root as the dev specs and runs in CI alongside
// them).
export function packagedBinaryPath(): string | null {
  if (process.platform === 'linux') {
    const p = join(DIST, 'linux-unpacked', 'myclaw-desk')
    return existsSync(p) ? p : null
  }
  if (process.platform === 'win32') {
    const p = join(DIST, 'win-unpacked', 'myclaw-desk.exe')
    return existsSync(p) ? p : null
  }
  if (process.platform === 'darwin') {
    // electron-builder splits arch-specific output into dist/mac/ (x64) and
    // dist/mac-arm64/ (arm64). On a runner only one is built, so probe both.
    const candidates = [
      join(DIST, 'mac-arm64', 'MyClaw.One Desktop.app', 'Contents', 'MacOS', 'MyClaw.One Desktop'),
      join(DIST, 'mac', 'MyClaw.One Desktop.app', 'Contents', 'MacOS', 'MyClaw.One Desktop')
    ]
    return candidates.find(existsSync) ?? null
  }
  return null
}
