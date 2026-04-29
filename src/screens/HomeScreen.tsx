import React, {useState, useCallback, useEffect} from 'react';
import {View, Text, StyleSheet, ScrollView, TouchableOpacity} from 'react-native';
import {useTheme, type ThemeColors} from '../theme/ThemeContext';
import {loadStatsSummary, type StatsSummary, type StatRow} from '../db/database';

type Dimension = 'day' | 'week' | 'month';

const DIMS: {key: Dimension; label: string}[] = [
  {key: 'day', label: '日'},
  {key: 'week', label: '周'},
  {key: 'month', label: '月'},
];

export default function HomeScreen() {
  const {colors} = useTheme();
  const s = makeStyles(colors);
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [dim, setDim] = useState<Dimension>('day');

  const refresh = useCallback(async () => {
    try {
      const data = await loadStatsSummary();
      setStats(data);
    } catch (e) {
      console.warn('Stats load error:', e);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!stats) {
    return (
      <View style={s.container}>
        <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
          <View style={s.empty}>
            <Text style={s.emptyText}>加载中...</Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  const formatDuration = (sec: number) => {
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  };

  const formatCount = (n: number) => {
    if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
    return String(n);
  };

  const chartData: Array<{label: string} & StatRow> =
    dim === 'day' ? stats.daily.map(d => ({...d, label: d.date.slice(5)})) :
    dim === 'week' ? stats.weekly :
    stats.monthly;

  const maxRecordingCount = Math.max(1, ...chartData.map(d => d.recording_count));

  return (
    <View style={s.container}>
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.highlightCard}>
          <Text style={s.highlightLabel}>今日</Text>
          <View style={s.highlightRow}>
            <View style={s.highlightItem}>
              <Text style={s.highlightValue}>
                {formatDuration(Math.round(stats.today.audio_duration_sec))}
              </Text>
              <Text style={s.highlightUnit}>语音时长</Text>
            </View>
            <View style={s.highlightItem}>
              <Text style={s.highlightValue}>
                {formatCount(stats.today.original_chars + stats.today.enhanced_chars)}
              </Text>
              <Text style={s.highlightUnit}>处理字数</Text>
            </View>
            <View style={s.highlightItem}>
              <Text style={s.highlightValue}>{stats.today.recording_count}</Text>
              <Text style={s.highlightUnit}>录音次数</Text>
            </View>
          </View>
        </View>

        <View style={s.cardRow}>
          <View style={s.card}>
            <Text style={s.cardValue}>{formatDuration(Math.round(stats.thisWeek.audio_duration_sec))}</Text>
            <Text style={s.cardLabel}>本周时长</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardValue}>{formatDuration(Math.round(stats.thisMonth.audio_duration_sec))}</Text>
            <Text style={s.cardLabel}>本月时长</Text>
          </View>
        </View>

        <View style={s.cardRow}>
          <View style={s.card}>
            <Text style={s.cardValue}>{formatCount(stats.total.original_chars)}</Text>
            <Text style={s.cardLabel}>累计输入字数</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardValue}>{formatCount(stats.total.enhanced_chars)}</Text>
            <Text style={s.cardLabel}>累计输出字数</Text>
          </View>
        </View>

        <View style={s.cardRow}>
          <View style={s.card}>
            <Text style={s.cardValue}>{formatCount(stats.total.input_tokens)}</Text>
            <Text style={s.cardLabel}>输入 Token</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardValue}>{formatCount(stats.total.output_tokens)}</Text>
            <Text style={s.cardLabel}>输出 Token</Text>
          </View>
        </View>

        {/* Dimension switcher */}
        <View style={s.dimRow}>
          {DIMS.map(d => (
            <TouchableOpacity
              key={d.key}
              style={[s.dimBtn, dim === d.key && s.dimBtnActive]}
              onPress={() => setDim(d.key)}>
              <Text style={[s.dimBtnText, dim === d.key && s.dimBtnTextActive]}>
                {d.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Chart: recording count */}
        <Text style={s.sectionTitle}>
          录音次数（{dim === 'day' ? '近7日' : dim === 'week' ? '近8周' : '近6月'}）
        </Text>
        <View style={s.chartCard}>
          <View style={s.barChart}>
            {chartData.map(d => (
              <View key={d.label} style={s.barColumn}>
                <Text style={s.barValue}>
                  {d.recording_count > 0 ? d.recording_count : ''}
                </Text>
                <View style={s.barWrap}>
                  <View
                    style={[s.bar, {
                      height: d.recording_count > 0
                        ? Math.max(4, (d.recording_count / maxRecordingCount) * 80)
                        : 2,
                      backgroundColor: d.recording_count > 0 ? colors.accent : colors.border,
                    }]}
                  />
                </View>
                <Text style={s.barLabel}>{d.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <Text style={s.sectionTitle}>Token 消耗</Text>
        <View style={s.chartCard}>
          <View style={s.barChart}>
            {chartData.map(d => {
              const total = d.input_tokens + d.output_tokens;
              const inPct = total > 0 ? d.input_tokens / total : 0;
              const outPct = total > 0 ? d.output_tokens / total : 0;
              return (
                <View key={d.label} style={s.barColumn}>
                  <Text style={s.barValue}>{total > 0 ? formatCount(total) : ''}</Text>
                  <View style={s.barWrap}>
                    <View style={s.barStack}>
                      <View style={[s.barSegment, {height: Math.max(0, inPct * 40), backgroundColor: colors.accent}]} />
                      <View style={[s.barSegment, {height: Math.max(0, outPct * 40), backgroundColor: colors.textMuted}]} />
                    </View>
                  </View>
                  <Text style={s.barLabel}>{d.label}</Text>
                </View>
              );
            })}
          </View>
          <View style={s.legend}>
            <View style={s.legendItem}>
              <View style={[s.legendDot, {backgroundColor: colors.accent}]} />
              <Text style={s.legendText}>输入</Text>
            </View>
            <View style={s.legendItem}>
              <View style={[s.legendDot, {backgroundColor: colors.textMuted}]} />
              <Text style={s.legendText}>输出</Text>
            </View>
          </View>
        </View>

        <View style={{height: 24}} />
      </ScrollView>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: {flex: 1, backgroundColor: c.bg},
    scroll: {flex: 1, paddingHorizontal: 20, paddingTop: 20},
    empty: {paddingVertical: 60, alignItems: 'center'},
    emptyText: {fontSize: 15, color: c.textMuted},

    highlightCard: {backgroundColor: c.accent, borderRadius: 14, padding: 20, marginBottom: 12},
    highlightLabel: {fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 12, fontWeight: '600'},
    highlightRow: {flexDirection: 'row', justifyContent: 'space-between'},
    highlightItem: {alignItems: 'center'},
    highlightValue: {fontSize: 28, fontWeight: '700', color: '#ffffff'},
    highlightUnit: {fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 4},

    cardRow: {flexDirection: 'row', marginBottom: 8},
    card: {flex: 1, backgroundColor: c.card, borderRadius: 10, padding: 16, marginHorizontal: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border},
    cardValue: {fontSize: 22, fontWeight: '700', color: c.text},
    cardLabel: {fontSize: 11, color: c.textMuted, marginTop: 4},

    dimRow: {flexDirection: 'row', justifyContent: 'center', marginTop: 16, marginBottom: 4},
    dimBtn: {paddingHorizontal: 24, paddingVertical: 7, borderRadius: 16, marginHorizontal: 4, backgroundColor: c.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border},
    dimBtnActive: {backgroundColor: c.accent, borderColor: c.accent},
    dimBtnText: {fontSize: 13, color: c.textSecondary},
    dimBtnTextActive: {color: '#ffffff', fontWeight: '500'},

    sectionTitle: {fontSize: 13, fontWeight: '600', color: c.textMuted, marginTop: 20, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1},
    chartCard: {backgroundColor: c.card, borderRadius: 12, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, marginBottom: 8},
    barChart: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 130},
    barColumn: {alignItems: 'center', flex: 1},
    barValue: {fontSize: 10, color: c.textMuted, marginBottom: 4},
    barWrap: {flex: 1, justifyContent: 'flex-end', width: '100%', alignItems: 'center'},
    bar: {width: 16, borderRadius: 3, minHeight: 2},
    barLabel: {fontSize: 10, color: c.textMuted, marginTop: 4},
    barStack: {width: 16, justifyContent: 'flex-end', alignItems: 'center'},
    barSegment: {width: 16, minHeight: 0, borderRadius: 2},
    legend: {flexDirection: 'row', justifyContent: 'center', marginTop: 8},
    legendItem: {flexDirection: 'row', alignItems: 'center', marginHorizontal: 8},
    legendDot: {width: 8, height: 8, borderRadius: 4, marginRight: 4},
    legendText: {fontSize: 11, color: c.textMuted},
  });
}
