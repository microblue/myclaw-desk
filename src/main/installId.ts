import { app } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

let cached: string | null = null

/**
 * Stable per-install anonymous UUID. Persists under userData/install-id.txt
 * so repeated reports from the same machine cluster together in the admin
 * view. Lazily created on first read; never sent anywhere except as the
 * `installId` field of an install crash report.
 */
export function getInstallId(): string {
  if (cached) return cached
  const dir = app.getPath('userData')
  const file = join(dir, 'install-id.txt')
  try {
    if (existsSync(file)) {
      const id = readFileSync(file, 'utf8').trim()
      if (id.length >= 8) {
        cached = id
        return id
      }
    }
  } catch {
    // fall through to mint a fresh one
  }
  const id = randomUUID()
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, id, 'utf8')
  } catch {
    // best-effort — even if we can't persist, we still return a UUID for this
    // session so reporting works.
  }
  cached = id
  return id
}
