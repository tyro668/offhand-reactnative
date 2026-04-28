import React, {createContext, useContext, useState, useCallback} from 'react';

export interface ThemeColors {
  bg: string;
  bgSecondary: string;
  card: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentLight: string;
  border: string;
  overlay: string;
  danger: string;
}

export const lightTheme: ThemeColors = {
  bg: '#f5f5f7',
  bgSecondary: '#eeeeef',
  card: '#ffffff',
  text: '#1a1a2e',
  textSecondary: '#5e5e70',
  textMuted: '#9e9eae',
  accent: '#e94560',
  accentLight: '#fde8ec',
  border: '#e8e8ec',
  overlay: 'rgba(0,0,0,0.3)',
  danger: '#d32f2f',
};

export const darkTheme: ThemeColors = {
  bg: '#0d0d1a',
  bgSecondary: '#141428',
  card: '#1a1a32',
  text: '#e0e0e0',
  textSecondary: '#808090',
  textMuted: '#505060',
  accent: '#e94560',
  accentLight: '#1a1030',
  border: '#2a2a3e',
  overlay: 'rgba(0,0,0,0.6)',
  danger: '#ff6b6b',
};

interface ThemeContextType {
  isDark: boolean;
  toggleTheme: () => void;
  colors: ThemeColors;
}

const ThemeContext = createContext<ThemeContextType>({
  isDark: false,
  toggleTheme: () => {},
  colors: lightTheme,
});

export function ThemeProvider({children}: {children: React.ReactNode}) {
  const [isDark, setIsDark] = useState(false);

  const toggleTheme = useCallback(() => {
    setIsDark(prev => !prev);
  }, []);

  const colors = isDark ? darkTheme : lightTheme;

  return (
    <ThemeContext.Provider value={{isDark, toggleTheme, colors}}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
