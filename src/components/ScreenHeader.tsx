import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import TouchableOpacity from './TouchableOpacityCompat';
import {useI18n} from '../i18n/I18nContext';
import {useTheme, type ThemeColors} from '../theme/ThemeContext';

interface Props {
  title: string;
  onMenuPress?: () => void;
  rightAction?: {label: string; onPress: () => void};
}

export default function ScreenHeader({title, onMenuPress, rightAction}: Props) {
  const {t} = useI18n();
  const {colors} = useTheme();
  const s = makeStyles(colors);

  return (
    <View style={s.header}>
      {onMenuPress ? (
        <TouchableOpacity onPress={onMenuPress} style={s.menuBtn}>
          <Text style={s.menuIcon}>☰</Text>
        </TouchableOpacity>
      ) : (
        <View style={s.spacer} />
      )}
      <Text style={s.title}>{title}</Text>
      {rightAction ? (
        <TouchableOpacity onPress={rightAction.onPress} style={s.rightBtn}>
          <Text style={s.rightText}>{rightAction.label}</Text>
        </TouchableOpacity>
      ) : (
        <View style={s.spacer} />
      )}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
      backgroundColor: c.card,
    },
    title: {
      fontSize: 16,
      fontWeight: '600',
      color: c.text,
      textAlign: 'center',
      flex: 1,
    },
    menuBtn: {
      minWidth: 44,
      paddingVertical: 4,
    },
    menuIcon: {
      fontSize: 20,
      color: c.textSecondary,
    },
    rightBtn: {
      minWidth: 44,
      alignItems: 'flex-end',
    },
    rightText: {
      fontSize: 15,
      color: c.accent,
    },
    spacer: {
      minWidth: 44,
    },
  });
}
