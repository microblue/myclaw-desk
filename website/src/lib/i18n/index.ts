import type { TranslationKey, Languages, Translations } from './types'

import t from './t'
import setLanguage from './setLanguage'
import getLanguage from './getLanguage'
import loadLanguage from './loadLanguage'
import en from './langs/en'

export type { TranslationKey, Languages, Translations }
export { t, setLanguage, getLanguage, loadLanguage, en }