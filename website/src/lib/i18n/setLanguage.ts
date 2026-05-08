import type { Languages } from './types'

import state from './state'

function setLanguage(lang: Languages): void {
    state.currentLanguage = lang
}

export default setLanguage