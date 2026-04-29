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
const TextInserter = NativeModules.TextInserter as TextInserterModule | undefined;

const overlayEmitter = OverlayManager
  ? new NativeEventEmitter(nativeOverlayManager)
  : null;
const audioEmitter = AudioRecorder
  ? new NativeEventEmitter(nativeAudioRecorder)
  : null;

const LOG_PREFIX = '[RecorderWorkflow]';
const MAX_MEMORY_CONTEXT_CHARS = 12000;

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
        });
        appendLog(
          `history saved. originalChars=${asrOriginalText.length} enhancedChars=${enhanced.length} enhanceElapsedMs=${enhancement.elapsedMs} same=${asrOriginalText === enhanced}`,
        );

        await addStat({
          audioDurationSec: audioDurationRef.current,
          originalChars: asrOriginalText.length,
          enhancedChars: enhanced.length,
          inputTokens: Math.ceil(asrOriginalText.length * 0.5),
          outputTokens: Math.ceil(enhanced.length * 0.5),
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
      `native modules: overlay=${!!OverlayManager} audio=${!!AudioRecorder} speech=${!!SpeechTranscriber} inserter=${!!TextInserter}`,
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
      async (event: {success: boolean; filePath: string}) => {
        appendLog(
          `onRecordComplete success=${event.success} filePath=${event.filePath || ''}`,
        );

        if (!event.success) {
          hideOverlay();
          appendLog('recording failed; workflow stopped.');
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
  if (!SpeechTranscriber) {
    throw new Error('SpeechTranscriber native module is unavailable.');
  }

  const asr = await loadASRConfig({
    engine: 'apple-speech',
    model: 'apple-speech',
    language: 'auto',
    sample_rate: '16k',
  });

  appendLog(
    `transcribing audio via native speech model engine=${asr.engine} model=${asr.model} language=${asr.language}`,
  );
  return SpeechTranscriber.transcribeFile(filePath, asr.language || 'auto');
}

async function doEnhanceText(
  text: string,
  appendLog: (message: string) => void,
): Promise<{text: string; elapsedMs: number}> {
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
      };
    }

    const budget = getEnhancementRequestBudget(text.length);
    const memoryStartedAt = Date.now();
    const memoryItems = await loadEnabledMemoryCorpus();
    const memoryContext = buildMemoryContext(memoryItems);
    appendLog(
      `memory corpus loaded elapsedMs=${Date.now() - memoryStartedAt} enabledItems=${memoryItems.length} contextChars=${memoryContext.length}`,
    );

    appendLog(
      `text enhancement request provider=${cfg.provider} model=${cfg.model} endpoint=${endpointLabel(cfg.base_url)} inputChars=${text.length} promptChars=${(cfg.prompt || '').length} memoryChars=${memoryContext.length} timeoutMs=${budget.timeoutMs}`,
    );

    const requestStartedAt = Date.now();
    const enhanced = await enhanceText(text, {
      provider: cfg.provider,
      model: cfg.model,
      baseUrl: cfg.base_url,
      apiKey: cfg.api_key,
      prompt: cfg.prompt,
      memoryContext,
    });
    const requestElapsedMs = Date.now() - requestStartedAt;
    appendLog(
      `text enhancement request finished requestElapsedMs=${requestElapsedMs} totalElapsedMs=${Date.now() - startedAt} outputChars=${enhanced.length}`,
    );
    return {
      text: enhanced || cleanupDictationTextLocally(text),
      elapsedMs: requestElapsedMs,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    appendLog(
      `text model enhancement failed after ${Date.now() - startedAt}ms: ${message}; using local dictation cleanup fallback.`,
    );
    return {
      text: cleanupDictationTextLocally(text),
      elapsedMs: Date.now() - startedAt,
    };
  }
}

function buildMemoryContext(
  items: Array<{type: string; title: string; content: string; source_path?: string | null}>,
): string {
  const sections: string[] = [];
  let usedChars = 0;

  for (const item of items) {
    const content = item.content.trim();
    if (!content) {
      continue;
    }

    const header = [
      `### ${item.title || '未命名语料'}`,
      `类型：${item.type === 'markdown' ? 'Markdown 文件语料' : '历史精选语料'}`,
      item.source_path ? `来源：${item.source_path}` : '',
    ].filter(Boolean).join('\n');
    const remaining = MAX_MEMORY_CONTEXT_CHARS - usedChars;
    if (remaining <= 0) {
      break;
    }

    const section = `${header}\n${content}`.slice(0, remaining);
    sections.push(section);
    usedChars += section.length;
  }

  return sections.join('\n\n');
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
