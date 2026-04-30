import {NativeEventEmitter, NativeModules, Platform} from 'react-native';

const {ModelDownloader} = NativeModules;
const emitter = ModelDownloader ? new NativeEventEmitter(ModelDownloader) : null;

// Each model downloads individual files (model.onnx + tokens.txt)
// Priority: domestic mirror (hf-mirror.com) → GitHub
interface ModelFiles {
  files: Array<{name: string; urls: string[]}>;
}

const SHERPA_RUNTIME_VERSION = 'v1.12.39';
const SHERPA_RUNTIME_DOWNLOAD_SUFFIX = '__sherpaRuntime';

// SenseVoice: the upstream HuggingFace repo only ships two variants of the
// same multilingual model — model.int8.onnx (~239MB, quantized) and
// model.onnx (~938MB, full precision). There is no small/medium/large.
// We expose two entries:
//   senseVoiceSmall → int8 quantized
//   senseVoiceLarge → full precision
const SENSE_VOICE_REPO =
  'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17';
const senseVoiceMirrors = (file: string): string[] => [
  `https://hf-mirror.com/${SENSE_VOICE_REPO}/resolve/main/${file}`,
  `https://huggingface.co/${SENSE_VOICE_REPO}/resolve/main/${file}`,
];
const senseVoiceTokens = {name: 'tokens.txt', urls: senseVoiceMirrors('tokens.txt')};

const MODEL_DEFS: Record<string, ModelFiles> = {
  senseVoiceSmall: {
    files: [
      {name: 'model.int8.onnx', urls: senseVoiceMirrors('model.int8.onnx')},
      senseVoiceTokens,
    ],
  },
  senseVoiceLarge: {
    files: [
      {name: 'model.onnx', urls: senseVoiceMirrors('model.onnx')},
      senseVoiceTokens,
    ],
  },
  ...buildWhisperEntries(),
};

// Whisper sherpa-onnx repos publish three files per size:
//   <size>-encoder.int8.onnx, <size>-decoder.int8.onnx, <size>-tokens.txt
// (plus non-quantized .onnx variants which are larger). We use int8 to keep
// downloads small. Repo name is "sherpa-onnx-whisper-<size>" except large-v3
// which lives at "sherpa-onnx-whisper-large-v3".
function buildWhisperEntries(): Record<string, ModelFiles> {
  const sizes: Array<{key: string; repo: string; prefix: string}> = [
    {key: 'whisperTiny', repo: 'sherpa-onnx-whisper-tiny', prefix: 'tiny'},
    {key: 'whisperBase', repo: 'sherpa-onnx-whisper-base', prefix: 'base'},
    {key: 'whisperSmall', repo: 'sherpa-onnx-whisper-small', prefix: 'small'},
    {key: 'whisperMedium', repo: 'sherpa-onnx-whisper-medium', prefix: 'medium'},
    {key: 'whisperLarge', repo: 'sherpa-onnx-whisper-large-v3', prefix: 'large-v3'},
  ];
  const out: Record<string, ModelFiles> = {};
  for (const {key, repo, prefix} of sizes) {
    const fileName = (suffix: string) => `${prefix}-${suffix}`;
    const mirrors = (suffix: string) => [
      `https://hf-mirror.com/csukuangfj/${repo}/resolve/main/${fileName(suffix)}`,
      `https://huggingface.co/csukuangfj/${repo}/resolve/main/${fileName(suffix)}`,
    ];
    out[key] = {
      files: [
        {name: fileName('encoder.int8.onnx'), urls: mirrors('encoder.int8.onnx')},
        {name: fileName('decoder.int8.onnx'), urls: mirrors('decoder.int8.onnx')},
        {name: fileName('tokens.txt'), urls: mirrors('tokens.txt')},
      ],
    };
  }
  return out;
}

export function getModelFiles(modelKey: string): Array<{name: string; urls: string[]}> {
  return MODEL_DEFS[modelKey]?.files ?? [];
}

function githubRelease(file: string): string {
  return `https://github.com/k2-fsa/sherpa-onnx/releases/download/${SHERPA_RUNTIME_VERSION}/${file}`;
}

function sourceForgeRelease(file: string): string {
  return `https://sourceforge.net/projects/sherpa-onnx.mirror/files/${SHERPA_RUNTIME_VERSION}/${file}/download`;
}

export function getSherpaRuntimeDownloadKey(modelKey: string): string {
  return `${modelKey}${SHERPA_RUNTIME_DOWNLOAD_SUFFIX}`;
}

export function isSherpaRuntimeDownloadKey(modelKey: string): boolean {
  return modelKey.endsWith(SHERPA_RUNTIME_DOWNLOAD_SUFFIX);
}

export function modelKeyFromSherpaRuntimeDownloadKey(modelKey: string): string {
  return isSherpaRuntimeDownloadKey(modelKey)
    ? modelKey.slice(0, -SHERPA_RUNTIME_DOWNLOAD_SUFFIX.length)
    : modelKey;
}

export function getSherpaRuntimeFiles(): Array<{name: string; urls: string[]}> {
  let file: string | null = null;
  if (Platform.OS === 'macos') {
    file = `sherpa-onnx-${SHERPA_RUNTIME_VERSION}-osx-universal2-shared-lib.tar.bz2`;
  } else if (Platform.OS === 'windows') {
    file = `sherpa-onnx-${SHERPA_RUNTIME_VERSION}-win-x64-shared-MD-MinSizeRel-no-tts-lib.tar.bz2`;
  }
  return file ? [{name: file, urls: [githubRelease(file), sourceForgeRelease(file)]}] : [];
}

export async function startSherpaRuntimeDownload(modelKey: string): Promise<string> {
  const files = getSherpaRuntimeFiles();
  if (files.length === 0) {
    throw new Error(`No Sherpa runtime defined for platform: ${Platform.OS}`);
  }
  if (!ModelDownloader) throw new Error('ModelDownloader native module not available');
  const result = await ModelDownloader.downloadModelFiles(
    getSherpaRuntimeDownloadKey(modelKey),
    files,
  );
  return result;
}

export async function startModelDownload(modelKey: string): Promise<string> {
  const files = getModelFiles(modelKey);
  if (files.length === 0) throw new Error(`No files defined for model: ${modelKey}`);
  if (!ModelDownloader) throw new Error('ModelDownloader native module not available');
  const result = await ModelDownloader.downloadModelFiles(modelKey, files);
  return result;
}

export function cancelModelDownload(modelKey: string): void {
  if (ModelDownloader) {
    ModelDownloader.cancelDownload(modelKey);
  }
}

export function useModelDownload() {
  return {
    emitter,
    startDownload: startModelDownload,
    startRuntimeDownload: startSherpaRuntimeDownload,
    cancelDownload: cancelModelDownload,
    getModelFiles,
    getSherpaRuntimeFiles,
  };
}
