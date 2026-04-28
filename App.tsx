import React, {useState, useEffect, useRef} from 'react';
import {StatusBar, View, StyleSheet, LogBox} from 'react-native';
import {I18nProvider, useI18n} from './src/i18n/I18nContext';
import type {Lang} from './src/i18n/translations';
import {ThemeProvider, useTheme} from './src/theme/ThemeContext';
import ErrorBoundary from './src/components/ErrorBoundary';
import Sidebar from './src/components/Sidebar';
import {loadConfig, saveConfig} from './src/db/database';

LogBox.ignoreAllLogs(true);

declare const global: any;
if (global.ErrorUtils) {
  const origHandler = global.ErrorUtils.getGlobalHandler();
  global.ErrorUtils.setGlobalHandler((error: Error, _isFatal?: boolean) => {
    console.error('[App]', error.message, error.stack);
    origHandler(error, false);
  });
}

import HomeScreen from './src/screens/HomeScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import MemoryScreen from './src/screens/MemoryScreen';
import ASRSettings from './src/screens/ASRSettings';
import ModelSettings from './src/screens/ModelSettings';
import ShortcutSettings from './src/screens/ShortcutSettings';

type Screen = 'home' | 'memory' | 'settings' | 'asr' | 'model' | 'shortcut';
type SettingScreen = 'asr' | 'model' | 'shortcut';

interface Config {
  asr: {engine: string; model: string; language: string; sampleRate: string};
  textModel: {provider: string; model: string; baseUrl: string; apiKey: string; style: string; maxTokens: string};
  shortcut: {modifier: string; key: string};
}

const DEFAULT_CONFIG: Config = {
  asr: {engine: 'sensevoice', model: 'senseVoiceSmall', language: 'auto', sampleRate: '16k'},
  textModel: {provider: '', model: '', baseUrl: '', apiKey: '', style: 'casual', maxTokens: '1024'},
  shortcut: {modifier: '', key: ''},
};

function AppContent({initialConfig}: {initialConfig: Config}) {
  const {colors} = useTheme();
  const {t} = useI18n();
  const [screen, setScreen] = useState<Screen>('home');
  const [config, setConfig] = useState<Config>(initialConfig);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    saveConfig('config', config);
  }, [config]);

  const updateConfig = (updater: (prev: Config) => Config) => {
    setConfig(updater);
  };

  const menuItems = [
    {key: 'home', label: t('homeMenu'), icon: '⌂'},
    {key: 'memory', label: t('memoryMenu'), icon: '▤'},
    {key: 'settings', label: t('settingsMenu'), icon: '⚙'},
  ];

  const renderContent = () => {
    switch (screen) {
      case 'home':
        return <HomeScreen />;
      case 'memory':
        return <MemoryScreen />;
      case 'settings':
        return (
          <SettingsScreen
            config={config}
            onNavigate={(s: SettingScreen) => setScreen(s)}
          />
        );
      case 'asr':
        return (
          <ASRSettings
            config={config.asr}
            onSave={cfg => {
              updateConfig(prev => ({...prev, asr: cfg}));
              setScreen('settings');
            }}
            onBack={() => setScreen('settings')}
          />
        );
      case 'model':
        return (
          <ModelSettings
            config={config.textModel}
            onSave={cfg => {
              updateConfig(prev => ({...prev, textModel: cfg}));
              setScreen('settings');
            }}
            onBack={() => setScreen('settings')}
          />
        );
      case 'shortcut':
        return (
          <ShortcutSettings
            modifier={config.shortcut.modifier}
            shortcutKey={config.shortcut.key}
            onSave={(modifier, key) => {
              updateConfig(prev => ({...prev, shortcut: {modifier, key}}));
            }}
            onBack={() => setScreen('settings')}
          />
        );
      default:
        return null;
    }
  };

  return (
    <View style={[styles.root, {backgroundColor: colors.bg}]}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.card} />
      <View style={styles.layout}>
        <Sidebar
          activeKey={screen}
          menuItems={menuItems}
          onSelect={key => setScreen(key as Screen)}
        />
        <View style={styles.content}>{renderContent()}</View>
      </View>
    </View>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [initialConfig, setInitialConfig] = useState(DEFAULT_CONFIG);
  const [initialDark, setInitialDark] = useState(false);
  const [initialLang, setInitialLang] = useState<Lang>('zh');

  useEffect(() => {
    (async () => {
      const cfg = await loadConfig<Config>('config', DEFAULT_CONFIG);
      const dark = await loadConfig<boolean>('theme', false);
      const lang = await loadConfig<Lang>('language', 'zh');
      setInitialConfig(cfg);
      setInitialDark(dark);
      setInitialLang(lang);
      setReady(true);
    })();
  }, []);

  if (!ready) {
    return <View style={styles.root} />;
  }

  return (
    <ErrorBoundary>
      <ThemeProvider initialDark={initialDark}>
        <I18nProvider initialLang={initialLang}>
          <AppContent initialConfig={initialConfig} />
        </I18nProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f5f5f7',
  },
  layout: {
    flex: 1,
    flexDirection: 'row',
  },
  content: {
    flex: 1,
  },
});
