import React, {useState} from 'react';
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
import builtinProviders from '../models/textModels.json';

interface TextModelConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  style: string;
  maxTokens: string;
}

interface ProviderModel {
  id: string;
  name: string;
}

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

const PROVIDERS: ProviderEntry[] = builtinProviders as ProviderEntry[];
const CUSTOM_PROVIDER = 'custom';

const STYLES = ['styleFormal', 'styleCasual', 'styleCreative'];
const TOKENS = [
  {key: '256', labelKey: 'maxTokens256'},
  {key: '512', labelKey: 'maxTokens512'},
  {key: '1024', labelKey: 'maxTokens1024'},
  {key: '2048', labelKey: 'maxTokens2048'},
];

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
                  style={[
                    s.dropdownItemText,
                    item === value && s.dropdownItemTextActive,
                  ]}>
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
  const [style, setStyle] = useState(config.style);
  const [maxTokens, setMaxTokens] = useState(config.maxTokens);
  const [errMsg, setErrMsg] = useState('');

  const handleError = (ctx: string, e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    setErrMsg(`[${ctx}] ${msg}`);
  };

  const isCustom = provider === CUSTOM_PROVIDER;
  const activeProvider = PROVIDERS.find(p => p.provider === provider);
  const providerOptions = [...PROVIDERS.map(p => p.provider), CUSTOM_PROVIDER];

  const modelOptions: string[] = isCustom
    ? []
    : activeProvider?.models.map(m => m.id) ?? [];

  const handleProviderChange = (val: string) => {
    try {
      setErrMsg('');
      setProvider(val);
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
    if (val === CUSTOM_PROVIDER) {
      return t('textCustom');
    }
    const p = PROVIDERS.find(pr => pr.provider === val);
    return p ? p.provider : val;
  };

  const modelLabel = (val: string) => {
    const p = PROVIDERS.find(pr => pr.provider === provider);
    if (!p) {
      return val;
    }
    const m = p.models.find(mm => mm.id === val);
    return m ? m.name : val;
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
            onSave({provider, model, baseUrl, apiKey, style, maxTokens})
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
            <TouchableOpacity
              onPress={() => setErrMsg('')}
              style={s.errorCloseBtn}>
              <Text style={s.errorCloseText}>×</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <ScrollView style={s.body} showsVerticalScrollIndicator={false}>
        {/* Provider dropdown */}
        <DropdownPicker
          label={t('textProvider')}
          value={provider}
          options={providerOptions}
          onSelect={handleProviderChange}
          renderOption={providerLabel}
          colors={colors}
          s={s}
        />

        {/* Model dropdown — hidden when custom */}
        {!isCustom && (
          <DropdownPicker
            label={t('textModel')}
            value={model}
            options={modelOptions}
            onSelect={setModel}
            renderOption={modelLabel}
            colors={colors}
            s={s}
          />
        )}

        {/* Custom: baseUrl */}
        {isCustom && (
          <View style={s.inputGroup}>
            <Text style={s.inputLabel}>{t('textBaseUrl')}</Text>
            <TextInput
              style={s.textInput}
              value={baseUrl}
              onChangeText={setBaseUrl}
              placeholder={t('textBaseUrlPlaceholder')}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        )}

        {/* Custom: model id */}
        {isCustom && (
          <View style={s.inputGroup}>
            <Text style={s.inputLabel}>{t('modelId')}</Text>
            <TextInput
              style={s.textInput}
              value={model}
              onChangeText={setModel}
              placeholder="gpt-4o"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        )}

        {/* API key (always shown for custom, optional for built-in) */}
        <View style={s.inputGroup}>
          <Text style={s.inputLabel}>
            {t('textApiKey')}
            {!isCustom && (
              <Text style={s.optional}>  ({t('noShortcut')})</Text>
            )}
          </Text>
          <TextInput
            style={s.textInput}
            value={apiKey}
            onChangeText={setApiKey}
            placeholder={t('textApiKeyPlaceholder')}
            placeholderTextColor={colors.textMuted}
            secureTextEntry={apiKey.length > 0}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* Style */}
        <Text style={s.sectionLabel}>{t('textStyle')}</Text>
        <View style={s.chipRow}>
          {STYLES.map(st => (
            <TouchableOpacity
              key={st}
              style={[s.chip, style === st && s.chipSelected]}
              onPress={() => setStyle(st)}>
              <Text style={[s.chipText, style === st && s.chipTextSelected]}>
                {t(st)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Max tokens */}
        <Text style={s.sectionLabel}>{t('textMaxTokens')}</Text>
        <View style={s.chipRow}>
          {TOKENS.map(tk => (
            <TouchableOpacity
              key={tk.key}
              style={[s.chip, maxTokens === tk.key && s.chipSelected]}
              onPress={() => setMaxTokens(tk.key)}>
              <Text style={[s.chipText, maxTokens === tk.key && s.chipTextSelected]}>
                {t(tk.labelKey)}
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
    body: {flex: 1, paddingHorizontal: 20, paddingTop: 20},

    // Dropdown
    dropdownWrap: {
      marginBottom: 10,
      zIndex: 10,
    },
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
    dropdownLabel: {
      fontSize: 12,
      color: c.textMuted,
      marginRight: 10,
      minWidth: 60,
    },
    dropdownValue: {
      flex: 1,
      fontSize: 14,
      color: c.text,
    },
    dropdownArrow: {
      fontSize: 10,
      color: c.textMuted,
      marginLeft: 8,
    },
    dropdownMenu: {
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: 10,
      marginTop: 4,
      maxHeight: 240,
      overflow: 'hidden',
      elevation: 4,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.1,
      shadowRadius: 8,
    },
    dropdownList: {
      maxHeight: 240,
    },
    dropdownItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    dropdownItemActive: {
      backgroundColor: c.accentLight,
    },
    dropdownItemText: {
      fontSize: 14,
      color: c.textSecondary,
      flex: 1,
    },
    dropdownItemTextActive: {
      color: c.accent,
      fontWeight: '500',
    },
    check: {fontSize: 16, color: c.accent, marginLeft: 12},

    // Input groups
    inputGroup: {
      marginBottom: 12,
    },
    inputLabel: {
      fontSize: 12,
      color: c.textMuted,
      marginBottom: 6,
    },
    optional: {
      fontSize: 11,
      color: c.textMuted,
      fontStyle: 'italic',
    },
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

    // Section
    sectionLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: c.textSecondary,
      marginTop: 24,
      marginBottom: 8,
    },
    chipRow: {flexDirection: 'row', flexWrap: 'wrap'},
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

    // Error banner
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#fce4ec',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: '#ef9a9a',
    },
    errorText: {
      flex: 1,
      fontSize: 12,
      color: '#c62828',
      lineHeight: 18,
    },
    errorBtns: {
      flexDirection: 'row',
      alignItems: 'center',
      marginLeft: 8,
    },
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
