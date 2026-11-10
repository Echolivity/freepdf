import { createContext, useContext } from 'react'
import type { Lang, Message, MessageKey, Params } from './core'

export interface I18n {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: MessageKey, params?: Params) => string
  tm: (m: Message | undefined) => string
}

export const I18nContext = createContext<I18n | null>(null)

export function useI18n(): I18n {
  const v = useContext(I18nContext)
  if (!v) throw new Error('useI18n must be used inside LangProvider')
  return v
}
