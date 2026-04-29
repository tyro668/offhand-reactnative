import React, {useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Share,
} from 'react-native';
import {useI18n} from '../i18n/I18nContext';
import {useTheme, type ThemeColors} from '../theme/ThemeContext';
import {DEFAULT_SYSTEM_PROMPT} from '../models/defaultPrompt';
import {testTextModelConnection} from '../services/textEnhancement';
import builtinProviders from '../models/textModels.json';

interface TextModelConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  prompt: string;
}

interface ProviderModel {id: string; name: string}

interface ProviderEntry {
  provider: string;
  protocol: string;
  baseUrl: string;
  models: ProviderModel[];
}

interface Props {
  config: TextModelConfig;
  onSave: (config: TextModelConfig) => void;
  onBack: () => void;
}

type TestState = 'idle' | 'testing' | 'success' | 'error';

const PROVIDERS: ProviderEntry[] = builtinProviders as ProviderEntry[];
const CUSTOM_PROVIDER = 'custom';

function DropdownPicker({
  label,
  value,
  options,
  onSelect,
  renderOption,
  colors,
  s,
}: {
  label: string;
  value: string;
  options: string[];
  onSelect: (val: string) => void;
  renderOption?: (val: string) => string;
  colors: ThemeColors;
  s: ReturnType<typeof makeStyles>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <View style={s.dropdownWrap}>
      <TouchableOpacity style={s.dropdown} onPress={() => setOpen(!open)}>
        <Text style={s.dropdownLabel}>{label}</Text>
        <Text style={s.dropdownValue} numberOfLines={1}>
          {value ? (renderOption ? renderOption(value) : value) : '—'}
        </Text>
        <Text style={s.dropdownArrow}>{open ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {open && (
        <View style={s.dropdownMenu}>
          <ScrollView style={s.dropdownList} nestedScrollEnabled>
            {options.map(item => (
              <TouchableOpacity
                key={item}
                style={[s.dropdownItem, item === value && s.dropdownItemActive]}
                onPress={() => {
                  onSelect(item);
                  setOpen(false);
                }}>
                <Text
                  numberOfLines={1}
                  style={[s.dropdownItemText, item === value && s.dropdownItemTextActive]}>
                  {renderOption ? renderOption(item) : item}
                </Text>
                {item === value && <Text style={s.check}>✓</Text>}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

export default function ModelSettings({config, onSave, onBack}: Props) {
  const {t} = useI18n();
  const {colors} = useTheme();
  const s = makeStyles(colors);

  const [provider, setProvider] = useState(config.provider);
  const [model, setModel] = useState(config.model);
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [prompt, setPrompt] = useState(config.prompt || DEFAULT_SYSTEM_PROMPT);
  const [useCustomPrompt, setUseCustomPrompt] = useState(
    config.prompt !== DEFAULT_SYSTEM_PROMPT && config.prompt !== '',
  );
  const [testState, setTestState] = useState<TestState>('idle');
  const [testLatencyMs, setTestLatencyMs] = useState<number | null>(null);
  const [testMessage, setTestMessage] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const savedCustomPrompt = useRef(
    config.prompt && config.prompt !== DEFAULT_SYSTEM_PROMPT
      ? config.prompt
      : '',
  );
  const testResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleError = (ctx: string, e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    setErrMsg(`[${ctx}] ${msg}`);
  };

  const clearTestResultTimer = () => {
    if (testResultTimerRef.current) {
      clearTimeout(testResultTimerRef.current);
      testResultTimerRef.current = null;
    }
  };

  const resetTestResult = () => {
    clearTestResultTimer();
    setTestState('idle');
    setTestLatencyMs(null);
    setTestMessage('');
  };

  const scheduleTestResultReset = (expectedErrMsg?: string) => {
    clearTestResultTimer();
    testResultTimerRef.current = setTimeout(() => {
      testResultTimerRef.current = null;
      setTestState('idle');
      setTestLatencyMs(null);
      setTestMessage('');
      if (expectedErrMsg) {
        setErrMsg(current => (current === expectedErrMsg ? '' : current));
      }
    }, 5000);
  };

  useEffect(() => {
    return () => clearTestResultTimer();
  }, []);

  const isCustom = provider === CUSTOM_PROVIDER;
  const activeProvider = PROVIDERS.find(pr => pr.provider === provider);
  const resolvedBaseUrl = isCustom ? baseUrl : (baseUrl || activeProvider?.baseUrl || '');
  const providerOptions = [...PROVIDERS.map(p => p.provider), CUSTOM_PROVIDER];

  const modelOptions: string[] = isCustom
    ? []
    : (activeProvider?.models.map(m => m.id) ?? []);

  const handleProviderChange = (val: string) => {
    try {
      setErrMsg('');
      resetTestResult();
      setProvider(val);
      setApiKey('');  // Clear key when switching providers
      if (val === CUSTOM_PROVIDER) {
        setModel('');
        setBaseUrl('');
      } else {
        const p = PROVIDERS.find(pr => pr.provider === val);
        if (p && p.models.length > 0) {
          setModel(p.models[0].id);
          setBaseUrl(p.baseUrl);
        }
      }
    } catch (e) {
      handleError('ProviderChange', e);
    }
  };

  const providerLabel = (val: string) => {
    if (val === CUSTOM_PROVIDER) return t('textCustom');
    return PROVIDERS.find(pr => pr.provider === val)?.provider ?? val;
  };

  const modelLabel = (val: string) => {
    const p = PROVIDERS.find(pr => pr.provider === provider);
    if (!p) return val;
    return p.models.find(mm => mm.id === val)?.name ?? val;
  };

  const handleTestConnection = async () => {
    clearTestResultTimer();
    setErrMsg('');
    setTestState('testing');
    setTestLatencyMs(null);
    setTestMessage(t('testingConnection'));

    try {
      const result = await testTextModelConnection({
        provider,
        model: model.trim(),
        baseUrl: resolvedBaseUrl.trim(),
        apiKey: apiKey.trim(),
        prompt: useCustomPrompt ? prompt : DEFAULT_SYSTEM_PROMPT,
      });
      setTestState('success');
      setTestLatencyMs(result.latencyMs);
      setTestMessage(
        result.outputText
          ? `${t('testConnectionSuccess')} · ${result.outputText.slice(0, 40)}`
          : t('testConnectionSuccess'),
      );
      scheduleTestResultReset();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const errorBanner = `[${t('testConnection')}] ${msg}`;
      setTestState('error');
      setTestLatencyMs(null);
      setTestMessage(`${t('testConnectionFailed')}：${msg}`);
      setErrMsg(errorBanner);
      scheduleTestResultReset(errorBanner);
    }
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} style={s.backBtn}>
          <Text style={s.backText}>{t('backBtn')}</Text>
        </TouchableOpacity>
        <Text style={s.title}>{t('textModelTitle')}</Text>
        <TouchableOpacity
          onPress={() =>
            onSave({
              provider,
              model,
              baseUrl: resolvedBaseUrl,
              apiKey,
              prompt: useCustomPrompt ? prompt : DEFAULT_SYSTEM_PROMPT,
            })
          }>
          <Text style={s.saveText}>{t('save')}</Text>
        </TouchableOpacity>
      </View>

      {errMsg !== '' && (
        <View style={s.errorBanner}>
          <Text style={s.errorText} selectable>{errMsg}</Text>
          <View style={s.errorBtns}>
            <TouchableOpacity
              onPress={() => Share.share({message: errMsg})}
              style={s.errorCopyBtn}>
              <Text style={s.errorCopyText}>Copy</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setErrMsg('')} style={s.errorCloseBtn}>
              <Text style={s.errorCloseText}>×</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <ScrollView style={s.body} showsVerticalScrollIndicator={true}>
        <DropdownPicker
          label={t('textProvider')}
          value={provider}
          options={providerOptions}
          onSelect={handleProviderChange}
          renderOption={providerLabel}
          colors={colors}
          s={s}
        />

        {!isCustom && (
          <DropdownPicker
            label={t('textModel')}
            value={model}
            options={modelOptions}
            onSelect={val => {
              resetTestResult();
              setModel(val);
            }}
            renderOption={modelLabel}
            colors={colors}
            s={s}
          />
        )}

        {isCustom && (
          <>
            <View style={s.inputGroup}>
              <Text style={s.inputLabel}>{t('textBaseUrl')}</Text>
              <TextInput
                style={s.textInput}
                value={baseUrl}
                onChangeText={text => {
                  resetTestResult();
                  setBaseUrl(text);
                }}
                placeholder={t('textBaseUrlPlaceholder')}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={s.inputGroup}>
              <Text style={s.inputLabel}>{t('modelId')}</Text>
              <TextInput
                style={s.textInput}
                value={model}
                onChangeText={text => {
                  resetTestResult();
                  setModel(text);
                }}
                placeholder="gpt-4o"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </>
        )}

        <View style={s.inputGroup}>
          <Text style={s.inputLabel}>
            {t('textApiKey')}
            {!isCustom && <Text style={s.optional}>  ({t('noShortcut')})</Text>}
          </Text>
          <TextInput
            style={s.textInput}
            value={apiKey}
            onChangeText={text => {
              resetTestResult();
              setApiKey(text);
            }}
            placeholder={t('textApiKeyPlaceholder')}
            placeholderTextColor={colors.textMuted}
            secureTextEntry={apiKey.length > 0}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={s.testPanel}>
          <View style={s.testHeader}>
            <View style={s.testCopy}>
              <Text style={s.testTitle}>{t('testConnection')}</Text>
              <Text style={s.testHint}>{t('testConnectionHint')}</Text>
            </View>
            <TouchableOpacity
              style={[
                s.testButton,
                testState === 'testing' && s.testButtonDisabled,
              ]}
              disabled={testState === 'testing'}
              onPress={handleTestConnection}>
              <Text style={s.testButtonText}>
                {testState === 'testing' ? t('testingConnection') : t('testConnection')}
              </Text>
            </TouchableOpacity>
          </View>

          {testState !== 'idle' && (
            <View
              style={[
                s.testResult,
                testState === 'success' && s.testResultSuccess,
                testState === 'error' && s.testResultError,
              ]}>
              <Text
                style={[
                  s.testResultText,
                  testState === 'success' && s.testResultTextSuccess,
                  testState === 'error' && s.testResultTextError,
                ]}>
                {testMessage}
              </Text>
              {testLatencyMs !== null && (
                <Text style={s.testLatency}>
                  {t('testConnectionLatency')}: {testLatencyMs} ms
                </Text>
              )}
            </View>
          )}
        </View>

        {/* Prompt */}
        <Text style={s.sectionLabel}>提示词</Text>
        <View style={s.promptToggleRow}>
          <TouchableOpacity
            style={[s.promptToggle, !useCustomPrompt && s.promptToggleActive]}
            onPress={() => {
              if (useCustomPrompt && prompt !== DEFAULT_SYSTEM_PROMPT) {
                savedCustomPrompt.current = prompt;
              }
              setUseCustomPrompt(false);
              setPrompt(DEFAULT_SYSTEM_PROMPT);
              resetTestResult();
            }}>
            <Text style={[s.promptToggleText, !useCustomPrompt && s.promptToggleTextActive]}>
              系统默认
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.promptToggle, useCustomPrompt && s.promptToggleActive]}
            onPress={() => {
              setUseCustomPrompt(true);
              setPrompt(savedCustomPrompt.current || DEFAULT_SYSTEM_PROMPT);
              resetTestResult();
            }}>
            <Text style={[s.promptToggleText, useCustomPrompt && s.promptToggleTextActive]}>
              自定义
            </Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={[s.textInput, s.promptInput]}
          value={prompt}
          onChangeText={text => {
            resetTestResult();
            setPrompt(text);
          }}
          multiline
          textAlignVertical="top"
          editable={useCustomPrompt}
          placeholder={useCustomPrompt ? '输入自定义提示词...' : ''}
          placeholderTextColor={colors.textMuted}
        />

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
    body: {flex: 1, paddingHorizontal: 20, paddingTop: 20},

    dropdownWrap: {marginBottom: 10, zIndex: 10},
    dropdown: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.card,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    dropdownLabel: {fontSize: 12, color: c.textMuted, marginRight: 10, minWidth: 60},
    dropdownValue: {flex: 1, fontSize: 14, color: c.text},
    dropdownArrow: {fontSize: 10, color: c.textMuted, marginLeft: 8},
    dropdownMenu: {
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: 10,
      marginTop: 4,
      maxHeight: 240,
      overflow: 'hidden',
    },
    dropdownList: {maxHeight: 240},
    dropdownItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    dropdownItemActive: {backgroundColor: c.accentLight},
    dropdownItemText: {fontSize: 14, color: c.textSecondary, flex: 1},
    dropdownItemTextActive: {color: c.accent, fontWeight: '500'},
    check: {fontSize: 16, color: c.accent, marginLeft: 12},

    inputGroup: {marginBottom: 12},
    inputLabel: {fontSize: 12, color: c.textMuted, marginBottom: 6},
    optional: {fontSize: 11, color: c.textMuted, fontStyle: 'italic'},
    textInput: {
      fontSize: 14,
      color: c.text,
      backgroundColor: c.card,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },

    sectionLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: c.textSecondary,
      marginTop: 20,
      marginBottom: 8,
    },
    promptToggleRow: {
      flexDirection: 'row',
      marginBottom: 10,
    },
    promptToggle: {
      paddingHorizontal: 20,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      marginRight: 8,
    },
    promptToggleActive: {borderColor: c.accent, backgroundColor: c.accentLight},
    promptToggleText: {fontSize: 13, color: c.textSecondary},
    promptToggleTextActive: {color: c.accent, fontWeight: '500'},
    promptInput: {
      height: 300,
      textAlignVertical: 'top',
    },

    testPanel: {
      backgroundColor: c.card,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: 14,
      marginBottom: 12,
    },
    testHeader: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    testCopy: {flex: 1, paddingRight: 12},
    testTitle: {fontSize: 13, fontWeight: '600', color: c.text},
    testHint: {fontSize: 12, color: c.textMuted, marginTop: 4, lineHeight: 17},
    testButton: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 8,
      backgroundColor: c.accent,
      minWidth: 92,
      alignItems: 'center',
    },
    testButtonDisabled: {opacity: 0.65},
    testButtonText: {fontSize: 13, color: '#fff', fontWeight: '600'},
    testResult: {
      marginTop: 12,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: c.bg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    testResultSuccess: {
      backgroundColor: '#e8f5e9',
      borderColor: '#81c784',
    },
    testResultError: {
      backgroundColor: '#ffebee',
      borderColor: '#ef9a9a',
    },
    testResultText: {fontSize: 12, color: c.textSecondary, lineHeight: 17},
    testResultTextSuccess: {color: '#2e7d32', fontWeight: '600'},
    testResultTextError: {color: '#c62828', fontWeight: '600'},
    testLatency: {
      fontSize: 12,
      color: c.textSecondary,
      marginTop: 4,
      fontWeight: '500',
    },

    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#fce4ec',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: '#ef9a9a',
    },
    errorText: {flex: 1, fontSize: 12, color: '#c62828', lineHeight: 18},
    errorBtns: {flexDirection: 'row', alignItems: 'center', marginLeft: 8},
    errorCopyBtn: {
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 4,
      backgroundColor: '#d32f2f',
      marginRight: 6,
    },
    errorCopyText: {fontSize: 12, color: '#fff', fontWeight: '600'},
    errorCloseBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: '#ffcdd2',
      alignItems: 'center',
      justifyContent: 'center',
    },
    errorCloseText: {fontSize: 16, color: '#c62828'},
  });
}
