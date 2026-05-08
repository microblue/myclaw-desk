// With Astro's build-time rendering we eager-load all supported
// locales in state.ts — loadLanguage is a no-op kept for API
// compatibility with the upstream @openclaw/i18n surface.
import type { Languages } from './types'

async function loadLanguage(_lang: Languages): Promise<void> {
    // intentionally empty — all locales already resolved at import time.
}

export default loadLanguage
