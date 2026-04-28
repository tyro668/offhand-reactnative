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

interface Word {
  id: string;
  text: string;
  type: 'word' | 'sentence';
}

export default function MemoryScreen() {
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
    if (!inputText.trim()) return;
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

  const wordList = words.filter(w => w.type === 'word');
  const sentenceList = words.filter(w => w.type === 'sentence');

  return (
    <View style={s.container}>
      <ScrollView
        style={s.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scrollContent}>
        <View style={s.toolbar}>
          <TouchableOpacity
            onPress={() => setShowInput(!showInput)}
            style={s.addBtn}>
            <Text style={s.addBtnText}>
              {showInput ? t('memoryCancel') : t('memoryAddBtn')}
            </Text>
          </TouchableOpacity>
        </View>

        {showInput && (
          <View style={s.inputCard}>
            <View style={s.typeRow}>
              <TouchableOpacity
                style={[s.typeBtn, inputType === 'word' && s.typeBtnActive]}
                onPress={() => setInputType('word')}>
                <Text style={[s.typeBtnText, inputType === 'word' && s.typeBtnTextActive]}>
                  {t('memoryWord')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.typeBtn, inputType === 'sentence' && s.typeBtnActive]}
                onPress={() => setInputType('sentence')}>
                <Text style={[s.typeBtnText, inputType === 'sentence' && s.typeBtnTextActive]}>
                  {t('memorySentence')}
                </Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={[s.textInput, {minHeight: inputType === 'sentence' ? 80 : 44}]}
              value={inputText}
              onChangeText={setInputText}
              placeholder={
                inputType === 'word'
                  ? t('memoryWordPlaceholder')
                  : t('memorySentencePlaceholder')
              }
              placeholderTextColor={colors.textMuted}
              multiline={inputType === 'sentence'}
              autoFocus
            />
            <TouchableOpacity style={s.submitBtn} onPress={addWord}>
              <Text style={s.submitBtnText}>{t('memoryAdd')}</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={s.sectionTitle}>
          {t('memoryWord')} ({wordList.length})
        </Text>
        {wordList.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyText}>{t('memoryEmptyWords')}</Text>
          </View>
        ) : (
          wordList.map(w => (
            <View key={w.id} style={s.wordItem}>
              <Text style={s.wordText}>{w.text}</Text>
              <TouchableOpacity onPress={() => deleteWord(w.id)}>
                <Text style={s.deleteBtn}>×</Text>
              </TouchableOpacity>
            </View>
          ))
        )}

        <Text style={[s.sectionTitle, {marginTop: 24}]}>
          {t('memorySentence')} ({sentenceList.length})
        </Text>
        {sentenceList.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyText}>{t('memoryEmptySentences')}</Text>
          </View>
        ) : (
          sentenceList.map(w => (
            <View key={w.id} style={s.sentenceItem}>
              <Text style={s.sentenceText}>{w.text}</Text>
              <TouchableOpacity onPress={() => deleteWord(w.id)}>
                <Text style={s.deleteBtn}>×</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
        <View style={{height: 40}} />
      </ScrollView>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: {flex: 1, backgroundColor: c.bg},
    scroll: {flex: 1},
    scrollContent: {paddingHorizontal: 20, paddingTop: 16},
    toolbar: {flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 12},
    addBtn: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: c.accent,
    },
    addBtnText: {fontSize: 13, color: '#ffffff', fontWeight: '500'},
    inputCard: {
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    typeRow: {flexDirection: 'row', marginBottom: 12},
    typeBtn: {
      paddingHorizontal: 20,
      paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: c.bgSecondary,
      marginRight: 8,
    },
    typeBtnActive: {backgroundColor: c.accent},
    typeBtnText: {fontSize: 13, color: c.textSecondary},
    typeBtnTextActive: {color: '#ffffff'},
    textInput: {
      fontSize: 15,
      color: c.text,
      backgroundColor: c.bg,
      borderRadius: 8,
      padding: 12,
      textAlignVertical: 'top',
    },
    submitBtn: {
      marginTop: 12,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: c.accent,
      alignItems: 'center',
    },
    submitBtnText: {fontSize: 14, color: '#ffffff', fontWeight: '500'},
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
    wordText: {fontSize: 15, color: c.text},
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
    deleteBtn: {fontSize: 18, color: c.textMuted, paddingHorizontal: 4},
    emptyCard: {
      backgroundColor: c.card,
      borderRadius: 8,
      padding: 24,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    emptyText: {fontSize: 14, color: c.textMuted},
  });
}
