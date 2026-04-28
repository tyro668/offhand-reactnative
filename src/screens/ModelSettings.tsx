import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {useI18n} from '../i18n/I18nContext';
import {useTheme, type ThemeColors} from '../theme/ThemeContext';

const MODELS = ['modelGPT4', 'modelClaude', 'modelGemini', 'modelLocal'];

interface Props {
  current: string;
  onSelect: (model: string) => void;
  onBack: () => void;
}

export default function ModelSettings({current, onSelect, onBack}: Props) {
  const {t} = useI18n();
  const {colors} = useTheme();
  const s = makeStyles(colors);

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={s.backBtn}>← 返回</Text>
        </TouchableOpacity>
        <Text style={s.title}>{t('textModel')}</Text>
        <View style={s.spacer} />
      </View>
      <Text style={s.desc}>{t('textModelDesc')}</Text>
      <View style={s.list}>
        {MODELS.map(model => (
          <TouchableOpacity
            key={model}
            style={[s.option, current === model && s.optionSelected]}
            onPress={() => onSelect(model)}>
            <Text
              style={[
                s.optionText,
                current === model && s.optionTextSelected,
              ]}>
              {t(model)}
            </Text>
            {current === model && <Text style={s.check}>✓</Text>}
          </TouchableOpacity>
        ))}
      </View>
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
    backBtn: {
      fontSize: 15,
      color: c.accent,
    },
    title: {
      fontSize: 17,
      fontWeight: '600',
      color: c.text,
    },
    spacer: {
      minWidth: 44,
    },
    desc: {
      fontSize: 13,
      color: c.textMuted,
      paddingHorizontal: 20,
      paddingVertical: 16,
    },
    list: {
      paddingHorizontal: 12,
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 16,
      marginVertical: 2,
      borderRadius: 8,
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    optionSelected: {
      borderColor: c.accent,
      backgroundColor: c.accentLight,
    },
    optionText: {
      fontSize: 15,
      color: c.text,
    },
    optionTextSelected: {
      color: c.accent,
      fontWeight: '500',
    },
    check: {
      fontSize: 16,
      color: c.accent,
    },
  });
}
