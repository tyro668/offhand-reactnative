import React from 'react';
import {Platform, View, Text, StyleSheet} from 'react-native';
import TouchableOpacity from '../components/TouchableOpacityCompat';
import {useI18n} from '../i18n/I18nContext';
import {useTheme, type ThemeColors} from '../theme/ThemeContext';

interface Props {
  modifier: string;
  shortcutKey: string;
  onSave: (modifier: string, key: string) => void;
  onBack: () => void;
}

// macOS listens to the hardware fn key. Windows cannot reliably observe fn at
// the OS level, so the native bridge uses F8 for the same global toggle flow.
export default function ShortcutSettings({onBack}: Props) {
  const {t} = useI18n();
  const {colors} = useTheme();
  const s = makeStyles(colors);
  const shortcutKey = Platform.OS === 'windows' ? 'F8' : 'fn';
  const shortcutHint =
    Platform.OS === 'windows' ? t('windowsShortcutHint') : t('fnShortcutHint');
  const permissionHint =
    Platform.OS === 'windows' ? t('windowsPermissionHint') : t('fnPermissionHint');

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} style={s.backBtn}>
          <Text style={s.backText}>{t('backBtn')}</Text>
        </TouchableOpacity>
        <Text style={s.title}>{t('shortcutRecording')}</Text>
        <View style={s.backBtn} />
      </View>

      <View style={s.body}>
        <View style={s.preview}>
          <Text style={s.previewLabel}>{t('currentShortcut')}</Text>
          <Text style={s.previewKey}>{shortcutKey}</Text>
        </View>

        <Text style={s.hint}>{shortcutHint}</Text>
        <Text style={s.permissionHint}>{permissionHint}</Text>
      </View>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: {flex: 1, backgroundColor: c.bg},
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 28,
      paddingTop: 32,
      paddingBottom: 16,
    },
    backBtn: {minWidth: 60},
    backText: {fontSize: 15, color: c.accent},
    title: {fontSize: 17, fontWeight: '600', color: c.text},
    body: {paddingHorizontal: 20},
    preview: {
      marginTop: 24,
      padding: 24,
      borderRadius: 12,
      backgroundColor: c.card,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    previewLabel: {fontSize: 12, color: c.textMuted, marginBottom: 10},
    previewKey: {fontSize: 28, fontWeight: '700', color: c.text, letterSpacing: 2},
    hint: {fontSize: 13, color: c.textSecondary, marginTop: 20, lineHeight: 20},
    permissionHint: {fontSize: 12, color: c.textMuted, marginTop: 16, lineHeight: 18},
  });
}
