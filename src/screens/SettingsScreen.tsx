import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import TouchableOpacity from '../components/TouchableOpacityCompat';
import Tooltip from '../components/Tooltip';
import { useI18n } from '../i18n/I18nContext';
import { useTheme, type ThemeColors } from '../theme/ThemeContext';
import SettingsRow from '../components/SettingsRow';
import { getLogFilePath, openLogFolder } from '../services/OverlayManager';

type SettingScreen = 'asr' | 'model' | 'shortcut';
const SHERPA_IDLE_OPTIONS = [1, 3, 5, 10];
const isMacOS = Platform.OS === 'macos';

interface ASRConfig {
  engine: string;
  model: string;
  language: string;
  sampleRate: string;
}
interface ModelConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  prompt: string;
}
interface ShortcutConfig {
  modifier: string;
  key: string;
}
interface PerformanceConfig {
  sherpaIdleReleaseMinutes: number;
}

interface Props {
  config: {
    asr: ASRConfig;
    textModel: ModelConfig;
    shortcut: ShortcutConfig;
    performance: PerformanceConfig;
  };
  onNavigate: (screen: SettingScreen) => void;
  onPerformanceChange: (config: PerformanceConfig) => void;
}

export default function SettingsScreen({
  config,
  onNavigate,
  onPerformanceChange,
}: Props) {
  const { t, lang, toggleLang } = useI18n();
  const { colors, isDark, toggleTheme } = useTheme();
  const [logFilePath, setLogFilePath] = useState('');
  const [showIdleTooltip, setShowIdleTooltip] = useState(false);
  const [iconPos, setIconPos] = useState({ x: 0, w: 0 });
  const s = makeStyles(colors);

  const handleIconLayout = useCallback((e: any) => {
    const { x, width } = e.nativeEvent.layout;
    // icon x relative to titleRow; row has paddingLeft=20
    setIconPos({ x: 20 + x, w: width });
  }, []);

  useEffect(() => {
    let active = true;

    getLogFilePath()
      .then(path => {
        if (active) {
          setLogFilePath(path);
        }
      })
      .catch(e => {
        console.warn('[SettingsScreen] getLogFilePath failed', e);
        if (active) {
          setLogFilePath(t('logUnavailable'));
        }
      });

    return () => {
      active = false;
    };
  }, [t]);

  const handleOpenLogFolder = async () => {
    try {
      await openLogFolder();
    } catch (e) {
      console.warn('[SettingsScreen] openLogFolder failed', e);
    }
  };

  return (
    <View style={s.container}>
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.sectionTitle}>{t('general')}</Text>
        <View style={s.row}>
          <Text style={s.rowLabel}>{t('langLabel')}</Text>
          <TouchableOpacity style={s.toggle} onPress={toggleLang}>
            <Text style={s.toggleText}>
              {lang === 'zh' ? t('languageZh') : t('languageEn')}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={s.row}>
          <Text style={s.rowLabel}>{t('darkMode')}</Text>
          <TouchableOpacity
            style={[s.toggle, isDark && s.toggleActive]}
            onPress={toggleTheme}
          >
            <Text style={[s.toggleText, isDark && s.toggleTextActive]}>
              {isDark ? t('darkOn') : t('darkOff')}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={s.sectionTitle}>{t('modelsSection')}</Text>
        <SettingsRow
          label={t('speechModel')}
          value={`${t(config.asr.engine)} · ${t(config.asr.model)} · ${t(
            config.asr.language,
          )}`}
          onPress={() => onNavigate('asr')}
        />
        <SettingsRow
          label={t('textModelTitle')}
          value={`${config.textModel.provider} · ${config.textModel.model}`}
          onPress={() => onNavigate('model')}
        />

        <Text style={s.sectionTitle}>{t('performanceSection')}</Text>
        <View style={s.performanceRow}>
          <View style={s.performanceTextBlock}>
            <View style={s.titleRow}>
              <Text style={s.rowLabel}>{t('sherpaIdleRelease')}</Text>
              <View
                style={s.infoIconWrap}
                onLayout={handleIconLayout}
                {...(isMacOS
                  ? {
                      onMouseEnter: () => setShowIdleTooltip(true),
                      onMouseLeave: () => setShowIdleTooltip(false),
                    }
                  : {})}
              >
                <TouchableOpacity
                  onPress={() => setShowIdleTooltip(prev => !prev)}
                >
                  <Text style={s.infoIcon}>ⓘ</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
          <View style={s.segmentRow}>
            {SHERPA_IDLE_OPTIONS.map(minutes => {
              const active =
                config.performance.sherpaIdleReleaseMinutes === minutes;
              return (
                <TouchableOpacity
                  key={minutes}
                  style={[s.segmentBtn, active && s.segmentBtnActive]}
                  onPress={() =>
                    onPerformanceChange({ sherpaIdleReleaseMinutes: minutes })
                  }
                >
                  <Text style={[s.segmentText, active && s.segmentTextActive]}>
                    {minutes} {t('minuteShort')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Tooltip
            visible={showIdleTooltip}
            anchorX={iconPos.x}
            anchorWidth={iconPos.w}
            text={t('sherpaIdleReleaseDesc')}
          />
        </View>

        <Text style={s.sectionTitle}>{t('shortcutsSection')}</Text>
        <SettingsRow
          label={t('shortcutRecording')}
          value={
            config.shortcut.key
              ? `${config.shortcut.modifier}+${config.shortcut.key}`
              : t('noShortcut')
          }
          onPress={() => onNavigate('shortcut')}
        />

        <Text style={s.sectionTitle}>{t('logsSection')}</Text>
        <View style={s.logRow}>
          <View style={s.logTextBlock}>
            <Text selectable style={s.logPath} numberOfLines={1}>
              {logFilePath || t('logPathLoading')}
            </Text>
          </View>
          <TouchableOpacity style={s.openButton} onPress={handleOpenLogFolder}>
            <Text style={s.openButtonText}>{t('open')}</Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    scroll: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
    sectionTitle: {
      fontSize: 12,
      fontWeight: '600',
      color: c.textMuted,
      paddingHorizontal: 8,
      marginTop: 24,
      marginBottom: 4,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 14,
      backgroundColor: c.card,
      borderRadius: 10,
      marginBottom: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    rowLabel: { fontSize: 15, color: c.text },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    infoIconWrap: {
      marginLeft: 6,
      paddingHorizontal: 2,
    },
    infoIcon: {
      fontSize: 15,
      color: c.textMuted,
    },
    rowHint: {
      marginTop: 5,
      fontSize: 12,
      lineHeight: 17,
      color: c.textMuted,
    },
    performanceRow: {
      position: 'relative',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 14,
      backgroundColor: c.card,
      borderRadius: 10,
      marginBottom: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    performanceTextBlock: {
      flex: 1,
      minWidth: 0,
      marginRight: 12,
    },
    segmentRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-end',
    },
    segmentBtn: {
      minWidth: 54,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 14,
      backgroundColor: c.bgSecondary,
      alignItems: 'center',
      marginLeft: 6,
      marginVertical: 2,
    },
    segmentBtnActive: {
      backgroundColor: c.accent,
    },
    segmentText: {
      fontSize: 12,
      color: c.textSecondary,
      fontWeight: '500',
    },
    segmentTextActive: {
      color: '#ffffff',
    },
    logRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 14,
      backgroundColor: c.card,
      borderRadius: 10,
      marginBottom: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    logTextBlock: {
      flex: 1,
      marginRight: 12,
    },
    logPath: {
      fontSize: 13,
      lineHeight: 18,
      color: c.textSecondary,
    },
    openButton: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 16,
      backgroundColor: c.accent,
    },
    openButtonText: {
      fontSize: 13,
      fontWeight: '600',
      color: '#ffffff',
    },
    toggle: {
      paddingHorizontal: 16,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: c.bgSecondary,
    },
    toggleActive: { backgroundColor: c.accent },
    toggleText: { fontSize: 13, color: c.textSecondary },
    toggleTextActive: { color: '#ffffff' },
  });
}
