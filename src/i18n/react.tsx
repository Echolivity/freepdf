import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { detectLang, dir, translate, translateMsg, type Lang, type Message, type MessageKey, type Params } from './core'

interface I18n {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: MessageKey, params?: Params) => string
  tm: (m: Message | undefined) => string
}

const Ctx = createContext<I18n | null>(null)

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang)

  useEffect(() => {
    const html = document.documentElement
    html.lang = lang
    html.dir = dir(lang)
  }, [lang])

  const setLang = useCallback((l: Lang) => {
    try {
      localStorage.setItem('freepdf:lang', l)
    } catch {
      /* storage unavailable */
    }
    setLangState(l)
  }, [])

  const value = useMemo<I18n>(
    () => ({
      lang,
      setLang,
      t: (key, params) => translate(lang, key, params),
      tm: (m) => (m ? translateMsg(lang, m) : ''),
    }),
    [lang, setLang],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n(): I18n {
  const v = useContext(Ctx)
  if (!v) throw new Error('useI18n must be used inside LangProvider')
  return v
}
