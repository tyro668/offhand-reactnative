import {NativeEventEmitter, NativeModules} from 'react-native';
import {useCallback, useEffect, useRef, useState} from 'react';
import {
  addHistory,
  addStat,
  loadASRConfig,
  loadEnabledMemoryCorpus,
  loadTextModelConfig,
} from '../db/database';
import {
  enhanceText,
  getEnhancementRequestBudget,
} from './textEnhancement';
import {buildMemoryContextUsage} from './memoryContext';

type OverlayManagerModule = {
  startMonitoring: () => void;
  stopMonitoring: () => void;
  toggleRecording: () => void;
  setOverlayState?: (payload: {
    state: string;
    duration?: string;
    level?: number;
    stateLabel?: string;
  }) => void;
  appendLog?: (message: string) => void;
};

type AudioRecorderModule = {
  startRecording: () => void;
  stopRecording: () => void;
  cancelRecording?: () => void;
};

type SpeechTranscriberModule = {
  transcribeFile: (filePath: string, language: string) => Promise<string>;
};

type SherpaTranscriberModule = {
  transcribeFile: (
    filePath: string,
    engine: string,
    modelKey: string,
    language: string,
  ) => Promise<string>;
  isRuntimeReady: () => Promise<boolean>;
  isModelReady: (engine: string, modelKey: string) => Promise<boolean>;
};

type TextInserterModule = {
  insertText: (text: string) => Promise<boolean> | void;
};

const nativeOverlayManager = NativeModules.OverlayManager;
const nativeAudioRecorder = NativeModules.AudioRecorder;

const OverlayManager = nativeOverlayManager as
  | OverlayManagerModule
  | undefined;
const AudioRecorder = nativeAudioRecorder as AudioRecorderModule | undefined;
const SpeechTranscriber = NativeModules.SpeechTranscriber as
  | SpeechTranscriberModule
  | undefined;
const SherpaTranscriber = NativeModules.SherpaTranscriber as
  | SherpaTranscriberModule
  | undefined;
const TextInserter = NativeModules.TextInserter as TextInserterModule | undefined;

const overlayEmitter = OverlayManager
  ? new NativeEventEmitter(nativeOverlayManager)
  : null;
const audioEmitter = AudioRecorder
  ? new NativeEventEmitter(nativeAudioRecorder)
  : null;

const LOG_PREFIX = '[RecorderWorkflow]';

export interface OverlayState {
  state: string;
  duration: string;
  level: number;
  label?: string;
}

export function useRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [overlayState, setOverlayState] = useState<OverlayState>({
    state: 'idle',
    duration: '00:00',
    level: 0,
  });
  const recordingRef = useRef(false);
  const processingRef = useRef(false);
  const audioDurationRef = useRef(0);
  const recordingStartTimeRef = useRef(0);

  const appendLog = useCallback((message: string) => {
    const line = `${LOG_PREFIX} ${message}`;
    console.log(line);
    OverlayManager?.appendLog?.(line);
  }, []);

  const updateOverlay = useCallback(
    (state: OverlayState) => {
      setOverlayState(state);
      OverlayManager?.setOverlayState?.({
        state: state.state,
        duration: state.duration || '00:00',
        level: state.level,
        stateLabel: state.label,
      });
    },
    [],
  );

  const hideOverlay = useCallback(() => {
    setOverlayState({state: 'idle', duration: '00:00', level: 0});
    OverlayManager?.setOverlayState?.({state: 'hidden'});
  }, []);

  const showWaitingForRecording = useCallback(() => {
    updateOverlay({
      state: 'recording',
      duration: '00:00',
      level: 0,
      label: '等待录音',
    });
  }, [updateOverlay]);

  const showTranscribing = useCallback(() => {
    updateOverlay({
      state: 'transcribing',
      duration: '00:00',
      level: 0,
      label: '录音转文字',
    });
  }, [updateOverlay]);

  const showEnhancing = useCallback(() => {
    updateOverlay({
      state: 'enhancing',
      duration: '00:00',
      level: 0,
      label: '文本增强',
    });
  }, [updateOverlay]);

  const processRecording = useCallback(
    async (filePath: string) => {
      if (processingRef.current) {
        appendLog(`skip processRecording; already processing path=${filePath}`);
        return;
      }

      processingRef.current = true;
      appendLog(`recording complete; processing file=${filePath}`);

      try {
        showTranscribing();
        const transcribed = await transcribeAudio(filePath, appendLog);
        const asrOriginalText = transcribed;
        appendLog(`speech transcription complete; chars=${asrOriginalText.length}`);

        if (!asrOriginalText.trim()) {
          appendLog('transcription is empty; skip history and insertion.');
          return;
        }

        showEnhancing();
        const enhancement = await doEnhanceText(asrOriginalText, appendLog);
        const enhanced = enhancement.text;
        appendLog(`text normalization complete; chars=${enhanced.length}`);

        await addHistory({
          originalText: asrOriginalText,
          enhancedText: enhanced,
          enhanceElapsedMs: enhancement.elapsedMs,
          inputTokens: enhancement.inputTokens,
          outputTokens: enhancement.outputTokens,
        });
        appendLog(
          `history saved. originalChars=${asrOriginalText.length} enhancedChars=${enhanced.length} enhanceElapsedMs=${enhancement.elapsedMs} inputTokens=${enhancement.inputTokens} outputTokens=${enhancement.outputTokens} same=${asrOriginalText === enhanced}`,
        );

        await addStat({
          audioDurationSec: audioDurationRef.current,
          originalChars: asrOriginalText.length,
          enhancedChars: enhanced.length,
          inputTokens: enhancement.inputTokens,
          outputTokens: enhancement.outputTokens,
        });
        appendLog('stats recorded.');
        hideOverlay();

        if (TextInserter) {
          await TextInserter.insertText(enhanced);
          appendLog('text inserted into current focused input.');
        } else {
          appendLog('TextInserter native module unavailable; insertion skipped.');
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        appendLog(`workflow failed: ${message}`);
      } finally {
        processingRef.current = false;
        hideOverlay();
      }
    },
    [appendLog, hideOverlay, showEnhancing, showTranscribing],
  );

  // Listen to Fn key toggle
  useEffect(() => {
    appendLog('useRecorder mounted.');
    appendLog(
      `native modules: overlay=${!!OverlayManager} audio=${!!AudioRecorder} sherpa=${!!SherpaTranscriber} speech=${!!SpeechTranscriber} inserter=${!!TextInserter}`,
    );

    if (!OverlayManager || !overlayEmitter || !AudioRecorder || !audioEmitter) {
      appendLog(
        `native module missing: overlay=${!!OverlayManager} audio=${!!AudioRecorder} audioEmitter=${!!audioEmitter}`,
      );
      return;
    }

    const sub1 = overlayEmitter.addListener(
      'onRecordingStateChange',
      async (event: {isRecording: boolean}) => {
        const wasRecording = recordingRef.current;
        setIsRecording(event.isRecording);
        recordingRef.current = event.isRecording;
        appendLog(
          `onRecordingStateChange isRecording=${event.isRecording} wasRecording=${wasRecording}`,
        );

        if (event.isRecording) {
          showWaitingForRecording();
          appendLog('starting native audio recorder');
          audioDurationRef.current = 0;
          recordingStartTimeRef.current = Date.now();
          AudioRecorder.startRecording();
        } else if (wasRecording) {
          audioDurationRef.current = Math.round((Date.now() - recordingStartTimeRef.current) / 1000);
          appendLog(`stopping native audio recorder, duration=${audioDurationRef.current}s`);
          showTranscribing();
          AudioRecorder.stopRecording();
        } else {
          appendLog('received stop state while not recording; ignored.');
        }
      },
    );

    // Audio level updates
    const sub2 = audioEmitter.addListener(
      'onAudioLevel',
      () => {
        // The native overlay owns its timer and level animation. Updating it
        // from JS on every audio-level tick races the native timer and creates
        // duplicate/flickering panels.
      },
    );

    // Record complete
    const sub3 = audioEmitter.addListener(
      'onRecordComplete',
      async (event: {success: boolean; filePath: string; error?: string}) => {
        appendLog(
          `onRecordComplete success=${event.success} filePath=${event.filePath || ''} error=${event.error || ''}`,
        );

        if (!event.success) {
          hideOverlay();
          appendLog(
            `recording failed; workflow stopped.${event.error ? ` error=${event.error}` : ''}`,
          );
          if (recordingRef.current) {
            appendLog('resetting native recording state after recorder failure.');
            OverlayManager.toggleRecording();
          }
          return;
        }

        showTranscribing();
        processRecording(event.filePath);
      },
    );

    appendLog('starting native fn monitor.');
    OverlayManager.startMonitoring();

    return () => {
      appendLog('useRecorder unmounted; stopping native fn monitor.');
      sub1.remove();
      sub2.remove();
      sub3.remove();
      OverlayManager.stopMonitoring();
    };
  }, [
    appendLog,
    hideOverlay,
    processRecording,
    showTranscribing,
    showWaitingForRecording,
  ]);

  const toggleRecording = useCallback(() => {
    if (OverlayManager) {
      OverlayManager.toggleRecording();
    }
  }, []);

  return {isRecording, overlayState, toggleRecording, updateOverlay};
}

async function transcribeAudio(
  filePath: string,
  appendLog: (message: string) => void,
): Promise<string> {
  const asr = await loadASRConfig({
    engine: 'sensevoice',
    model: 'senseVoiceSmall',
    language: 'auto',
    sample_rate: '16k',
  });

  const language = asr.language || 'auto';
  appendLog(
    `transcribing audio via native speech model engine=${asr.engine} model=${asr.model} language=${language}`,
  );

  if (asr.engine === 'sensevoice' || asr.engine === 'whisper') {
    if (!SherpaTranscriber) {
      throw new Error('SherpaTranscriber native module is unavailable.');
    }
    const runtimeReady = await SherpaTranscriber.isRuntimeReady();
    if (!runtimeReady) {
      throw new Error(
        'Sherpa runtime is not downloaded. Please download the selected ASR model in settings first.',
      );
    }
    const ready = await SherpaTranscriber.isModelReady(asr.engine, asr.model);
    if (!ready) {
      throw new Error(
        `Model "${asr.model}" for engine "${asr.engine}" is not downloaded. Please download it in ASR settings.`,
      );
    }
    return SherpaTranscriber.transcribeFile(
      filePath,
      asr.engine,
      asr.model,
      language,
    );
  }

  if (!SpeechTranscriber) {
    throw new Error('SpeechTranscriber native module is unavailable.');
  }
  return SpeechTranscriber.transcribeFile(filePath, language);
}

async function doEnhanceText(
  text: string,
  appendLog: (message: string) => void,
): Promise<{text: string; elapsedMs: number; inputTokens: number; outputTokens: number}> {
  const startedAt = Date.now();
  try {
    const configStartedAt = Date.now();
    const cfg = await loadTextModelConfig({
      provider: '',
      model: '',
      base_url: '',
      api_key: '',
      prompt: '',
    });
    appendLog(`text model config loaded elapsedMs=${Date.now() - configStartedAt}`);

    if (!cfg.provider || !cfg.model || !cfg.base_url || !cfg.api_key) {
      appendLog('text model is not configured; using local dictation cleanup fallback.');
      return {
        text: cleanupDictationTextLocally(text),
        elapsedMs: Date.now() - startedAt,
        inputTokens: 0,
        outputTokens: 0,
      };
    }

    const budget = getEnhancementRequestBudget(text.length);
    const memoryStartedAt = Date.now();
    const memoryItems = await loadEnabledMemoryCorpus();
    const memoryUsage = buildMemoryContextUsage(memoryItems);
    const memoryContext = memoryUsage.context;
    appendLog(
      `memory corpus loaded elapsedMs=${Date.now() - memoryStartedAt} enabledItems=${memoryItems.length} contextChars=${memoryContext.length} contextTokens=${memoryUsage.passedTokens}`,
    );

    appendLog(
      `text enhancement request provider=${cfg.provider} model=${cfg.model} endpoint=${endpointLabel(cfg.base_url)} inputChars=${text.length} promptChars=${(cfg.prompt || '').length} memoryChars=${memoryContext.length} timeoutMs=${budget.timeoutMs}`,
    );

    const requestStartedAt = Date.now();
    const result = await enhanceText(text, {
      provider: cfg.provider,
      model: cfg.model,
      baseUrl: cfg.base_url,
      apiKey: cfg.api_key,
      prompt: cfg.prompt,
      memoryContext,
    });
    const requestElapsedMs = Date.now() - requestStartedAt;
    const outputText = result.text || cleanupDictationTextLocally(text);
    appendLog(
      `text enhancement request finished requestElapsedMs=${requestElapsedMs} networkElapsedMs=${result.timing.requestElapsedMs} parseElapsedMs=${result.timing.parseElapsedMs} payloadBytes=${result.timing.payloadBytes} totalElapsedMs=${Date.now() - startedAt} outputChars=${outputText.length} inputTokens=${result.inputTokens} outputTokens=${result.outputTokens}`,
    );
    return {
      text: outputText,
      elapsedMs: requestElapsedMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    appendLog(
      `text model enhancement failed after ${Date.now() - startedAt}ms: ${message}; using local dictation cleanup fallback.`,
    );
    return {
      text: cleanupDictationTextLocally(text),
      elapsedMs: Date.now() - startedAt,
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}

function endpointLabel(baseUrl: string): string {
  return baseUrl.replace(/^https?:\/\//, '').split('/')[0] || 'unknown';
}

function cleanupDictationTextLocally(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([，。！？；：,.!?;:])/g, '$1')
    .replace(/^(嗯|呃|啊|额|这个|那个|就是|然后|所以)[，,\s]+/g, '')
    .replace(/[，,\s]+(嗯|呃|啊|额)(?=[，。！？；：,.!?;:\s]|$)/g, '')
    .trim();
}
