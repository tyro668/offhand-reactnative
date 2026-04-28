import React, {useState} from 'react';
import {StatusBar, View, StyleSheet, TouchableOpacity} from 'react-native';
import {I18nProvider, useI18n} from './src/i18n/I18nContext';
import {ThemeProvider, useTheme} from './src/theme/ThemeContext';
import ErrorBoundary from './src/components/ErrorBoundary';
import Drawer from './src/components/Drawer';
import HomeScreen from './src/screens/HomeScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import MemoryScreen from './src/screens/MemoryScreen';
import ASRSettings from './src/screens/ASRSettings';
import ModelSettings from './src/screens/ModelSettings';
import ShortcutSettings from './src/screens/ShortcutSettings';

type Screen = 'home' | 'memory' | 'settings' | 'asr' | 'model' | 'shortcut';
type SettingScreen = 'asr' | 'model' | 'shortcut';

interface Config {
  asr: {model: string};
  textModel: {model: string};
  shortcut: {modifier: string; key: string};
}

const DEFAULT_CONFIG: Config = {
  asr: {model: 'modelWhisperLarge'},
  textModel: {model: 'modelGPT4'},
  shortcut: {modifier: 'Cmd', key: 'V'},
};

const MENU_ITEMS = [
  {key: 'home', label: '主页', icon: '⌂'},
  {key: 'memory', label: '记忆库', icon: '▤'},
  {key: 'settings', label: '设置', icon: '⚙'},
];

function AppContent() {
  const {t} = useI18n();
  const {colors} = useTheme();
  const [screen, setScreen] = useState<Screen>('home');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);

  const openDrawer = () => setDrawerOpen(true);
  const closeDrawer = () => setDrawerOpen(false);

  const handleMenuSelect = (key: string) => {
    setScreen(key as Screen);
    closeDrawer();
  };

  const handleSetASR = (model: string) => {
    setConfig(prev => ({...prev, asr: {model}}));
  };

  const handleSetModel = (model: string) => {
    setConfig(prev => ({...prev, textModel: {model}}));
  };

  const handleSetShortcut = (modifier: string, key: string) => {
    setConfig(prev => ({...prev, shortcut: {modifier, key}}));
  };

  const renderScreen = () => {
    switch (screen) {
      case 'home':
        return <HomeScreen onMenuPress={openDrawer} />;
      case 'memory':
        return <MemoryScreen onMenuPress={openDrawer} />;
      case 'settings':
        return (
          <SettingsScreen
            config={config}
            onNavigate={(s: SettingScreen) => setScreen(s)}
            onMenuPress={openDrawer}
          />
        );
      case 'asr':
        return (
          <ASRSettings
            current={config.asr.model}
            onSelect={model => {
              handleSetASR(model);
              setScreen('settings');
            }}
            onBack={() => setScreen('settings')}
          />
        );
      case 'model':
        return (
          <ModelSettings
            current={config.textModel.model}
            onSelect={model => {
              handleSetModel(model);
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
            onSave={handleSetShortcut}
            onBack={() => setScreen('settings')}
          />
        );
      default:
        return null;
    }
  };

  return (
    <View style={[styles.root, {backgroundColor: colors.bg}]}>
      <StatusBar
        barStyle="dark-content"
        backgroundColor={colors.card}
      />
      {renderScreen()}
      <Drawer
        visible={drawerOpen}
        activeScreen={screen}
        menuItems={MENU_ITEMS}
        onSelect={handleMenuSelect}
        onClose={closeDrawer}
      />
    </View>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <I18nProvider>
          <AppContent />
        </I18nProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
