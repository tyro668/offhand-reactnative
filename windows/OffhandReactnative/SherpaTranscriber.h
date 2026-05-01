#pragma once

#include "AppPaths.h"
#include "JSValue.h"
#include "NativeModules.h"

#include "../../macos/Vendor/sherpa-onnx/include/sherpa-onnx/c-api/c-api.h"

#include <windows.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <string>
#include <thread>

namespace winrt::OffhandReactnative {

REACT_MODULE(SherpaTranscriber)
struct SherpaTranscriber {
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &reactContext) noexcept {
    m_reactContext = reactContext;
  }

  ~SherpaTranscriber() {
    std::lock_guard<std::mutex> lock(m_mutex);
    ++m_idleGeneration;
    releaseRecognizerAndRuntimeLocked("module destroyed");
  }

  REACT_METHOD(isRuntimeReady)
  void isRuntimeReady(
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    result.Resolve(runtimeReady());
  }

  REACT_METHOD(isModelReady)
  void isModelReady(
      std::string engine,
      std::string modelKey,
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    result.Resolve(modelReady(engine, modelKey));
  }

  REACT_METHOD(setIdleReleaseTimeoutMs)
  void setIdleReleaseTimeoutMs(
      double timeoutMs,
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (std::isnan(timeoutMs) || timeoutMs < 0) {
      timeoutMs = kDefaultIdleReleaseTimeoutMs;
    }
    m_idleReleaseTimeoutMs = timeoutMs;
    appendLog("Sherpa idle release timeout set to " + std::to_string(static_cast<int64_t>(timeoutMs)) + " ms");
    scheduleIdleReleaseLocked();
    result.Resolve(true);
  }

  REACT_METHOD(transcribeFile)
  void transcribeFile(
      std::string filePath,
      std::string engine,
      std::string modelKey,
      std::string language,
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    std::thread([this,
                 filePath = std::move(filePath),
                 engine = std::move(engine),
                 modelKey = std::move(modelKey),
                 language = std::move(language),
                 result = std::move(result)]() mutable noexcept {
      transcribeWorker(
          std::move(filePath),
          std::move(engine),
          std::move(modelKey),
          std::move(language),
          std::move(result));
    }).detach();
  }

 private:
  struct SherpaOnnxApi {
    const SherpaOnnxOfflineRecognizer *(*CreateOfflineRecognizer)(
        const SherpaOnnxOfflineRecognizerConfig *config) = nullptr;
    void (*DestroyOfflineRecognizer)(const SherpaOnnxOfflineRecognizer *recognizer) = nullptr;
    const SherpaOnnxOfflineStream *(*CreateOfflineStream)(
        const SherpaOnnxOfflineRecognizer *recognizer) = nullptr;
    void (*DestroyOfflineStream)(const SherpaOnnxOfflineStream *stream) = nullptr;
    void (*AcceptWaveformOffline)(
        const SherpaOnnxOfflineStream *stream,
        int32_t sample_rate,
        const float *samples,
        int32_t n) = nullptr;
    void (*OfflineStreamSetOption)(
        const SherpaOnnxOfflineStream *stream,
        const char *key,
        const char *value) = nullptr;
    void (*DecodeOfflineStream)(
        const SherpaOnnxOfflineRecognizer *recognizer,
        const SherpaOnnxOfflineStream *stream) = nullptr;
    const SherpaOnnxOfflineRecognizerResult *(*GetOfflineStreamResult)(
        const SherpaOnnxOfflineStream *stream) = nullptr;
    void (*DestroyOfflineRecognizerResult)(const SherpaOnnxOfflineRecognizerResult *r) = nullptr;
    const SherpaOnnxWave *(*ReadWave)(const char *filename) = nullptr;
    void (*FreeWave)(const SherpaOnnxWave *wave) = nullptr;
  };

  static constexpr double kDefaultIdleReleaseTimeoutMs = 3.0 * 60.0 * 1000.0;

  void transcribeWorker(
      std::string filePath,
      std::string engine,
      std::string modelKey,
      std::string language,
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> result) noexcept {
    {
      std::lock_guard<std::mutex> lock(m_mutex);
      ++m_activeTranscriptions;
      ++m_idleGeneration;
    }

    bool ok = false;
    std::string text;
    std::string error;

    {
      std::lock_guard<std::mutex> lock(m_mutex);
      ok = transcribeLocked(filePath, engine, modelKey, normalizeLanguage(language), text, error);
    }

    {
      std::lock_guard<std::mutex> lock(m_mutex);
      if (m_activeTranscriptions > 0) {
        --m_activeTranscriptions;
      }
      scheduleIdleReleaseLocked();
    }

    if (ok) {
      result.Resolve(text);
    } else {
      result.Reject(error.empty() ? "Failed to transcribe audio." : error.c_str());
    }
  }

  bool transcribeLocked(
      std::string const &filePath,
      std::string const &engine,
      std::string const &modelKey,
      std::string const &language,
      std::string &text,
      std::string &error) noexcept {
    std::filesystem::path audioPath = std::filesystem::u8path(filePath);
    std::error_code ec;
    if (filePath.empty() || !std::filesystem::exists(audioPath, ec)) {
      error = "Audio file not found: " + filePath;
      return false;
    }

    appendLog("transcribeFile engine=" + engine + " modelKey=" + modelKey + " lang=" + language + " file=" + filePath);
    if (!ensureRecognizerLocked(engine, modelKey, language, error)) {
      appendLog("ensureRecognizer failed: " + error);
      return false;
    }

    std::string audioPathUtf8 = AppPathHelpers::toUtf8(audioPath);
    const SherpaOnnxWave *wave = m_api.ReadWave(audioPathUtf8.c_str());
    if (!wave) {
      error = "Failed to read WAV: " + audioPathUtf8;
      return false;
    }

    const SherpaOnnxOfflineStream *stream = m_api.CreateOfflineStream(m_recognizer);
    if (!stream) {
      m_api.FreeWave(wave);
      error = "Failed to create offline stream.";
      return false;
    }

    if (engine == "sensevoice") {
      m_api.OfflineStreamSetOption(stream, "language", language.c_str());
    }

    m_api.AcceptWaveformOffline(stream, wave->sample_rate, wave->samples, wave->num_samples);
    m_api.DecodeOfflineStream(m_recognizer, stream);
    const SherpaOnnxOfflineRecognizerResult *recognizerResult = m_api.GetOfflineStreamResult(stream);
    text = recognizerResult && recognizerResult->text ? recognizerResult->text : "";
    appendLog("transcribed text length=" + std::to_string(text.size()));

    if (recognizerResult) {
      m_api.DestroyOfflineRecognizerResult(recognizerResult);
    }
    m_api.DestroyOfflineStream(stream);
    m_api.FreeWave(wave);
    return true;
  }

  bool ensureRecognizerLocked(
      std::string const &engine,
      std::string const &modelKey,
      std::string const &language,
      std::string &error) noexcept {
    if (!ensureRuntimeLoadedLocked(error)) {
      return false;
    }

    std::string cacheKey = engine + "|" + modelKey + "|" + language;
    if (m_recognizer && m_cachedKey == cacheKey) {
      return true;
    }

    destroyRecognizerLocked();
    auto modelDir = modelDirectoryForKey(modelKey);
    std::error_code ec;
    if (!std::filesystem::exists(modelDir, ec)) {
      error = "Model directory not found: " + AppPathHelpers::toUtf8(modelDir);
      return false;
    }

    std::string tokensStr;
    std::string modelStr;
    std::string encoderStr;
    std::string decoderStr;
    std::string langStr = language;
    std::string taskStr = "transcribe";
    std::string decodingStr = "greedy_search";
    std::string providerStr = "cpu";

    SherpaOnnxOfflineRecognizerConfig config;
    memset(&config, 0, sizeof(config));
    config.feat_config.sample_rate = 16000;
    config.feat_config.feature_dim = 80;
    config.model_config.num_threads = 1;
    config.model_config.debug = 0;
    config.model_config.provider = providerStr.c_str();
    config.decoding_method = decodingStr.c_str();
    config.max_active_paths = 4;

    if (engine == "sensevoice") {
      auto modelPath = modelDir / AppPathHelpers::fromUtf8(senseVoiceModelFileForKey(modelKey));
      auto tokensPath = modelDir / L"tokens.txt";
      if (!std::filesystem::exists(modelPath, ec) || !std::filesystem::exists(tokensPath, ec)) {
        error = "Missing SenseVoice files at " + AppPathHelpers::toUtf8(modelDir);
        return false;
      }
      if (!looksLikeTokensFile(tokensPath)) {
        error = "Corrupt tokens file at " + AppPathHelpers::toUtf8(tokensPath);
        return false;
      }
      if (!looksLikeOnnxFile(modelPath, 50LL * 1024LL * 1024LL)) {
        error = "Corrupt or incomplete model file at " + AppPathHelpers::toUtf8(modelPath);
        return false;
      }
      modelStr = AppPathHelpers::toUtf8(modelPath);
      tokensStr = AppPathHelpers::toUtf8(tokensPath);
      config.model_config.tokens = tokensStr.c_str();
      config.model_config.sense_voice.model = modelStr.c_str();
      config.model_config.sense_voice.language = langStr.c_str();
      config.model_config.sense_voice.use_itn = 1;
    } else if (engine == "whisper") {
      std::string prefix = whisperPrefixForKey(modelKey);
      if (prefix.empty()) {
        error = "Unknown whisper model key: " + modelKey;
        return false;
      }
      auto encoder = modelDir / AppPathHelpers::fromUtf8(prefix + "-encoder.int8.onnx");
      auto decoder = modelDir / AppPathHelpers::fromUtf8(prefix + "-decoder.int8.onnx");
      auto tokens = modelDir / AppPathHelpers::fromUtf8(prefix + "-tokens.txt");
      if (!std::filesystem::exists(encoder, ec) ||
          !std::filesystem::exists(decoder, ec) ||
          !std::filesystem::exists(tokens, ec)) {
        error = "Missing Whisper files in " + AppPathHelpers::toUtf8(modelDir);
        return false;
      }
      if (!looksLikeTokensFile(tokens)) {
        error = "Corrupt tokens file at " + AppPathHelpers::toUtf8(tokens);
        return false;
      }
      if (!looksLikeOnnxFile(encoder, 1LL * 1024LL * 1024LL) ||
          !looksLikeOnnxFile(decoder, 1LL * 1024LL * 1024LL)) {
        error = "Corrupt or incomplete Whisper model in " + AppPathHelpers::toUtf8(modelDir);
        return false;
      }
      encoderStr = AppPathHelpers::toUtf8(encoder);
      decoderStr = AppPathHelpers::toUtf8(decoder);
      tokensStr = AppPathHelpers::toUtf8(tokens);
      if (langStr == "auto") {
        langStr.clear();
      }
      config.model_config.tokens = tokensStr.c_str();
      config.model_config.whisper.encoder = encoderStr.c_str();
      config.model_config.whisper.decoder = decoderStr.c_str();
      config.model_config.whisper.language = langStr.c_str();
      config.model_config.whisper.task = taskStr.c_str();
      config.model_config.whisper.tail_paddings = 0;
    } else {
      error = "Unsupported ASR engine: " + engine;
      return false;
    }

    appendLog("creating recognizer engine=" + engine + " modelKey=" + modelKey + " language=" + language);
    const SherpaOnnxOfflineRecognizer *recognizer = m_api.CreateOfflineRecognizer(&config);
    if (!recognizer) {
      error = "SherpaOnnxCreateOfflineRecognizer returned NULL.";
      return false;
    }
    m_recognizer = recognizer;
    m_cachedKey = cacheKey;
    appendLog("recognizer ready (" + cacheKey + ")");
    return true;
  }

  bool ensureRuntimeLoadedLocked(std::string &error) noexcept {
    if (m_sherpaModule) {
      return true;
    }
    if (!runtimeReady()) {
      error = "Sherpa runtime is not downloaded. Please download a SenseVoice or Whisper model in ASR settings first. Runtime path: " +
              AppPathHelpers::toUtf8(AppPathHelpers::sherpaRuntimeCurrentDirectory());
      return false;
    }

    auto runtimeDir = AppPathHelpers::sherpaRuntimeCurrentDirectory();
    auto sherpaDll = findRuntimeDll(runtimeDir, L"sherpa-onnx-c-api.dll");
    auto onnxDll = findRuntimeDll(runtimeDir, L"onnxruntime.dll");
    SetDllDirectoryW(sherpaDll.parent_path().c_str());

    m_onnxRuntimeModule = LoadLibraryW(onnxDll.c_str());
    if (!m_onnxRuntimeModule) {
      error = "Failed to load ONNX Runtime DLL: " + AppPathHelpers::toUtf8(onnxDll);
      SetDllDirectoryW(nullptr);
      return false;
    }
    m_sherpaModule = LoadLibraryW(sherpaDll.c_str());
    if (!m_sherpaModule) {
      error = "Failed to load Sherpa runtime DLL: " + AppPathHelpers::toUtf8(sherpaDll);
      FreeLibrary(m_onnxRuntimeModule);
      m_onnxRuntimeModule = nullptr;
      SetDllDirectoryW(nullptr);
      return false;
    }

#define LOAD_SHERPA_SYMBOL(field, symbol)                                                     \
  m_api.field = reinterpret_cast<decltype(m_api.field)>(GetProcAddress(m_sherpaModule, symbol)); \
  if (!m_api.field) {                                                                          \
    error = std::string("Sherpa runtime is missing symbol ") + symbol;                         \
    unloadRuntimeLocked();                                                                     \
    return false;                                                                              \
  }
    LOAD_SHERPA_SYMBOL(CreateOfflineRecognizer, "SherpaOnnxCreateOfflineRecognizer");
    LOAD_SHERPA_SYMBOL(DestroyOfflineRecognizer, "SherpaOnnxDestroyOfflineRecognizer");
    LOAD_SHERPA_SYMBOL(CreateOfflineStream, "SherpaOnnxCreateOfflineStream");
    LOAD_SHERPA_SYMBOL(DestroyOfflineStream, "SherpaOnnxDestroyOfflineStream");
    LOAD_SHERPA_SYMBOL(AcceptWaveformOffline, "SherpaOnnxAcceptWaveformOffline");
    LOAD_SHERPA_SYMBOL(OfflineStreamSetOption, "SherpaOnnxOfflineStreamSetOption");
    LOAD_SHERPA_SYMBOL(DecodeOfflineStream, "SherpaOnnxDecodeOfflineStream");
    LOAD_SHERPA_SYMBOL(GetOfflineStreamResult, "SherpaOnnxGetOfflineStreamResult");
    LOAD_SHERPA_SYMBOL(DestroyOfflineRecognizerResult, "SherpaOnnxDestroyOfflineRecognizerResult");
    LOAD_SHERPA_SYMBOL(ReadWave, "SherpaOnnxReadWave");
    LOAD_SHERPA_SYMBOL(FreeWave, "SherpaOnnxFreeWave");
#undef LOAD_SHERPA_SYMBOL

    appendLog("Sherpa runtime loaded from " + AppPathHelpers::toUtf8(sherpaDll));
    return true;
  }

  void destroyRecognizerLocked() noexcept {
    if (m_recognizer && m_api.DestroyOfflineRecognizer) {
      m_api.DestroyOfflineRecognizer(m_recognizer);
    }
    m_recognizer = nullptr;
    m_cachedKey.clear();
  }

  void unloadRuntimeLocked() noexcept {
    if (m_sherpaModule) {
      FreeLibrary(m_sherpaModule);
      m_sherpaModule = nullptr;
    }
    if (m_onnxRuntimeModule) {
      FreeLibrary(m_onnxRuntimeModule);
      m_onnxRuntimeModule = nullptr;
    }
    memset(&m_api, 0, sizeof(m_api));
    SetDllDirectoryW(nullptr);
  }

  bool hasLoadedRuntimeOrRecognizerLocked() const noexcept {
    return m_recognizer || m_sherpaModule || m_onnxRuntimeModule;
  }

  void releaseRecognizerAndRuntimeLocked(std::string const &reason) noexcept {
    if (!hasLoadedRuntimeOrRecognizerLocked()) {
      return;
    }
    destroyRecognizerLocked();
    unloadRuntimeLocked();
    AppPathHelpers::trimWorkingSet();
    appendLog("Sherpa runtime released (" + reason + "); working set trimmed");
  }

  void scheduleIdleReleaseLocked() noexcept {
    ++m_idleGeneration;
    if (m_activeTranscriptions > 0 || !hasLoadedRuntimeOrRecognizerLocked() || m_idleReleaseTimeoutMs <= 0) {
      return;
    }

    uint64_t generation = m_idleGeneration.load();
    auto timeout = static_cast<int64_t>(m_idleReleaseTimeoutMs);
    appendLog("scheduled Sherpa idle release in " + std::to_string(timeout) + " ms");
    std::thread([this, generation, timeout]() noexcept {
      std::this_thread::sleep_for(std::chrono::milliseconds(timeout));
      std::lock_guard<std::mutex> lock(m_mutex);
      if (generation == m_idleGeneration && m_activeTranscriptions == 0) {
        releaseRecognizerAndRuntimeLocked("idle timeout");
      }
    }).detach();
  }

  static bool runtimeReady() {
    auto runtimeDir = AppPathHelpers::sherpaRuntimeCurrentDirectory();
    return !findRuntimeDll(runtimeDir, L"sherpa-onnx-c-api.dll").empty() &&
           !findRuntimeDll(runtimeDir, L"onnxruntime.dll").empty();
  }

  static bool modelReady(std::string const &engine, std::string const &modelKey) {
    auto dir = modelDirectoryForKey(modelKey);
    std::error_code ec;
    if (engine == "sensevoice") {
      return std::filesystem::exists(dir / AppPathHelpers::fromUtf8(senseVoiceModelFileForKey(modelKey)), ec) &&
             std::filesystem::exists(dir / L"tokens.txt", ec);
    }
    if (engine == "whisper") {
      std::string prefix = whisperPrefixForKey(modelKey);
      if (prefix.empty()) {
        return false;
      }
      return std::filesystem::exists(dir / AppPathHelpers::fromUtf8(prefix + "-encoder.int8.onnx"), ec) &&
             std::filesystem::exists(dir / AppPathHelpers::fromUtf8(prefix + "-decoder.int8.onnx"), ec) &&
             std::filesystem::exists(dir / AppPathHelpers::fromUtf8(prefix + "-tokens.txt"), ec);
    }
    return false;
  }

  static std::filesystem::path modelDirectoryForKey(std::string const &modelKey) {
    return AppPathHelpers::modelsDirectory() / AppPathHelpers::fromUtf8(modelKey);
  }

  static std::string whisperPrefixForKey(std::string const &modelKey) {
    if (modelKey == "whisperTiny") return "tiny";
    if (modelKey == "whisperBase") return "base";
    if (modelKey == "whisperSmall") return "small";
    if (modelKey == "whisperMedium") return "medium";
    if (modelKey == "whisperLarge") return "large-v3";
    return "";
  }

  static std::string senseVoiceModelFileForKey(std::string const &modelKey) {
    return modelKey == "senseVoiceLarge" ? "model.onnx" : "model.int8.onnx";
  }

  static std::string normalizeLanguage(std::string language) {
    std::transform(language.begin(), language.end(), language.begin(), [](unsigned char c) {
      return static_cast<char>(std::tolower(c));
    });
    if (language.empty() || language == "auto" || language == "asrlanguageauto") return "auto";
    if (language == "asrlanguagezh" || language.rfind("zh", 0) == 0) return "zh";
    if (language == "asrlanguageen" || language.rfind("en", 0) == 0) return "en";
    return language;
  }

  static std::filesystem::path findRuntimeDll(std::filesystem::path const &runtimeDir, std::wstring const &dllName) {
    std::error_code ec;
    for (auto const &entry : std::filesystem::recursive_directory_iterator(runtimeDir, ec)) {
      if (!entry.is_regular_file(ec)) {
        continue;
      }
      std::wstring name = entry.path().filename().wstring();
      std::transform(name.begin(), name.end(), name.begin(), ::towlower);
      if (name == dllName) {
        return entry.path();
      }
    }
    return {};
  }

  static bool looksLikeTokensFile(std::filesystem::path const &path) {
    std::error_code ec;
    auto size = std::filesystem::file_size(path, ec);
    if (ec || size == 0 || size > 50ULL * 1024ULL * 1024ULL) {
      return false;
    }
    std::ifstream in(path, std::ios::binary);
    char buffer[512]{};
    in.read(buffer, sizeof(buffer));
    std::streamsize read = in.gcount();
    if (read <= 0) {
      return false;
    }
    for (std::streamsize i = 0; i < read; ++i) {
      unsigned char c = static_cast<unsigned char>(buffer[i]);
      if (c == 0 || c < 0x09 || (c > 0x0D && c < 0x20)) {
        return false;
      }
    }
    return true;
  }

  static bool looksLikeOnnxFile(std::filesystem::path const &path, long long minBytes) {
    std::error_code ec;
    auto size = static_cast<long long>(std::filesystem::file_size(path, ec));
    if (ec || size < minBytes) {
      return false;
    }
    std::ifstream in(path, std::ios::binary);
    char head[32]{};
    in.read(head, sizeof(head));
    std::streamsize read = in.gcount();
    for (std::streamsize i = 0; i + 4 <= read; ++i) {
      if (memcmp(head + i, "onnx", 4) == 0) {
        return true;
      }
    }
    unsigned char first = read > 0 ? static_cast<unsigned char>(head[0]) : 0;
    return first == 0x08 || first == 0x12;
  }

  void appendLog(std::string const &message) const noexcept {
    AppPathHelpers::appendLog("[ST]", message);
  }

  std::mutex m_mutex;
  const SherpaOnnxOfflineRecognizer *m_recognizer = nullptr;
  HMODULE m_onnxRuntimeModule = nullptr;
  HMODULE m_sherpaModule = nullptr;
  SherpaOnnxApi m_api{};
  std::string m_cachedKey;
  double m_idleReleaseTimeoutMs = kDefaultIdleReleaseTimeoutMs;
  int m_activeTranscriptions = 0;
  std::atomic_uint64_t m_idleGeneration{0};
  winrt::Microsoft::ReactNative::ReactContext m_reactContext{nullptr};
};

} // namespace winrt::OffhandReactnative
