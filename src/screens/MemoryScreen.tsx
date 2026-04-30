import React, {useState, useCallback, useEffect} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  NativeModules,
} from 'react-native';
import {useTheme, type ThemeColors} from '../theme/ThemeContext';
import {
  loadMemoryCorpus,
  addMemoryCorpus,
  updateMemoryCorpus,
  deleteMemoryCorpus,
  type MemoryCorpusRow,
} from '../db/database';

const {FilePicker} = NativeModules;

export default function MemoryScreen() {
  const {colors} = useTheme();
  const s = makeStyles(colors);
  const [items, setItems] = useState<MemoryCorpusRow[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

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
      const result = await FilePicker.pickMarkdownFile();
      if (!result || !result.content) return;
      await addMemoryCorpus({
        type: 'markdown',
        title: result.name || 'Untitled',
        content: result.content,
        sourcePath: result.path || null,
      });
      refresh();
    } catch (e) {
      console.warn('FilePicker error:', e);
    }
  };

  const handleToggle = async (id: number, currentEnabled: boolean) => {
    await updateMemoryCorpus(id, {enabled: !currentEnabled});
    refresh();
  };

  const handleDelete = (id: number) => {
    Alert.alert('确认删除', '确定要删除这条记录吗？', [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          deleteMemoryCorpus(id)
            .then(() => refresh())
            .catch(e => console.warn('Delete error:', e));
        },
      },
    ]);
  };

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

  const renderItem = (item: MemoryCorpusRow) => {
    const isEditing = editingId === item.id;
    const preview = item.type === 'markdown'
      ? item.content.slice(0, 200)
      : item.content;
    const enabled = item.enabled === 1;

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
                  style={s.editContent}
                  value={editContent}
                  onChangeText={setEditContent}
                  multiline
                  textAlignVertical="top"
                  placeholderTextColor={colors.textMuted}
                />
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
            ) : (
              <>
                {item.type === 'markdown' && (
                  <Text style={[s.itemTitle, !enabled && s.itemTextDisabled]}>
                    {item.title}
                  </Text>
                )}
                <Text style={[s.itemPreview, !enabled && s.itemTextDisabled]} numberOfLines={3}>
                  {preview}
                </Text>
                {item.type === 'markdown' && item.content.length > 200 && (
                  <Text style={s.moreHint}>... 点击编辑查看全文</Text>
                )}
              </>
            )}
          </View>

          {!isEditing && (
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
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>记忆库</Text>
        <TouchableOpacity style={s.addBtn} onPress={handlePickMarkdown}>
          <Text style={s.addBtnText}>+ MD</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={s.scroll}
        showsVerticalScrollIndicator={true}
        contentContainerStyle={s.scrollContent}>
        {markdownItems.length > 0 && (
          <Text style={s.sectionTitle}>Markdown 文件</Text>
        )}
        {markdownItems.map(renderItem)}

        {textItems.length > 0 && (
          <Text style={[s.sectionTitle, markdownItems.length > 0 ? {marginTop: 24} : {}]}>
            文本语料
          </Text>
        )}
        {textItems.map(renderItem)}

        {items.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyText}>暂无语料</Text>
            <Text style={s.emptyHint}>点击右上角 + MD 导入 markdown 文件</Text>
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
    scroll: {flex: 1},
    scrollContent: {paddingHorizontal: 20},
    sectionTitle: {
      fontSize: 12,
      fontWeight: '600',
      color: c.textMuted,
      marginBottom: 8,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },

    item: {
      backgroundColor: c.card,
      borderRadius: 10,
      padding: 14,
      marginBottom: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    itemTop: {flexDirection: 'row'},
    statusDot: {paddingTop: 4, paddingRight: 12},
    dot: {width: 10, height: 10, borderRadius: 5},
    dotOn: {backgroundColor: '#4caf50'},
    dotOff: {backgroundColor: c.border},
    itemBody: {flex: 1},
    itemTitle: {fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 4},
    itemPreview: {fontSize: 13, color: c.textSecondary, lineHeight: 20},
    itemTextDisabled: {opacity: 0.4},
    moreHint: {fontSize: 11, color: c.textMuted, marginTop: 4},

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
