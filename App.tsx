import React, {useState, useEffect, useRef} from 'react';
import {StatusBar, View, StyleSheet, LogBox} from 'react-native';
import {I18nProvider, useI18n} from './src/i18n/I18nContext';
import type {Lang} from './src/i18n/translations';
import {ThemeProvider, useTheme} from './src/theme/ThemeContext';
import {DEFAULT_SYSTEM_PROMPT} from './src/models/defaultPrompt';
import ErrorBoundary from './src/components/ErrorBoundary';
import Sidebar from './src/components/Sidebar';
import {
  loadASRConfig,
  saveASRConfig,
  loadTextModelConfig,
  saveTextModelConfig,
  loadShortcutConfig,
  saveShortcutConfig,
  loadSetting,
  type ASRRow,
  type TextModelRow,
  type ShortcutRow,
} from './src/db/database';

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
import HistoryScreen from './src/screens/HistoryScreen';
import ASRSettings from './src/screens/ASRSettings';
import ModelSettings from './src/screens/ModelSettings';
import ShortcutSettings from './src/screens/ShortcutSettings';
import {useRecorder} from './src/services/RecorderWorkflow';

type Screen = 'home' | 'memory' | 'history' | 'settings' | 'asr' | 'model' | 'shortcut';
type SettingScreen = 'asr' | 'model' | 'shortcut';

interface Config {
  asr: {engine: string; model: string; language: string; sampleRate: string};
  textModel: {provider: string; model: string; baseUrl: string; apiKey: string; prompt: string};
  shortcut: {modifier: string; key: string};
}

const DEFAULT_ASR = {engine: 'sensevoice', model: 'senseVoiceSmall', language: 'auto', sampleRate: '16k'};
const DEFAULT_TEXT = {provider: '', model: '', baseUrl: '', apiKey: '', prompt: DEFAULT_SYSTEM_PROMPT};
const DEFAULT_SHORTCUT = {modifier: 'Fn', key: 'Fn'};

function AppContent({initialConfig}: {initialConfig: Config}) {
  const {colors} = useTheme();
  const {t} = useI18n();
  const [screen, setScreen] = useState<Screen>('home');
  const [config, setConfig] = useState<Config>(initialConfig);
  const isFirstRender = useRef(true);

  // Start the complete fn-key recording workflow for the lifetime of the app.
  useRecorder();

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    saveASRConfig({
      engine: config.asr.engine,
      model: config.asr.model,
      language: config.asr.language,
      sample_rate: config.asr.sampleRate,
    });
    saveTextModelConfig({
      provider: config.textModel.provider,
      model: config.textModel.model,
      base_url: config.textModel.baseUrl,
      api_key: config.textModel.apiKey,
      prompt: config.textModel.prompt,
    });
    saveShortcutConfig({
      modifier: config.shortcut.modifier,
      key: config.shortcut.key,
    });
  }, [config]);

  const menuItems = [
    {key: 'home', label: t('homeMenu'), icon: '⌂'},
    {key: 'memory', label: t('memoryMenu'), icon: '▤'},
    {key: 'history', label: t('historyMenu'), icon: '◷'},
    {key: 'settings', label: t('settingsMenu'), icon: '⚙'},
  ];

  return (
    <View style={[styles.root, {backgroundColor: colors.bg}]}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.card} />
      <View style={styles.layout}>
        <Sidebar
          activeKey={screen}
          menuItems={menuItems}
          onSelect={key => setScreen(key as Screen)}
        />
        <View style={styles.content}>
          {screen === 'home' && <HomeScreen />}
          {screen === 'memory' && <MemoryScreen />}
          {screen === 'history' && <HistoryScreen />}
          {screen === 'settings' && (
            <SettingsScreen
              config={config}
              onNavigate={(s: SettingScreen) => setScreen(s)}
            />
          )}
          {screen === 'asr' && (
            <ASRSettings
              config={config.asr}
              onSave={cfg => {
                setConfig(prev => ({...prev, asr: cfg}));
                setScreen('settings');
              }}
              onBack={() => setScreen('settings')}
            />
          )}
          {screen === 'model' && (
            <ModelSettings
              config={config.textModel}
              onSave={cfg => {
                setConfig(prev => ({...prev, textModel: cfg}));
                setScreen('settings');
              }}
              onBack={() => setScreen('settings')}
            />
          )}
          {screen === 'shortcut' && (
            <ShortcutSettings
              modifier={config.shortcut.modifier}
              shortcutKey={config.shortcut.key}
              onSave={(modifier, key) => {
                setConfig(prev => ({...prev, shortcut: {modifier, key}}));
              }}
              onBack={() => setScreen('settings')}
            />
          )}
        </View>
      </View>
    </View>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [initialConfig, setInitialConfig] = useState<Config>({
    asr: DEFAULT_ASR,
    textModel: DEFAULT_TEXT,
    shortcut: DEFAULT_SHORTCUT,
  });
  const [initialDark, setInitialDark] = useState(false);
  const [initialLang, setInitialLang] = useState<Lang>('zh');

  useEffect(() => {
    (async () => {
      const asr = await loadASRConfig({...DEFAULT_ASR, sample_rate: DEFAULT_ASR.sampleRate});
      const txt = await loadTextModelConfig({
        provider: '',
        model: '',
        base_url: '',
        api_key: '',
        prompt: DEFAULT_SYSTEM_PROMPT,
      });
      const sc = await loadShortcutConfig(DEFAULT_SHORTCUT);
      const darkStr = await loadSetting('theme', 'false');
      const lang = (await loadSetting('language', 'zh')) as Lang;

      setInitialConfig({
        asr: {
          engine: asr.engine,
          model: asr.model,
          language: asr.language,
          sampleRate: asr.sample_rate,
        },
        textModel: {
          provider: txt.provider,
          model: txt.model,
          baseUrl: txt.base_url,
          apiKey: txt.api_key,
          prompt: txt.prompt || DEFAULT_SYSTEM_PROMPT,
        },
        shortcut: sc,
      });
      setInitialDark(darkStr === 'true');
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
  root: {flex: 1, backgroundColor: '#f5f5f7'},
  layout: {flex: 1, flexDirection: 'row'},
  content: {flex: 1},
});
