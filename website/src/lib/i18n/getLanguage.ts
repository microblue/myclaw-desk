import type { Languages } from './types'

import state from './state'

function getLanguage(): Languages {
    return state.currentLanguage
}

export default getLanguage