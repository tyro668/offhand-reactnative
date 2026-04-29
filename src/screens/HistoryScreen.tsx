import React, {useState, useCallback, useEffect} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Share,
  TextInput,
} from 'react-native';
import {useTheme, type ThemeColors} from '../theme/ThemeContext';
import {
  addMemoryCorpus,
  loadHistoryPage,
  deleteHistory,
  clearHistory,
  getHistoryCount,
  type HistoryRow,
} from '../db/database';

const PAGE_SIZE = 20;

export default function HistoryScreen() {
  const {colors} = useTheme();
  const s = makeStyles(colors);
  const [records, setRecords] = useState<HistoryRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editingMemoryId, setEditingMemoryId] = useState<number | null>(null);
  const [memoryDraft, setMemoryDraft] = useState('');

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const refresh = useCallback(async () => {
    try {
      const {rows, total: t} = await loadHistoryPage(page, PAGE_SIZE);
      setRecords(rows);
      setTotal(t);
    } catch (e) {
      console.warn('History load error:', e);
    }
  }, [page]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-check count after delete/clear
  const afterDelete = async () => {
    const count = await getHistoryCount();
    setTotal(count);
    const maxPage = Math.max(1, Math.ceil(count / PAGE_SIZE));
    if (page > maxPage) {
      setPage(maxPage);
    } else {
      refresh();
    }
  };

  const handleCopy = (text: string) => {
    Share.share({message: text});
  };

  const handleDelete = (id: number) => {
    Alert.alert('确认删除', '确定要删除这条记录吗？', [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteHistory(id);
          setExpanded(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          await afterDelete();
        },
      },
    ]);
  };

  const beginMemoryEdit = (record: HistoryRow) => {
    setEditingMemoryId(record.id);
    setMemoryDraft(record.enhanced_text);
  };

  const cancelMemoryEdit = () => {
    setEditingMemoryId(null);
    setMemoryDraft('');
  };

  const saveMemoryCorpus = async (record: HistoryRow) => {
    const content = memoryDraft.trim();
    if (!content) {
      Alert.alert('内容为空', '加入记忆库的语料内容不能为空。');
      return;
    }

    try {
      await addMemoryCorpus({
        type: 'history',
        title: memoryTitleFromHistory(content, record.created_at),
        content,
        enabled: true,
      });
      cancelMemoryEdit();
      Alert.alert('已加入记忆库', '这段语料已保存为历史精选语料。');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      Alert.alert('保存失败', message);
    }
  };

  const handleClearAll = () => {
    Alert.alert('清空历史', '确定要删除全部历史记录吗？', [
      {text: '取消', style: 'cancel'},
      {
        text: '清空',
        style: 'destructive',
        onPress: async () => {
          await clearHistory();
          setExpanded(new Set());
          setPage(1);
          await refresh();
        },
      },
    ]);
  };

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const formatRecordTime = (record: HistoryRow) => {
    if (record.enhance_elapsed_ms == null) {
      return record.created_at;
    }
    return `${record.created_at} · 增强耗时 ${record.enhance_elapsed_ms} ms`;
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>历史</Text>
        {total > 0 && (
          <TouchableOpacity onPress={handleClearAll}>
            <Text style={s.clearText}>清空</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={s.scroll}
        showsVerticalScrollIndicator={true}
        contentContainerStyle={s.scrollContent}>
        {records.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyText}>暂无历史记录</Text>
          </View>
        ) : (
          records.map(record => {
            const showOriginal = expanded.has(record.id);
            const editingMemory = editingMemoryId === record.id;
            return (
              <View key={record.id} style={s.card}>
                <View style={s.actionBar}>
                  <TouchableOpacity
                    style={[s.actionBtn, editingMemory && s.actionBtnActive]}
                    onPress={() => beginMemoryEdit(record)}>
                    <Text style={[s.actionText, editingMemory && s.actionTextActive]}>
                      编辑
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.actionBtn}
                    onPress={() => handleCopy(record.enhanced_text)}>
                    <Text style={s.actionText}>复制</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.actionBtn}
                    onPress={() => handleDelete(record.id)}>
                    <Text style={[s.actionText, s.deleteAction]}>删除</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.actionBtn, showOriginal && s.actionBtnActive]}
                    onPress={() => toggleExpand(record.id)}>
                    <Text style={[s.actionText, showOriginal && s.actionTextActive]}>
                      原始文本
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={s.enhancedText} selectable>
                  {record.enhanced_text}
                </Text>

                {editingMemory && (
                  <View style={s.memoryEditor}>
                    <Text style={s.memoryEditorLabel}>编辑后加入记忆库</Text>
                    <TextInput
                      style={s.memoryEditorInput}
                      value={memoryDraft}
                      onChangeText={setMemoryDraft}
                      placeholder="输入语料内容"
                      placeholderTextColor={colors.textMuted}
                      multiline
                      textAlignVertical="top"
                    />
                    <View style={s.memoryEditorActions}>
                      <TouchableOpacity style={s.editorSecondaryBtn} onPress={cancelMemoryEdit}>
                        <Text style={s.editorSecondaryText}>取消</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={s.editorPrimaryBtn}
                        onPress={() => saveMemoryCorpus(record)}>
                        <Text style={s.editorPrimaryText}>加入记忆库</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {showOriginal && (
                  <View style={s.originalBlock}>
                    <View style={s.originalDivider} />
                    <Text style={s.originalLabel}>原始文本</Text>
                    <Text style={s.originalText} selectable>
                      {record.original_text}
                    </Text>
                  </View>
                )}

                <Text style={s.timeText}>{formatRecordTime(record)}</Text>
              </View>
            );
          })
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <View style={s.pagination}>
            <TouchableOpacity
              style={[s.pageBtn, page <= 1 && s.pageBtnDisabled]}
              onPress={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}>
              <Text style={[s.pageBtnText, page <= 1 && s.pageBtnTextDisabled]}>
                上一页
              </Text>
            </TouchableOpacity>

            <Text style={s.pageInfo}>
              {page} / {totalPages}
            </Text>

            <TouchableOpacity
              style={[s.pageBtn, page >= totalPages && s.pageBtnDisabled]}
              onPress={() => setPage(p => p + 1)}
              disabled={page >= totalPages}>
              <Text style={[s.pageBtnText, page >= totalPages && s.pageBtnTextDisabled]}>
                下一页
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={s.bottomSpacer} />
      </ScrollView>
    </View>
  );
}

function memoryTitleFromHistory(content: string, createdAt: string): string {
  const firstLine = content.split(/\r?\n/).find(line => line.trim())?.trim() ?? '';
  const compact = firstLine.replace(/\s+/g, ' ');
  const prefix = compact.length > 18 ? `${compact.slice(0, 18)}...` : compact;
  return prefix ? `历史精选：${prefix}` : `历史精选：${createdAt}`;
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: {flex: 1, backgroundColor: c.bg},
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 28,
      paddingTop: 24,
      paddingBottom: 14,
    },
    title: {fontSize: 26, fontWeight: '700', color: c.text, letterSpacing: 2},
    clearText: {fontSize: 14, color: c.accent},
    scroll: {flex: 1},
    scrollContent: {paddingHorizontal: 20},
    empty: {paddingVertical: 60, alignItems: 'center'},
    emptyText: {fontSize: 14, color: c.textMuted},

    card: {
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 16,
      marginBottom: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    actionBar: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginBottom: 10,
    },
    actionBtn: {
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: c.border,
      marginLeft: 8,
    },
    actionBtnActive: {borderColor: c.accent, backgroundColor: c.accentLight},
    actionText: {fontSize: 12, color: c.textSecondary},
    actionTextActive: {color: c.accent, fontWeight: '500'},
    deleteAction: {color: c.danger},
    enhancedText: {fontSize: 14, color: c.text, lineHeight: 22},
    memoryEditor: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    memoryEditorLabel: {
      fontSize: 11,
      color: c.textMuted,
      fontWeight: '600',
      marginBottom: 8,
    },
    memoryEditorInput: {
      minHeight: 120,
      fontSize: 13,
      color: c.text,
      backgroundColor: c.bg,
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      lineHeight: 20,
    },
    memoryEditorActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: 10,
    },
    editorSecondaryBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 5,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      marginRight: 8,
    },
    editorSecondaryText: {fontSize: 12, color: c.textSecondary},
    editorPrimaryBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 5,
      backgroundColor: c.accent,
    },
    editorPrimaryText: {fontSize: 12, color: '#ffffff', fontWeight: '600'},
    originalBlock: {marginTop: 10},
    originalDivider: {height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginBottom: 10},
    originalLabel: {fontSize: 11, color: c.textMuted, fontWeight: '600', marginBottom: 6},
    originalText: {fontSize: 13, color: c.textSecondary, lineHeight: 20},
    timeText: {fontSize: 11, color: c.textMuted, marginTop: 10},

    pagination: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 16,
    },
    pageBtn: {
      paddingHorizontal: 20,
      paddingVertical: 8,
      borderRadius: 6,
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    pageBtnDisabled: {opacity: 0.4},
    pageBtnText: {fontSize: 13, color: c.textSecondary},
    pageBtnTextDisabled: {color: c.textMuted},
    pageInfo: {fontSize: 13, color: c.textMuted, marginHorizontal: 16},
    bottomSpacer: {height: 24},
  });
}
