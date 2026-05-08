import type { TranslationKey } from './types'

import state from './state'

function getNestedValue(obj: unknown, path: string): string {
    const keys = path.split('.')
    let current: unknown = obj

    for (const key of keys) {
        if (current === null || current === undefined) {
            return path
        }
        if (typeof current === 'object' && key in current) {
            current = (current as Record<string, unknown>)[key]
        } else {
            return path
        }
    }

    return typeof current === 'string' ? current : path
}

function t(
    key: TranslationKey,
    params?: Record<string, string | number>
): string {
    const translations =
        state.languages[state.currentLanguage] || state.languages.en
    let value = getNestedValue(translations, key)

    if (params) {
        for (const [paramKey, paramValue] of Object.entries(params)) {
            value = value.replace(
                new RegExp(`{{${paramKey}}}`, 'g'),
                String(paramValue)
            )
        }
    }

    return value
}

export default t