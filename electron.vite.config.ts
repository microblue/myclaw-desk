import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Build-time constants:
//   - BUNDLED_OPENROUTER_KEY: baked into the compiled main bundle so the
//     desktop hands it to openclaw without the user pasting an API key.
//     Release workflow reads it from a GitHub secret; local dev can
//     `export BUNDLED_OPENROUTER_KEY=…` or leave empty (provider gate
//     just warns instead of hard-failing).
//   - APP_VERSION: pulled from package.json so renderer + main can show
//     "v0.1.X" in the splash + window title without an extra IPC round
//     trip.
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string
}
const define = {
  __BUNDLED_OPENROUTER_KEY__: JSON.stringify(process.env.BUNDLED_OPENROUTER_KEY ?? ''),
  __APP_VERSION__: JSON.stringify(pkg.version)
}

export default defineConfig({
  main: { define },
  preload: { define },
  renderer: {
    define,
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
