import React, {useState, useCallback} from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {useI18n} from '../i18n/I18nContext';
import {useTheme, type ThemeColors} from '../theme/ThemeContext';

const MODIFIERS = [
  {id: 'Cmd', label: '⌘ Cmd'},
  {id: 'Ctrl', label: '⌃ Ctrl'},
  {id: 'Opt', label: '⌥ Opt'},
  {id: 'Shift', label: '⇧ Shift'},
];

const KEYS = ['V', 'R', 'Space', 'F1', 'F2', 'F3', 'F4', 'F5'];

interface Props {
  modifier: string;
  shortcutKey: string;
  onSave: (modifier: string, key: string) => void;
  onBack: () => void;
}

export default function ShortcutSettings({
  modifier,
  shortcutKey,
  onSave,
  onBack,
}: Props) {
  const {t} = useI18n();
  const {colors} = useTheme();
  const s = makeStyles(colors);
  const [mod, setMod] = useState(modifier || 'Cmd');
  const [key, setKey] = useState(shortcutKey || '');

  const handleSave = useCallback(() => {
    onSave(mod, key);
    onBack();
  }, [mod, key, onSave, onBack]);

  const handleClear = useCallback(() => {
    onSave('', '');
    onBack();
  }, [onSave, onBack]);

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} style={s.backBtn}>
          <Text style={s.backText}>{t('backBtn')}</Text>
        </TouchableOpacity>
        <Text style={s.title}>{t('shortcutRecording')}</Text>
        <TouchableOpacity onPress={handleSave}>
          <Text style={s.saveText}>{t('save')}</Text>
        </TouchableOpacity>
      </View>

      <View style={s.body}>
        <Text style={s.sectionLabel}>{t('modifierKey')}</Text>
        <View style={s.grid}>
          {MODIFIERS.map(m => (
            <TouchableOpacity
              key={m.id}
              style={[s.chip, mod === m.id && s.chipSelected]}
              onPress={() => setMod(m.id)}>
              <Text style={[s.chipText, mod === m.id && s.chipTextSelected]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.sectionLabel}>{t('mainKey')}</Text>
        <View style={s.grid}>
          {KEYS.map(k => (
            <TouchableOpacity
              key={k}
              style={[s.chip, key === k && s.chipSelected]}
              onPress={() => setKey(k)}>
              <Text style={[s.chipText, key === k && s.chipTextSelected]}>{k}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.preview}>
          <Text style={s.previewLabel}>{t('currentShortcut')}</Text>
          <Text style={s.previewKey}>
            {key ? `${mod}+${key}` : t('noShortcut')}
          </Text>
        </View>

        <TouchableOpacity style={s.clearBtn} onPress={handleClear}>
          <Text style={s.clearText}>{t('clearShortcut')}</Text>
        </TouchableOpacity>
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
    saveText: {fontSize: 15, color: c.accent, fontWeight: '500'},
    body: {paddingHorizontal: 20},
    sectionLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: c.textMuted,
      marginTop: 12,
      marginBottom: 10,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    grid: {flexDirection: 'row', flexWrap: 'wrap'},
    chip: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      marginRight: 8,
      marginBottom: 8,
    },
    chipSelected: {borderColor: c.accent, backgroundColor: c.accentLight},
    chipText: {fontSize: 14, color: c.textSecondary},
    chipTextSelected: {color: c.accent, fontWeight: '500'},
    preview: {
      marginTop: 24,
      padding: 20,
      borderRadius: 12,
      backgroundColor: c.card,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    previewLabel: {fontSize: 12, color: c.textMuted, marginBottom: 8},
    previewKey: {fontSize: 22, fontWeight: '600', color: c.text, letterSpacing: 2},
    clearBtn: {
      marginTop: 16,
      paddingVertical: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.danger,
      alignItems: 'center',
      opacity: 0.5,
    },
    clearText: {fontSize: 14, color: c.danger},
  });
}
