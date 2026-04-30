import React, {useState, useCallback, useEffect, useMemo} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  NativeModules,
} from 'react-native';
import TouchableOpacity from '../components/TouchableOpacityCompat';
import {useTheme, type ThemeColors} from '../theme/ThemeContext';
import {
  loadMemoryCorpus,
  addMemoryCorpus,
  updateMemoryCorpus,
  deleteMemoryCorpus,
  type MemoryCorpusRow,
} from '../db/database';
import {
  buildMemoryContextUsage,
  estimateMemoryItemTokens,
  type MemoryContextContribution,
} from '../services/memoryContext';

type MarkdownImportResult = {
  fileName?: string;
  filePath?: string;
  content?: string;
} | null;

const {MarkdownFileImporter} = NativeModules;

function markdownTitleFromFileName(fileName?: string) {
  if (!fileName) return 'Untitled';
  return fileName.replace(/\.(md|markdown)$/i, '') || 'Untitled';
}

function formatTokenCount(value: number) {
  return value.toLocaleString('en-US');
}

function getTokenLabel(
  item: MemoryCorpusRow,
  enabled: boolean,
  contribution?: MemoryContextContribution,
) {
  const fullTokens = contribution?.fullTokens ?? estimateMemoryItemTokens(item);
  if (!enabled) {
    return `启用后约 ${formatTokenCount(fullTokens)} tokens`;
  }

  if (!contribution || !contribution.included) {
    return `当前未传入 · 完整约 ${formatTokenCount(fullTokens)} tokens`;
  }

  const passed = formatTokenCount(contribution.passedTokens);
  if (!contribution.truncated) {
    return `本次传入约 ${passed} tokens`;
  }

  return `本次传入约 ${passed} tokens · 完整约 ${formatTokenCount(fullTokens)} tokens · 已截断`;
}

type TabKey = 'markdown' | 'text';

const TABS: {key: TabKey; label: string}[] = [
  {key: 'markdown', label: 'Markdown 语料'},
  {key: 'text', label: '文本语料'},
];

export default function MemoryScreen() {
  const {colors} = useTheme();
  const s = makeStyles(colors);
  const [items, setItems] = useState<MemoryCorpusRow[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [tab, setTab] = useState<TabKey>('markdown');
  const [showNewTextForm, setShowNewTextForm] = useState(false);
  const [newTextContent, setNewTextContent] = useState('');

  const memoryUsageById = useMemo(() => {
    const enabledItems = items.filter(i => i.enabled === 1);
    const usage = buildMemoryContextUsage(enabledItems);
    const byId = new Map<number, MemoryContextContribution>();
    for (const contribution of usage.contributions) {
      if (typeof contribution.id === 'number') {
        byId.set(contribution.id, contribution);
      }
    }
    return byId;
  }, [items]);

  const newTextTokenCount = useMemo(() => {
    const content = newTextContent.trim();
    if (!content) {
      return 0;
    }
    return estimateMemoryItemTokens({
      type: 'history',
      title: content.slice(0, 20),
      content,
    });
  }, [newTextContent]);

  const refresh = useCallback(async () => {
    try {
      const rows = await loadMemoryCorpus();
      setItems(rows);
    } catch (e) {
      console.warn('Memory corpus load error:', e);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handlePickMarkdown = async () => {
    try {
      if (!MarkdownFileImporter?.importMarkdownFile) {
        Alert.alert('无法导入', '当前平台没有可用的 Markdown 文件选择器。');
        return;
      }

      const result = (await MarkdownFileImporter.importMarkdownFile()) as MarkdownImportResult;
      if (!result || !result.content) return;
      await addMemoryCorpus({
        type: 'markdown',
        title: markdownTitleFromFileName(result.fileName),
        content: result.content,
        sourcePath: result.filePath || null,
      });
      refresh();
      setTab('markdown');
    } catch (e) {
      console.warn('Markdown import error:', e);
      Alert.alert('导入失败', '无法读取这个 Markdown 文件，请确认文件内容为 UTF-8 文本。');
    }
  };

  const handleToggle = async (id: number, currentEnabled: boolean) => {
    await updateMemoryCorpus(id, {enabled: !currentEnabled});
    refresh();
  };

  const handleAddText = async () => {
    const content = newTextContent.trim();
    if (!content) {
      Alert.alert('内容为空', '请输入语料内容。');
      return;
    }
    await addMemoryCorpus({
      type: 'history',
      title: content.slice(0, 20),
      content,
      enabled: true,
    });
    setNewTextContent('');
    setShowNewTextForm(false);
    refresh();
    setTab('text');
  };

  const handleDelete = (id: number) => {
    Alert.alert('确认删除', '确定要删除这条记录吗？', [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => setDeleteTarget(id),
      },
    ]);
  };

  useEffect(() => {
    if (deleteTarget === null) return;
    let cancelled = false;
    deleteMemoryCorpus(deleteTarget)
      .then(() => {
        if (!cancelled) refresh();
      })
      .catch(e => console.warn('Delete error:', e))
      .finally(() => {
        if (!cancelled) setDeleteTarget(null);
      });
    return () => { cancelled = true; };
  }, [deleteTarget, refresh]);

  const handleStartEdit = (item: MemoryCorpusRow) => {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditContent(item.content);
  };

  const handleSaveEdit = async () => {
    if (editingId === null) return;
    await updateMemoryCorpus(editingId, {
      title: editTitle,
      content: editContent,
    });
    setEditingId(null);
    refresh();
  };

  const markdownItems = items.filter(i => i.type === 'markdown');
  const textItems = items.filter(i => i.type === 'history');
  const activeItems = tab === 'markdown' ? markdownItems : textItems;

  const renderItem = (item: MemoryCorpusRow) => {
    const isEditing = editingId === item.id;
    const enabled = item.enabled === 1;
    const tokenLabel = getTokenLabel(item, enabled, memoryUsageById.get(item.id));
    const editingTokenCount = isEditing
      ? estimateMemoryItemTokens({
        ...item,
        title: editTitle,
        content: editContent,
      })
      : 0;
    const actionButtons = (
      <View style={s.actions}>
        <TouchableOpacity style={s.actionBtn} onPress={() => handleStartEdit(item)}>
          <Text style={s.actionText}>编辑</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.actionBtn} onPress={() => handleToggle(item.id, enabled)}>
          <Text style={s.actionText}>{enabled ? '禁用' : '启用'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.actionBtn} onPress={() => handleDelete(item.id)}>
          <Text style={[s.actionText, s.delAction]}>删除</Text>
        </TouchableOpacity>
      </View>
    );

    return (
      <View key={item.id} style={s.item}>
        <View style={s.itemTop}>
          <TouchableOpacity
            style={s.statusDot}
            onPress={() => handleToggle(item.id, enabled)}>
            <View style={[s.dot, enabled ? s.dotOn : s.dotOff]} />
          </TouchableOpacity>

          <View style={s.itemBody}>
            {isEditing ? (
              <>
                <TextInput
                  style={s.editTitle}
                  value={editTitle}
                  onChangeText={setEditTitle}
                  placeholderTextColor={colors.textMuted}
                />
                <TextInput
                  style={[
                    s.editContent,
                    item.type === 'markdown' && s.markdownEditContent,
                  ]}
                  value={editContent}
                  onChangeText={setEditContent}
                  multiline
                  scrollEnabled
                  textAlignVertical="top"
                  placeholderTextColor={colors.textMuted}
                />
                <Text style={s.tokenMeta}>
                  当前编辑内容约 {formatTokenCount(editingTokenCount)} tokens
                </Text>
                <View style={s.editActions}>
                  <TouchableOpacity style={s.saveBtn} onPress={handleSaveEdit}>
                    <Text style={s.saveBtnText}>保存</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.cancelBtn}
                    onPress={() => setEditingId(null)}>
                    <Text style={s.cancelBtnText}>取消</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : item.type === 'markdown' ? (
              <View style={s.markdownPreview}>
                <View style={s.markdownHeader}>
                  <View style={s.markdownHeaderText}>
                    <Text style={[s.itemTitle, !enabled && s.itemTextDisabled]}>
                      {item.title}
                    </Text>
                    <Text style={[s.tokenMeta, !enabled && s.itemTextDisabled]}>
                      {tokenLabel}
                    </Text>
                  </View>
                  {actionButtons}
                </View>
                <ScrollView
                  style={[
                    s.markdownScroll,
                    !enabled && s.itemTextDisabled,
                  ]}
                  contentContainerStyle={s.markdownScrollContent}
                  showsVerticalScrollIndicator>
                  <Text selectable style={s.markdownText}>
                    {item.content}
                  </Text>
                </ScrollView>
              </View>
            ) : (
              <>
                <Text style={[s.tokenMeta, !enabled && s.itemTextDisabled]}>
                  {tokenLabel}
                </Text>
                <Text style={[s.itemPreview, !enabled && s.itemTextDisabled]} numberOfLines={5}>
                  {item.content}
                </Text>
              </>
            )}
          </View>

          {!isEditing && item.type !== 'markdown' && actionButtons}
        </View>
      </View>
    );
  };

  return (
    <View style={s.container}>
      {/* Tab switcher */}
      <View style={s.tabRow}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[s.tabBtn, tab === t.key && s.tabBtnActive]}
            onPress={() => setTab(t.key)}>
            <Text style={[s.tabText, tab === t.key && s.tabTextActive]}>
              {t.label}
              {t.key === 'markdown' && markdownItems.length > 0
                ? ` (${markdownItems.length})`
                : t.key === 'text' && textItems.length > 0
                ? ` (${textItems.length})`
                : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={s.scroll}
        showsVerticalScrollIndicator={true}
        contentContainerStyle={s.scrollContent}>
        {tab === 'markdown' && (
          <TouchableOpacity style={s.importRow} onPress={handlePickMarkdown}>
            <Text style={s.importRowText}>+ 导入 Markdown 文件</Text>
          </TouchableOpacity>
        )}

        {tab === 'text' && !showNewTextForm && (
          <TouchableOpacity style={s.importRow} onPress={() => setShowNewTextForm(true)}>
            <Text style={s.importRowText}>+ 添加文本语料</Text>
          </TouchableOpacity>
        )}

        {tab === 'text' && showNewTextForm && (
          <View style={s.newTextForm}>
            <TextInput
              style={s.editContent}
              value={newTextContent}
              onChangeText={setNewTextContent}
              placeholder="输入语料内容..."
              placeholderTextColor={colors.textMuted}
              multiline
              textAlignVertical="top"
              autoFocus
            />
            <Text style={s.tokenMeta}>
              当前内容约 {formatTokenCount(newTextTokenCount)} tokens
            </Text>
            <View style={s.editActions}>
              <TouchableOpacity style={s.saveBtn} onPress={handleAddText}>
                <Text style={s.saveBtnText}>保存</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.cancelBtn}
                onPress={() => {
                  setShowNewTextForm(false);
                  setNewTextContent('');
                }}>
                <Text style={s.cancelBtnText}>取消</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {activeItems.map(renderItem)}

        {activeItems.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyText}>
              {tab === 'markdown' ? '暂无 Markdown 语料' : '暂无文本语料'}
            </Text>
            {tab === 'markdown' && (
              <Text style={s.emptyHint}>点击上方按钮导入 markdown 文件</Text>
            )}
          </View>
        )}

        <View style={{height: 24}} />
      </ScrollView>
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
      paddingTop: 24,
      paddingBottom: 14,
    },
    title: {fontSize: 26, fontWeight: '700', color: c.text, letterSpacing: 2},
    addBtn: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: c.accent,
    },
    addBtnText: {fontSize: 13, color: '#ffffff', fontWeight: '600'},
    importRow: {
      backgroundColor: c.card,
      borderRadius: 10,
      padding: 14,
      marginBottom: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderStyle: 'dashed',
      alignItems: 'center',
    },
    importRowText: {fontSize: 14, color: c.accent, fontWeight: '500'},
    newTextForm: {
      backgroundColor: c.card,
      borderRadius: 10,
      padding: 14,
      marginBottom: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },

    tabRow: {
      flexDirection: 'row',
      paddingHorizontal: 20,
      marginBottom: 14,
    },
    tabBtn: {
      flex: 1,
      paddingVertical: 10,
      alignItems: 'center',
      borderBottomWidth: 2,
      borderBottomColor: c.border,
      marginHorizontal: 2,
    },
    tabBtnActive: {
      borderBottomColor: c.accent,
    },
    tabText: {fontSize: 14, color: c.textMuted, fontWeight: '500'},
    tabTextActive: {color: c.accent, fontWeight: '600'},

    scroll: {flex: 1},
    scrollContent: {paddingHorizontal: 20},

    item: {
      backgroundColor: c.card,
      borderRadius: 10,
      padding: 14,
      marginBottom: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    itemTop: {flexDirection: 'row', alignItems: 'stretch'},
    statusDot: {paddingTop: 4, paddingRight: 12},
    dot: {width: 10, height: 10, borderRadius: 5},
    dotOn: {backgroundColor: '#4caf50'},
    dotOff: {backgroundColor: c.border},
    itemBody: {flex: 1, minWidth: 0},
    itemTitle: {fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 6},
    itemPreview: {fontSize: 13, color: c.textSecondary, lineHeight: 20},
    itemTextDisabled: {opacity: 0.4},
    markdownPreview: {
      flex: 1,
      alignSelf: 'stretch',
      minWidth: 0,
    },
    markdownHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    markdownHeaderText: {
      flex: 1,
      minWidth: 0,
      paddingRight: 12,
    },
    markdownScroll: {
      alignSelf: 'stretch',
      width: '100%',
      maxHeight: 320,
      backgroundColor: c.bg,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    markdownScrollContent: {
      padding: 10,
    },
    markdownText: {
      fontSize: 13,
      color: c.textSecondary,
      lineHeight: 20,
    },
    tokenMeta: {
      fontSize: 11,
      color: c.textMuted,
      lineHeight: 16,
      marginBottom: 6,
    },

    actions: {flexDirection: 'row', marginLeft: 10, alignSelf: 'flex-start'},
    actionBtn: {
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: c.border,
      marginLeft: 6,
      alignItems: 'center',
    },
    actionText: {fontSize: 11, color: c.textSecondary},
    delAction: {color: c.danger},

    editTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: c.text,
      backgroundColor: c.bg,
      borderRadius: 6,
      padding: 10,
      marginBottom: 8,
    },
    editContent: {
      fontSize: 13,
      color: c.text,
      backgroundColor: c.bg,
      borderRadius: 8,
      padding: 12,
      minHeight: 120,
      textAlignVertical: 'top',
    },
    markdownEditContent: {
      height: 320,
      minHeight: 320,
      maxHeight: 320,
    },
    editActions: {flexDirection: 'row', marginTop: 10},
    saveBtn: {
      paddingHorizontal: 20,
      paddingVertical: 8,
      borderRadius: 6,
      backgroundColor: c.accent,
      marginRight: 8,
    },
    saveBtnText: {fontSize: 13, color: '#ffffff', fontWeight: '500'},
    cancelBtn: {
      paddingHorizontal: 20,
      paddingVertical: 8,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: c.border,
    },
    cancelBtnText: {fontSize: 13, color: c.textSecondary},

    empty: {paddingVertical: 60, alignItems: 'center'},
    emptyText: {fontSize: 15, color: c.textMuted},
    emptyHint: {fontSize: 12, color: c.textMuted, marginTop: 8},
  });
}
