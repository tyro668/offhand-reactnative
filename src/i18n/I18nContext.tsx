import React, {createContext, useContext, useState, useCallback, useEffect, useRef} from 'react';
import {translations, type Lang} from './translations';
import {saveConfig} from '../db/database';

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

export function I18nProvider({
  children,
  initialLang,
}: {
  children: React.ReactNode;
  initialLang: Lang;
}) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    saveConfig('language', lang);
  }, [lang]);

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
