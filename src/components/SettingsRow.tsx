import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {useTheme, type ThemeColors} from '../theme/ThemeContext';

interface Props {
  label: string;
  value?: string;
  onPress: () => void;
}

export default function SettingsRow({label, value, onPress}: Props) {
  const {colors} = useTheme();
  const s = makeStyles(colors);

  return (
    <TouchableOpacity onPress={onPress} style={s.row}>
      <Text style={s.label}>{label}</Text>
      <View style={s.right}>
        {value ? <Text style={s.value}>{value}</Text> : null}
        <Text style={s.arrow}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 16,
      backgroundColor: c.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    label: {
      fontSize: 15,
      color: c.text,
    },
    right: {
      flexDirection: 'row',
      alignItems: 'center',
      marginLeft: 8,
    },
    value: {
      fontSize: 14,
      color: c.textMuted,
      marginRight: 8,
    },
    arrow: {
      fontSize: 20,
      color: c.textMuted,
    },
  });
}
