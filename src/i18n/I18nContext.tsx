import React, {createContext, useContext, useState, useCallback} from 'react';
import {translations, type Lang} from './translations';

interface I18nContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType>({
  lang: 'zh',
  setLang: () => {},
  toggleLang: () => {},
  t: (key: string) => key,
});

export function I18nProvider({children}: {children: React.ReactNode}) {
  const [lang, setLang] = useState<Lang>('zh');

  const toggleLang = useCallback(() => {
    setLang(prev => (prev === 'zh' ? 'en' : 'zh'));
  }, []);

  const t = useCallback(
    (key: string): string => {
      return translations[lang]?.[key] ?? key;
    },
    [lang],
  );

  return (
    <I18nContext.Provider value={{lang, setLang, toggleLang, t}}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
