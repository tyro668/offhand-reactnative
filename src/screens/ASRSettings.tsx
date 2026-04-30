import React, {useState, useCallback, useRef, useEffect} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  NativeEventEmitter,
  NativeModules,
} from 'react-native';
import TouchableOpacity from '../components/TouchableOpacityCompat';
import {useI18n} from '../i18n/I18nContext';
import {useTheme, type ThemeColors} from '../theme/ThemeContext';
import {
  getModelFiles,
  getSherpaRuntimeFiles,
  getSherpaRuntimeDownloadKey,
  isSherpaRuntimeDownloadKey,
  modelKeyFromSherpaRuntimeDownloadKey,
} from '../services/modelDownloader';

interface ASRConfig {
  engine: string;
  model: string;
  language: string;
  sampleRate: string;
}

interface Props {
  config: ASRConfig;
  onSave: (config: ASRConfig) => void;
  onBack: () => void;
}

const LANGUAGES = ['asrLanguageAuto', 'asrLanguageZh', 'asrLanguageEn'];
const SAMPLE_RATES = [
  {key: '16k', labelKey: 'sampleRate16k'},
  {key: '48k', labelKey: 'sampleRate48k'},
];

const SENSEVOICE_MODELS = [
  {key: 'senseVoiceSmall', size: '~240MB'},
  {key: 'senseVoiceLarge', size: '~940MB'},
];

const WHISPER_MODELS = [
  {key: 'whisperTiny', size: '~75MB'},
  {key: 'whisperBase', size: '~145MB'},
  {key: 'whisperSmall', size: '~460MB'},
  {key: 'whisperMedium', size: '~1.5GB'},
  {key: 'whisperLarge', size: '~2.9GB'},
];

type DownloadState = Record<string, {progress: number; status: 'none' | 'downloading' | 'done' | 'failed'}>;

export default function ASRSettings({config, onSave, onBack}: Props) {
  const {t} = useI18n();
  const {colors} = useTheme();
  const s = makeStyles(colors);

  const [engine, setEngine] = useState(config.engine);
  const [model, setModel] = useState(config.model);
  const [language, setLanguage] = useState(config.language);
  const [sampleRate, setSampleRate] = useState(config.sampleRate);
  const [downloads, setDownloads] = useState<DownloadState>({});
  const pendingModelAfterRuntime = useRef<Record<string, boolean>>({});

  const currentModels = engine === 'sensevoice' ? SENSEVOICE_MODELS : WHISPER_MODELS;

  // Check which models are already downloaded on mount
  useEffect(() => {
    let cancelled = false;
    const checkModels = async () => {
      const {SherpaTranscriber} = NativeModules;
      if (!SherpaTranscriber?.isModelReady) {
        return;
      }
      try {
        const runtimeReady = await SherpaTranscriber.isRuntimeReady();
        if (!runtimeReady) {
          return;
        }
        const allModels = [
          ...SENSEVOICE_MODELS.map(m => ({engine: 'sensevoice', key: m.key})),
          ...WHISPER_MODELS.map(m => ({engine: 'whisper', key: m.key})),
        ];
        const results: Record<string, boolean> = {};
        for (const m of allModels) {
          try {
            results[m.key] = await SherpaTranscriber.isModelReady(m.engine, m.key);
          } catch {
            results[m.key] = false;
          }
        }
        if (cancelled) return;
        setDownloads(prev => {
          const next = {...prev};
          for (const m of allModels) {
            if (results[m.key] && (!next[m.key] || next[m.key].status === 'none')) {
              next[m.key] = {progress: 100, status: 'done'};
            }
          }
          return next;
        });
      } catch (e) {
        console.log('[ASR] checkModelReady failed:', e);
      }
    };
    checkModels();
    return () => { cancelled = true; };
  }, []);

  const startModelFileDownload = useCallback((modelKey: string) => {
    const files = getModelFiles(modelKey);
    console.log('[ASR] startModelFileDownload:', modelKey, 'files:', files.length);
    if (files.length === 0) {
      console.log('[ASR] No files defined for model:', modelKey);
      return;
    }

    setDownloads(prev => ({
      ...prev,
      [modelKey]: {progress: 0, status: 'downloading'},
    }));

    const {ModelDownloader} = NativeModules;
    console.log('[ASR] ModelDownloader available:', !!ModelDownloader);
    if (ModelDownloader) {
      ModelDownloader.downloadModelFiles(modelKey, files);
      console.log('[ASR] downloadModelFiles called');
    }
  }, []);

  // Listen for real download progress
  useEffect(() => {
    const {ModelDownloader} = NativeModules;
    if (!ModelDownloader) return;
    const emitter = new NativeEventEmitter(ModelDownloader);

    const sub1 = emitter.addListener('onDownloadProgress', (event: {modelKey: string; progress: number; fileName?: string}) => {
      const displayModelKey = modelKeyFromSherpaRuntimeDownloadKey(event.modelKey);
      console.log('[ASR] Download progress:', event.modelKey, event.fileName, Math.floor(event.progress * 100) + '%');
      setDownloads(prev => ({
        ...prev,
        [displayModelKey]: {progress: Math.floor(event.progress * 100), status: 'downloading'},
      }));
    });

    const sub2 = emitter.addListener('onDownloadComplete', (event: {modelKey: string; success: boolean; error?: string}) => {
      const isRuntime = isSherpaRuntimeDownloadKey(event.modelKey);
      const displayModelKey = modelKeyFromSherpaRuntimeDownloadKey(event.modelKey);
      console.log('[ASR] Download complete:', event.modelKey, 'success:', event.success, event.error || '');
      if (isRuntime && pendingModelAfterRuntime.current[displayModelKey] && event.success) {
        delete pendingModelAfterRuntime.current[displayModelKey];
        startModelFileDownload(displayModelKey);
        return;
      }
      setDownloads(prev => ({
        ...prev,
        [displayModelKey]: {progress: event.success ? 100 : 0, status: event.success ? 'done' : 'failed'},
      }));
    });

    return () => {
      sub1.remove();
      sub2.remove();
    };
  }, [startModelFileDownload]);

  const startDownload = useCallback(async (modelKey: string) => {
    const {ModelDownloader, SherpaTranscriber} = NativeModules;
    const runtimeFiles = getSherpaRuntimeFiles();
    let runtimeReady = false;
    try {
      runtimeReady = runtimeFiles.length === 0 || !!(await SherpaTranscriber?.isRuntimeReady?.());
    } catch (e) {
      console.log('[ASR] isRuntimeReady failed:', e);
    }

    if (runtimeReady) {
      startModelFileDownload(modelKey);
      return;
    }

    if (!ModelDownloader || runtimeFiles.length === 0) {
      console.log('[ASR] No Sherpa runtime downloader/files available for model:', modelKey);
      setDownloads(prev => ({
        ...prev,
        [modelKey]: {progress: 0, status: 'failed'},
      }));
      return;
    }

    pendingModelAfterRuntime.current[modelKey] = true;
    setDownloads(prev => ({
      ...prev,
      [modelKey]: {progress: 0, status: 'downloading'},
    }));
    const runtimeKey = getSherpaRuntimeDownloadKey(modelKey);
    console.log('[ASR] startRuntimeDownload:', runtimeKey, 'files:', runtimeFiles.length);
    ModelDownloader.downloadModelFiles(runtimeKey, runtimeFiles);
  }, [startModelFileDownload]);

  const getDownloadBtn = (modelKey: string) => {
    const ds = downloads[modelKey];
    if (!ds || ds.status === 'none') {
      return (
        <TouchableOpacity
          style={s.dlBtn}
          onPress={() => startDownload(modelKey)}>
          <Text style={s.dlBtnText}>{t('downloadModel')}</Text>
        </TouchableOpacity>
      );
    }
    if (ds.status === 'downloading') {
      return (
        <View style={s.dlProgress}>
          <View style={s.progressBar}>
            <View style={[s.progressFill, {width: `${ds.progress}%`}]} />
          </View>
          <Text style={s.dlProgressText}>{ds.progress}%</Text>
        </View>
      );
    }
    if (ds.status === 'done') {
      return (
        <View style={s.dlDone}>
          <Text style={s.dlDoneText}>{t('downloadComplete')}</Text>
        </View>
      );
    }
    return (
      <TouchableOpacity
        style={s.dlBtn}
        onPress={() => startDownload(modelKey)}>
        <Text style={s.dlBtnText}>{t('downloadFailed')}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} style={s.backBtn}>
          <Text style={s.backText}>{t('backBtn')}</Text>
        </TouchableOpacity>
        <Text style={s.title}>{t('speechModel')}</Text>
        <TouchableOpacity
          onPress={() => onSave({engine, model, language, sampleRate})}>
          <Text style={s.saveText}>{t('save')}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={s.body} showsVerticalScrollIndicator={false}>
        <Text style={s.desc}>{t('speechModelDesc')}</Text>

        {/* Engine selector */}
        <Text style={s.sectionLabel}>{t('asrEngine')}</Text>
        <Text style={s.sectionHint}>{t('asrEngineDesc')}</Text>
        <View style={s.engineRow}>
          <TouchableOpacity
            style={[s.engineBtn, engine === 'sensevoice' && s.engineBtnActive]}
            onPress={() => {
              setEngine('sensevoice');
              setModel('senseVoiceSmall');
            }}>
            <Text style={[s.engineText, engine === 'sensevoice' && s.engineTextActive]}>
              {t('engineSenseVoice')}
            </Text>
            <Text style={[s.engineSub, engine === 'sensevoice' && s.engineTextActive]}>
              中文优化 · 多情感
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.engineBtn, engine === 'whisper' && s.engineBtnActive]}
            onPress={() => {
              setEngine('whisper');
              setModel('whisperSmall');
            }}>
            <Text style={[s.engineText, engine === 'whisper' && s.engineTextActive]}>
              {t('engineWhisper')}
            </Text>
            <Text style={[s.engineSub, engine === 'whisper' && s.engineTextActive]}>
              多语言 · 通用
            </Text>
          </TouchableOpacity>
        </View>

        {/* Model list */}
        <Text style={s.sectionLabel}>
          {engine === 'sensevoice' ? 'SenseVoice' : 'Whisper'} {t('asrModel')}
        </Text>
        {currentModels.map(m => (
          <View key={m.key} style={model === m.key ? s.modelCardActive : s.modelCard}>
            <TouchableOpacity
              style={s.modelInfo}
              onPress={() => setModel(m.key)}>
              <View style={s.modelLeft}>
                <Text style={[s.modelName, model === m.key && s.modelNameActive]}>
                  {t(m.key)}
                </Text>
                <Text style={s.modelSize}>
                  {t('modelSize')}: {m.size}
                </Text>
              </View>
              {model === m.key && <Text style={s.check}>✓</Text>}
            </TouchableOpacity>
            <View style={s.modelActions}>
              {getDownloadBtn(m.key)}
            </View>
          </View>
        ))}

        {/* Language */}
        <Text style={s.sectionLabel}>{t('asrLanguage')}</Text>
        <Text style={s.sectionHint}>{t('asrLanguageDesc')}</Text>
        <View style={s.chipRow}>
          {LANGUAGES.map(lang => (
            <TouchableOpacity
              key={lang}
              style={[s.chip, language === lang && s.chipSelected]}
              onPress={() => setLanguage(lang)}>
              <Text style={[s.chipText, language === lang && s.chipTextSelected]}>
                {t(lang)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Sample rate */}
        <Text style={s.sectionLabel}>{t('asrSampleRate')}</Text>
        <Text style={s.sectionHint}>{t('asrSampleRateDesc')}</Text>
        <View style={s.chipRow}>
          {SAMPLE_RATES.map(sr => (
            <TouchableOpacity
              key={sr.key}
              style={[s.chip, sampleRate === sr.key && s.chipSelected]}
              onPress={() => setSampleRate(sr.key)}>
              <Text style={[s.chipText, sampleRate === sr.key && s.chipTextSelected]}>
                {t(sr.labelKey)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{height: 40}} />
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
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 14,
      backgroundColor: c.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    backBtn: {minWidth: 60},
    backText: {fontSize: 15, color: c.accent},
    title: {fontSize: 17, fontWeight: '600', color: c.text},
    saveText: {fontSize: 15, color: c.accent, fontWeight: '500'},
    body: {flex: 1, paddingHorizontal: 20, paddingTop: 16},
    desc: {fontSize: 13, color: c.textMuted, marginBottom: 20},
    sectionLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: c.textSecondary,
      marginBottom: 4,
    },
    sectionHint: {fontSize: 12, color: c.textMuted, marginBottom: 10},

    // Engine selector
    engineRow: {flexDirection: 'row', marginBottom: 20},
    engineBtn: {
      flex: 1,
      padding: 14,
      borderRadius: 10,
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      marginRight: 8,
      alignItems: 'center',
    },
    engineBtnActive: {borderColor: c.accent, backgroundColor: c.accentLight},
    engineText: {fontSize: 14, fontWeight: '600', color: c.textSecondary},
    engineTextActive: {color: c.accent},
    engineSub: {fontSize: 11, color: c.textMuted, marginTop: 4},
    engineSubActive: {color: c.accent, opacity: 0.7},

    // Model cards
    modelCard: {
      backgroundColor: c.card,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      marginBottom: 8,
      overflow: 'hidden',
    },
    modelCardActive: {
      backgroundColor: c.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.accent,
      marginBottom: 8,
      overflow: 'hidden',
    },
    modelInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    modelLeft: {flex: 1},
    modelName: {fontSize: 14, fontWeight: '500', color: c.text},
    modelNameActive: {color: c.accent},
    modelSize: {fontSize: 11, color: c.textMuted, marginTop: 2},
    check: {fontSize: 16, color: c.accent, marginLeft: 12},
    modelActions: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },

    // Download
    dlBtn: {
      alignSelf: 'flex-start',
      paddingHorizontal: 16,
      paddingVertical: 7,
      borderRadius: 14,
      backgroundColor: c.accent,
    },
    dlBtnText: {fontSize: 12, color: '#ffffff', fontWeight: '500'},
    dlProgress: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    progressBar: {
      flex: 1,
      height: 6,
      borderRadius: 3,
      backgroundColor: c.bgSecondary,
      marginRight: 10,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: 3,
      backgroundColor: c.accent,
    },
    dlProgressText: {fontSize: 12, color: c.accent, fontWeight: '500', minWidth: 36},
    dlDone: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    dlDoneText: {fontSize: 12, color: '#4caf50', fontWeight: '500'},

    // Chips
    chipRow: {flexDirection: 'row', flexWrap: 'wrap', marginBottom: 20},
    chip: {
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 20,
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      marginRight: 8,
      marginBottom: 6,
    },
    chipSelected: {borderColor: c.accent, backgroundColor: c.accentLight},
    chipText: {fontSize: 13, color: c.textSecondary},
    chipTextSelected: {color: c.accent, fontWeight: '500'},
  });
}
