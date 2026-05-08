import type { I18nState } from './types'

// Eager-import all locales.  Unlike the upstream @openclaw/i18n
// package which lazy-imports translations on demand (runtime app
// usage), this website renders all locales at build time.  Eager
// imports are simpler, make setLanguage() synchronous, and cost
// nothing at runtime because Astro renders each locale's HTML
// at build time and the JSON doesn't ship to the browser.
import en from './langs/en'
import zh from './langs/zh'

const state: I18nState = {
    languages: { en, zh },
    currentLanguage: 'en',
}

export default state
