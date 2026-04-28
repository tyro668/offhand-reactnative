import React from 'react';
import {View, Text, StyleSheet, ScrollView} from 'react-native';
import {useI18n} from '../i18n/I18nContext';
import {useTheme, type ThemeColors} from '../theme/ThemeContext';

interface Props {
  onMenuPress: () => void;
}

export default function HomeScreen({onMenuPress}: Props) {
  const {t} = useI18n();
  const {colors} = useTheme();
  const s = makeStyles(colors);

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.greeting}>{t('appName')}</Text>
        <Text style={s.date}>
          {new Date().toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long',
          })}
        </Text>
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Stats cards */}
        <View style={s.cardRow}>
          <View style={[s.card, s.cardWide]}>
            <Text style={s.cardValue}>0</Text>
            <Text style={s.cardLabel}>今日录音 (分钟)</Text>
          </View>
        </View>

        <View style={s.cardRow}>
          <View style={s.card}>
            <Text style={s.cardValue}>0</Text>
            <Text style={s.cardLabel}>总录音次数</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardValue}>0</Text>
            <Text style={s.cardLabel}>处理字数</Text>
          </View>
        </View>

        <View style={s.cardRow}>
          <View style={s.card}>
            <Text style={s.cardValue}>0</Text>
            <Text style={s.cardLabel}>记忆词组</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardValue}>0</Text>
            <Text style={s.cardLabel}>情景语句</Text>
          </View>
        </View>

        <Text style={s.sectionTitle}>最近活动</Text>
        <View style={s.emptyCard}>
          <Text style={s.emptyText}>暂无录音记录</Text>
          <Text style={s.emptyHint}>按下快捷键开始语音输入</Text>
        </View>
      </ScrollView>

      {/* Bottom menu trigger */}
      <View style={s.bottomBar}>
        <Text style={s.bottomHint}>← 点击左上角菜单</Text>
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
      paddingHorizontal: 24,
      paddingTop: 60,
      paddingBottom: 20,
      backgroundColor: c.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    greeting: {
      fontSize: 28,
      fontWeight: '700',
      color: c.text,
      letterSpacing: 2,
    },
    date: {
      fontSize: 13,
      color: c.textMuted,
      marginTop: 6,
    },
    scroll: {
      flex: 1,
      paddingHorizontal: 16,
      paddingTop: 16,
    },
    cardRow: {
      flexDirection: 'row',
      marginBottom: 10,
    },
    card: {
      flex: 1,
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 20,
      marginHorizontal: 4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    cardWide: {
      flex: 1,
    },
    cardValue: {
      fontSize: 32,
      fontWeight: '700',
      color: c.accent,
    },
    cardLabel: {
      fontSize: 13,
      color: c.textMuted,
      marginTop: 6,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: c.textMuted,
      marginTop: 20,
      marginBottom: 10,
      paddingHorizontal: 4,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    emptyCard: {
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 32,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    emptyText: {
      fontSize: 15,
      color: c.textSecondary,
    },
    emptyHint: {
      fontSize: 12,
      color: c.textMuted,
      marginTop: 6,
    },
    bottomBar: {
      paddingVertical: 12,
      alignItems: 'center',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      backgroundColor: c.card,
    },
    bottomHint: {
      fontSize: 12,
      color: c.textMuted,
    },
  });
}
