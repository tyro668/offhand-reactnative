import React from 'react';
import {View, Text, StyleSheet, ScrollView, TouchableOpacity} from 'react-native';
import {useI18n} from '../i18n/I18nContext';
import {useTheme, type ThemeColors} from '../theme/ThemeContext';
import SettingsRow from '../components/SettingsRow';

type SettingScreen = 'asr' | 'model' | 'shortcut';

interface ASRConfig {
  model: string;
}

interface ModelConfig {
  model: string;
}

interface ShortcutConfig {
  modifier: string;
  key: string;
}

interface Props {
  config: {
    asr: ASRConfig;
    textModel: ModelConfig;
    shortcut: ShortcutConfig;
  };
  onNavigate: (screen: SettingScreen) => void;
  onMenuPress: () => void;
}

export default function SettingsScreen({
  config,
  onNavigate,
  onMenuPress,
}: Props) {
  const {t, lang, toggleLang} = useI18n();
  const {colors, isDark, toggleTheme} = useTheme();
  const s = makeStyles(colors);

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={onMenuPress} style={s.menuBtn}>
          <Text style={s.menuIcon}>☰</Text>
        </TouchableOpacity>
        <Text style={s.title}>{t('settings')}</Text>
        <View style={s.spacer} />
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        {/* General */}
        <Text style={s.sectionTitle}>通用</Text>
        <View style={s.row}>
          <Text style={s.rowLabel}>语言 / Language</Text>
          <TouchableOpacity
            style={s.toggle}
            onPress={toggleLang}>
            <Text style={s.toggleText}>{lang === 'zh' ? '中文' : 'English'}</Text>
          </TouchableOpacity>
        </View>
        <View style={s.row}>
          <Text style={s.rowLabel}>深色模式</Text>
          <TouchableOpacity
            style={[s.toggle, isDark && s.toggleActive]}
            onPress={toggleTheme}>
            <Text
              style={[
                s.toggleText,
                isDark && s.toggleTextActive,
              ]}>
              {isDark ? '开启' : '关闭'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Models */}
        <Text style={s.sectionTitle}>模型配置</Text>
        <Text style={s.sectionDesc}>{t('asrModelDesc')}</Text>
        <SettingsRow
          label={t('asrModel')}
          value={t(config.asr.model)}
          onPress={() => onNavigate('asr')}
        />
        <Text style={s.sectionDesc}>{t('textModelDesc')}</Text>
        <SettingsRow
          label={t('textModel')}
          value={t(config.textModel.model)}
          onPress={() => onNavigate('model')}
        />

        {/* Shortcuts */}
        <Text style={s.sectionTitle}>快捷键</Text>
        <Text style={s.sectionDesc}>{t('shortcutDesc')}</Text>
        <SettingsRow
          label={t('shortcutRecording')}
          value={
            config.shortcut.key
              ? `${config.shortcut.modifier}+${config.shortcut.key}`
              : t('noShortcut')
          }
          onPress={() => onNavigate('shortcut')}
        />
      </ScrollView>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.bg,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 60,
      paddingBottom: 14,
      backgroundColor: c.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    menuBtn: {
      minWidth: 44,
      paddingVertical: 4,
    },
    menuIcon: {
      fontSize: 20,
      color: c.textSecondary,
    },
    title: {
      fontSize: 17,
      fontWeight: '600',
      color: c.text,
    },
    spacer: {
      minWidth: 44,
    },
    scroll: {
      flex: 1,
    },
    sectionTitle: {
      fontSize: 12,
      fontWeight: '600',
      color: c.textMuted,
      paddingHorizontal: 20,
      marginTop: 24,
      marginBottom: 4,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    sectionDesc: {
      fontSize: 12,
      color: c.textMuted,
      paddingHorizontal: 20,
      marginBottom: 4,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 14,
      backgroundColor: c.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    rowLabel: {
      fontSize: 15,
      color: c.text,
    },
    toggle: {
      paddingHorizontal: 16,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: c.bgSecondary,
    },
    toggleActive: {
      backgroundColor: c.accent,
    },
    toggleText: {
      fontSize: 13,
      color: c.textSecondary,
    },
    toggleTextActive: {
      color: '#ffffff',
    },
  });
}
