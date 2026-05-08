#!/usr/bin/env node
// Strip files we never need at runtime from a vendored node_modules tree.
// `npm install --omit=dev` only removes devDependencies of the root, not
// the dev cruft INSIDE each kept package — typical npm packages ship with
// markdown docs, tests, sourcemaps, .d.ts decls, examples, .github
// metadata, etc. that we never load.
//
// On a 474MB openclaw bundle this typically reclaims 30–50%, which
// directly translates to a smaller installer + faster NSIS extraction
// (Windows Defender scans every file written; fewer files = faster
// install).
//
// Usage: node scripts/prune-bundle.mjs <dir> [<dir> ...]

import { existsSync } from 'node:fs'
import { rm, readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'

const dirs = process.argv.slice(2)
if (dirs.length === 0) {
  console.error('usage: prune-bundle.mjs <dir> [<dir> ...]')
  process.exit(2)
}

// Names (case-insensitive on directory + file basenames) we always remove.
// Conservative — only stuff that's safe to drop from a published npm
// package's runtime use:
//  - tests / examples / benchmarks / docs (never imported at runtime)
//  - editor/CI/lint config and metadata
//  - sourcemaps and native compile artifacts
//  - human-readable docs (markdown, changelogs)
const removeBasenames = new Set(
  [
    // dev-tooling metadata
    '.babelrc',
    '.babelrc.js',
    '.babelrc.json',
    '.editorconfig',
    '.eslintignore',
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.json',
    '.eslintrc.yml',
    '.eslintrc.yaml',
    '.gitattributes',
    '.gitignore',
    '.gitlab-ci.yml',
    '.huskyrc',
    '.huskyrc.js',
    '.huskyrc.json',
    '.markdownlint.json',
    '.npmignore',
    '.nvmrc',
    '.nycrc',
    '.nycrc.json',
    '.prettierignore',
    '.prettierrc',
    '.prettierrc.js',
    '.prettierrc.json',
    '.prettierrc.yml',
    '.prettierrc.yaml',
    '.stylelintrc',
    '.travis.yml',
    'appveyor.yml',
    'AUTHORS',
    'CHANGELOG',
    'changelog',
    'CHANGES',
    'CONTRIBUTORS',
    'GOVERNANCE.md',
    'history.md',
    'HISTORY',
    'jest.config.js',
    'karma.conf.js',
    'Makefile',
    'rollup.config.js',
    'tsconfig.json',
    'tsconfig.build.json',
    'tsconfig.test.json',
    'tslint.json',
    'webpack.config.js'
  ].map((s) => s.toLowerCase())
)

// Dir names removed unconditionally. KEPT VERY SHORT on purpose: lots of
// npm packages ship real runtime code under directories with names that
// look like documentation/tests at first glance (e.g. yaml/dist/doc/ has
// the actual Document class). Only include names that are universally
// build-artifact / metadata in the npm ecosystem. v0.1.18 hit this with
// `doc` in the list and the openclaw gateway exit-1'd at runtime.
const removeDirs = new Set(
  [
    '__tests__',
    '__test__',
    '__mocks__',
    '.cache',
    '.circleci',
    '.github',
    '.gitlab',
    '.husky',
    '.idea',
    '.nyc_output',
    '.vscode',
    'coverage'
  ].map((s) => s.toLowerCase())
)

// .md / .markdown are NOT in this set: openclaw ships runtime template
// files like docs/reference/templates/AGENTS.md that the heartbeat check
// reads at runtime. Stripping them tripped v0.1.22's heartbeat with
// "Missing workspace template: AGENTS.md". Lossy savings (~few MB) wasn't
// worth the correctness regression.
//
// Newly added:
//   .mts, .cts — TypeScript module variants that leaked through the
//     existing .ts strip. Pure build-time, never imported at runtime.
//   .bcmap     — pdf.js binary char maps. Studio/openclaw don't render
//     PDFs in the desktop flow.
//   .scss      — pre-compiled by Tailwind/PostCSS at build time.
const removeExts = new Set([
  '.flow',
  '.coffee',
  '.lock',
  '.tsbuildinfo',
  '.mts',
  '.cts',
  '.bcmap',
  '.scss'
])

// Sourcemaps + .ts files. We strip both — at runtime Node only needs the
// transpiled .js / .cjs. (.d.ts could in principle be useful for tooling
// like ts-node-running scripts, but openclaw's published tree doesn't do
// that and our gateway path doesn't either.)
const removeExtPredicate = (name) => {
  const lower = name.toLowerCase()
  if (lower.endsWith('.map')) return true
  if (lower.endsWith('.d.ts')) return true
  if (lower.endsWith('.d.ts.map')) return true
  if (lower.endsWith('.ts') && !lower.endsWith('.d.ts')) return true
  return false
}

let filesRemoved = 0
let bytesReclaimed = 0

async function walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    const lower = entry.name.toLowerCase()

    if (entry.isDirectory()) {
      if (removeDirs.has(lower)) {
        await reclaim(full)
        continue
      }
      await walk(full)
      continue
    }

    // Files
    const ext = extname(lower)
    if (removeBasenames.has(lower)) {
      await reclaim(full)
      continue
    }
    if (removeExts.has(ext)) {
      // Don't strip the LICENSE — keep the legal cover even if it's a .md.
      if (!isLegalDoc(entry.name)) {
        await reclaim(full)
        continue
      }
    }
    if (removeExtPredicate(entry.name)) {
      await reclaim(full)
      continue
    }
  }
}

function isLegalDoc(name) {
  const lower = name.toLowerCase()
  return lower.startsWith('license') || lower.startsWith('notice') || lower.startsWith('copying')
}

async function reclaim(path) {
  try {
    const s = await stat(path)
    bytesReclaimed += s.isDirectory() ? await dirSize(path) : s.size
    await rm(path, { recursive: true, force: true })
    filesRemoved++
  } catch {
    // best-effort
  }
}

async function dirSize(p) {
  let total = 0
  try {
    for (const entry of await readdir(p, { withFileTypes: true })) {
      const full = join(p, entry.name)
      total += entry.isDirectory() ? await dirSize(full) : (await stat(full)).size
    }
  } catch {
    // ignore
  }
  return total
}

for (const dir of dirs) {
  if (!existsSync(dir)) {
    console.warn(`[prune] ${dir} not found, skipping`)
    continue
  }
  await walk(dir)
}

console.log(
  `[prune] removed ${filesRemoved} entries, reclaimed ${(bytesReclaimed / 1024 / 1024).toFixed(1)} MB`
)
