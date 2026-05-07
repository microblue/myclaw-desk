import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Build-time secrets: baked into the compiled main bundle so the desktop
// can hand them to openclaw without the user pasting an API key. The
// release workflow reads BUNDLED_OPENROUTER_KEY from a GitHub secret;
// local dev can `export BUNDLED_OPENROUTER_KEY=…` or leave empty (the
// provider gate just warns instead of hard-failing).
const define = {
  __BUNDLED_OPENROUTER_KEY__: JSON.stringify(process.env.BUNDLED_OPENROUTER_KEY ?? '')
}

export default defineConfig({
  main: { define },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
