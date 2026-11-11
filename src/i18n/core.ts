import { en, type MessageKey, type Msg } from './en'

export type Lang = 'en' | 'ar'
export type Params = Record<string, string | number>
/** A message that can cross the worker boundary and be translated later. */
export interface Message {
  key: MessageKey
  params?: Params
}

export type { MessageKey }
export const LANGS: Lang[] = ['en', 'ar']
export const dir = (lang: Lang) => (lang === 'ar' ? 'rtl' : 'ltr')

// English is always present (it is also the engine's internal language). Other languages are loaded on
// demand with loadLang(), so English visitors and the processing worker never download them.
const dictionaries: Partial<Record<Lang, Record<MessageKey, Msg>>> = { en }

export function registerDictionary(lang: Lang, dict: Record<MessageKey, Msg>) {
  dictionaries[lang] = dict
}

export async function loadLang(lang: Lang): Promise<void> {
  if (dictionaries[lang]) return
  if (lang === 'ar') registerDictionary('ar', (await import('./ar')).ar)
}
const pluralRules: Record<Lang, Intl.PluralRules> = { en: new Intl.PluralRules('en'), ar: new Intl.PluralRules('ar') }

// First-strong isolate / pop: keeps Latin file names from scrambling the order of Arabic sentences.
const FSI = '⁨'
const PDI = '⁩'

export function translate(lang: Lang, key: MessageKey, params: Params = {}): string {
  const entry = dictionaries[lang]?.[key] ?? en[key]
  let text: string
  if (typeof entry === 'string') text = entry
  else {
    const n = Number(params.count ?? 0)
    // An explicit `zero` form wins for 0 in every language (like ICU's "=0"); otherwise CLDR plural rules.
    const cat = (n === 0 && 'zero' in entry ? 'zero' : pluralRules[lang].select(n)) as keyof typeof entry
    text = entry[cat] ?? entry.other
  }
  return text.replace(/\{(\w+)\}/g, (m, name: string) => {
    if (!(name in params)) return m
    const v = String(params[name])
    return lang === 'ar' && typeof params[name] === 'string' && /[A-Za-z]/.test(v) ? FSI + v + PDI : v
  })
}

export const translateMsg = (lang: Lang, m: Message) => translate(lang, m.key, m.params)
export const msg = (key: MessageKey, params?: Params): Message => ({ key, params })

/** Language to use before the user has chosen one: Arabic if the browser prefers Arabic. */
export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem('freepdf:lang')
    if (saved === 'en' || saved === 'ar') return saved
  } catch {
    /* storage unavailable */
  }
  const prefs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []
  return prefs.some((l) => l?.toLowerCase().startsWith('ar')) ? 'ar' : 'en'
}
