import type en from './langs/en'

type DeepString<T> = {
    [K in keyof T]: T[K] extends string ? string : DeepString<T[K]>
}

export type Translations = DeepString<typeof en>

type NestedKeyOf<T> = T extends object
    ? {
          [K in keyof T & string]: T[K] extends object
              ? `${K}` | `${K}.${NestedKeyOf<T[K]>}`
              : `${K}`
      }[keyof T & string]
    : never

export type TranslationKey = NestedKeyOf<Translations>

// Trimmed from the upstream @openclaw/i18n set of 14 languages to the
// two this site actually publishes today.  Add more by (1) copying
// the corresponding langs/*.ts here, (2) extending this union, and
// (3) adding the dynamic loader entry in loadLanguage.ts plus a
// src/pages/<lang>/ route tree.
export type Languages = 'en' | 'zh'

export interface I18nState {
    languages: Record<Languages, Translations>
    currentLanguage: Languages
}