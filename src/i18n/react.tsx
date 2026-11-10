import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { detectLang, dir, loadLang, translate, translateMsg, type Lang } from './core'
import { I18nContext, type I18n } from './context'

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
    // Switch only once the dictionary is there, so the interface never shows half-translated text.
    loadLang(l).then(() => setLangState(l), () => setLangState(l))
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
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
