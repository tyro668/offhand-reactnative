import React, {useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
} from 'react-native';
import {useI18n} from '../i18n/I18nContext';
import {useTheme, type ThemeColors} from '../theme/ThemeContext';

interface Props {
  onMenuPress: () => void;
}

interface Word {
  id: string;
  text: string;
  type: 'word' | 'sentence';
}

export default function MemoryScreen({onMenuPress}: Props) {
  const {t} = useI18n();
  const {colors} = useTheme();
  const s = makeStyles(colors);

  const [words, setWords] = useState<Word[]>([
    {id: '1', text: '离线', type: 'word'},
    {id: '2', text: 'ASR', type: 'word'},
    {id: '3', text: '语音识别是一种将人类语音转换为文字的技术', type: 'sentence'},
  ]);
  const [inputText, setInputText] = useState('');
  const [inputType, setInputType] = useState<'word' | 'sentence'>('word');
  const [showInput, setShowInput] = useState(false);

  const addWord = () => {
    if (!inputText.trim()) {
      return;
    }
    setWords(prev => [
      ...prev,
      {id: Date.now().toString(), text: inputText.trim(), type: inputType},
    ]);
    setInputText('');
    setShowInput(false);
  };

  const deleteWord = (id: string) => {
    setWords(prev => prev.filter(w => w.id !== id));
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={onMenuPress} style={s.menuBtn}>
          <Text style={s.menuIcon}>☰</Text>
        </TouchableOpacity>
        <Text style={s.title}>记忆库</Text>
        <TouchableOpacity
          onPress={() => setShowInput(!showInput)}
          style={s.addBtn}>
          <Text style={s.addBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Add input */}
        {showInput && (
          <View style={s.inputCard}>
            <View style={s.typeRow}>
              <TouchableOpacity
                style={[s.typeBtn, inputType === 'word' && s.typeBtnActive]}
                onPress={() => setInputType('word')}>
                <Text
                  style={[
                    s.typeBtnText,
                    inputType === 'word' && s.typeBtnTextActive,
                  ]}>
                  词语
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  s.typeBtn,
                  inputType === 'sentence' && s.typeBtnActive,
                ]}
                onPress={() => setInputType('sentence')}>
                <Text
                  style={[
                    s.typeBtnText,
                    inputType === 'sentence' && s.typeBtnTextActive,
                  ]}>
                  语句
                </Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={[s.textInput, {minHeight: inputType === 'sentence' ? 80 : 44}]}
              value={inputText}
              onChangeText={setInputText}
              placeholder={inputType === 'word' ? '输入词语...' : '输入语句...'}
              placeholderTextColor={colors.textMuted}
              multiline={inputType === 'sentence'}
              autoFocus
            />
            <TouchableOpacity style={s.submitBtn} onPress={addWord}>
              <Text style={s.submitBtnText}>添加</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Word list */}
        <Text style={s.sectionTitle}>
          词语 ({words.filter(w => w.type === 'word').length})
        </Text>
        {words.filter(w => w.type === 'word').length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyText}>暂无词语</Text>
          </View>
        ) : (
          words
            .filter(w => w.type === 'word')
            .map(w => (
              <View key={w.id} style={s.wordItem}>
                <Text style={s.wordText}>{w.text}</Text>
                <TouchableOpacity onPress={() => deleteWord(w.id)}>
                  <Text style={s.deleteBtn}>×</Text>
                </TouchableOpacity>
              </View>
            ))
        )}

        {/* Sentence list */}
        <Text style={[s.sectionTitle, {marginTop: 24}]}>
          语句 ({words.filter(w => w.type === 'sentence').length})
        </Text>
        {words.filter(w => w.type === 'sentence').length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyText}>暂无语句</Text>
          </View>
        ) : (
          words
            .filter(w => w.type === 'sentence')
            .map(w => (
              <View key={w.id} style={s.sentenceItem}>
                <Text style={s.sentenceText}>{w.text}</Text>
                <TouchableOpacity onPress={() => deleteWord(w.id)}>
                  <Text style={s.deleteBtn}>×</Text>
                </TouchableOpacity>
              </View>
            ))
        )}
      </ScrollView>
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
    menuBtn: {
      minWidth: 44,
      paddingVertical: 4,
    },
    menuIcon: {
      fontSize: 20,
      color: c.textSecondary,
    },
    title: {
      fontSize: 17,
      fontWeight: '600',
      color: c.text,
    },
    addBtn: {
      minWidth: 44,
      alignItems: 'flex-end',
    },
    addBtnText: {
      fontSize: 24,
      color: c.accent,
      fontWeight: '300',
    },
    scroll: {
      flex: 1,
      paddingHorizontal: 16,
      paddingTop: 12,
    },
    inputCard: {
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    typeRow: {
      flexDirection: 'row',
      marginBottom: 12,
    },
    typeBtn: {
      paddingHorizontal: 20,
      paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: c.bgSecondary,
      marginRight: 8,
    },
    typeBtnActive: {
      backgroundColor: c.accent,
    },
    typeBtnText: {
      fontSize: 13,
      color: c.textSecondary,
    },
    typeBtnTextActive: {
      color: '#ffffff',
    },
    textInput: {
      fontSize: 15,
      color: c.text,
      backgroundColor: c.bg,
      borderRadius: 8,
      padding: 12,
      minHeight: 44,
      textAlignVertical: 'top',
    },
    submitBtn: {
      marginTop: 12,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: c.accent,
      alignItems: 'center',
    },
    submitBtnText: {
      fontSize: 14,
      color: '#ffffff',
      fontWeight: '500',
    },
    sectionTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: c.textMuted,
      marginBottom: 8,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    wordItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: c.card,
      paddingHorizontal: 16,
      paddingVertical: 13,
      borderRadius: 8,
      marginBottom: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    wordText: {
      fontSize: 15,
      color: c.text,
    },
    sentenceItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      backgroundColor: c.card,
      paddingHorizontal: 16,
      paddingVertical: 13,
      borderRadius: 8,
      marginBottom: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    sentenceText: {
      fontSize: 14,
      color: c.text,
      lineHeight: 22,
      flex: 1,
      marginRight: 12,
    },
    deleteBtn: {
      fontSize: 18,
      color: c.textMuted,
      paddingHorizontal: 4,
    },
    emptyCard: {
      backgroundColor: c.card,
      borderRadius: 8,
      padding: 24,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    emptyText: {
      fontSize: 14,
      color: c.textMuted,
    },
  });
}
