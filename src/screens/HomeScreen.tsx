import React from 'react';
import {View, Text, StyleSheet, ScrollView} from 'react-native';
import {useI18n} from '../i18n/I18nContext';
import {useTheme, type ThemeColors} from '../theme/ThemeContext';

export default function HomeScreen() {
  const {t} = useI18n();
  const {colors} = useTheme();
  const s = makeStyles(colors);

  return (
    <View style={s.container}>
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.cardRow}>
          <View style={[s.card, s.cardWide]}>
            <Text style={s.cardValue}>0</Text>
            <Text style={s.cardLabel}>{t('homeTodayRecord')}</Text>
          </View>
        </View>

        <View style={s.cardRow}>
          <View style={s.card}>
            <Text style={s.cardValue}>0</Text>
            <Text style={s.cardLabel}>{t('homeTotalRecords')}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardValue}>0</Text>
            <Text style={s.cardLabel}>{t('homeWordsProcessed')}</Text>
          </View>
        </View>

        <View style={s.cardRow}>
          <View style={s.card}>
            <Text style={s.cardValue}>0</Text>
            <Text style={s.cardLabel}>{t('homeMemoryWords')}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardValue}>0</Text>
            <Text style={s.cardLabel}>{t('homeMemorySentences')}</Text>
          </View>
        </View>

        <Text style={s.sectionTitle}>{t('homeRecentActivity')}</Text>
        <View style={s.emptyCard}>
          <Text style={s.emptyText}>{t('homeEmptyRecord')}</Text>
          <Text style={s.emptyHint}>{t('homeEmptyHint')}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: {flex: 1, backgroundColor: c.bg},
    scroll: {flex: 1, paddingHorizontal: 20, paddingTop: 16},
    cardRow: {flexDirection: 'row', marginBottom: 10},
    card: {
      flex: 1,
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 20,
      marginHorizontal: 4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    cardWide: {flex: 1},
    cardValue: {fontSize: 32, fontWeight: '700', color: c.accent},
    cardLabel: {fontSize: 13, color: c.textMuted, marginTop: 6},
    sectionTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: c.textMuted,
      marginTop: 20,
      marginBottom: 10,
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
      marginBottom: 24,
    },
    emptyText: {fontSize: 15, color: c.textSecondary},
    emptyHint: {fontSize: 12, color: c.textMuted, marginTop: 6},
  });
}
