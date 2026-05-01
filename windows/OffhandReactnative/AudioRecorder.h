#pragma once

#include "AppPaths.h"
#include "JSValue.h"
#include "NativeModules.h"

#include <windows.h>
#include <mmsystem.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <ctime>
#include <filesystem>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#pragma comment(lib, "winmm.lib")

namespace winrt::OffhandReactnative {

REACT_MODULE(AudioRecorder)
struct AudioRecorder {
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &reactContext) noexcept {
    m_reactContext = reactContext;
  }

  ~AudioRecorder() {
    stopRecordingInternal(false);
  }

  REACT_METHOD(startRecording)
  void startRecording() noexcept {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_recording) {
      return;
    }

    try {
      auto now = std::chrono::system_clock::now();
      auto time = std::chrono::system_clock::to_time_t(now);
      std::tm tm{};
      localtime_s(&tm, &time);
      wchar_t ts[64]{};
      wcsftime(ts, sizeof(ts) / sizeof(ts[0]), L"%Y%m%d_%H%M%S", &tm);

      auto recordingsDir = AppPathHelpers::recordingsDirectory();
      m_recordPath = recordingsDir / (std::wstring(L"recording_") + ts + L".wav");
      m_dataBytes = 0;
      m_levelTick = 0;

      m_file = CreateFileW(
          m_recordPath.c_str(),
          GENERIC_WRITE,
          FILE_SHARE_READ,
          nullptr,
          CREATE_ALWAYS,
          FILE_ATTRIBUTE_NORMAL,
          nullptr);
      if (m_file == INVALID_HANDLE_VALUE) {
        emitRecordComplete(false, "Failed to create recording file.");
        return;
      }
      writeWavHeader(0);

      WAVEFORMATEX format{};
      format.wFormatTag = WAVE_FORMAT_PCM;
      format.nChannels = 1;
      format.nSamplesPerSec = 16000;
      format.wBitsPerSample = 16;
      format.nBlockAlign = static_cast<WORD>(format.nChannels * format.wBitsPerSample / 8);
      format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;

      MMRESULT openResult = waveInOpen(
          &m_waveIn,
          WAVE_MAPPER,
          &format,
          reinterpret_cast<DWORD_PTR>(&AudioRecorder::waveInProc),
          reinterpret_cast<DWORD_PTR>(this),
          CALLBACK_FUNCTION);
      if (openResult != MMSYSERR_NOERROR) {
        cleanupFileHandle();
        emitRecordComplete(false, "Failed to open microphone input.");
        return;
      }

      constexpr size_t kBufferCount = 4;
      constexpr size_t kBufferBytes = 16000 / 10 * sizeof(int16_t); // 100ms at 16k mono PCM16
      m_buffers.clear();
      for (size_t i = 0; i < kBufferCount; ++i) {
        auto buffer = std::make_unique<RecordBuffer>();
        buffer->data.resize(kBufferBytes);
        ZeroMemory(&buffer->header, sizeof(buffer->header));
        buffer->header.lpData = reinterpret_cast<LPSTR>(buffer->data.data());
        buffer->header.dwBufferLength = static_cast<DWORD>(buffer->data.size());
        if (waveInPrepareHeader(m_waveIn, &buffer->header, sizeof(WAVEHDR)) != MMSYSERR_NOERROR ||
            waveInAddBuffer(m_waveIn, &buffer->header, sizeof(WAVEHDR)) != MMSYSERR_NOERROR) {
          cleanupWaveIn();
          cleanupFileHandle();
          emitRecordComplete(false, "Failed to prepare microphone buffers.");
          return;
        }
        m_buffers.emplace_back(std::move(buffer));
      }

      if (waveInStart(m_waveIn) != MMSYSERR_NOERROR) {
        cleanupWaveIn();
        cleanupFileHandle();
        emitRecordComplete(false, "Failed to start microphone recording.");
        return;
      }

      m_recording = true;
      AppPathHelpers::appendLog("[AudioRecorder]", "recording started: " + AppPathHelpers::toUtf8(m_recordPath));
    } catch (std::exception const &e) {
      cleanupWaveIn();
      cleanupFileHandle();
      emitRecordComplete(false, e.what());
    } catch (...) {
      cleanupWaveIn();
      cleanupFileHandle();
      emitRecordComplete(false, "Failed to start recording.");
    }
  }

  REACT_METHOD(stopRecording)
  void stopRecording() noexcept {
    stopRecordingInternal(true);
  }

  REACT_METHOD(cancelRecording)
  void cancelRecording() noexcept {
    std::filesystem::path pathToDelete;
    {
      std::lock_guard<std::mutex> lock(m_mutex);
      pathToDelete = m_recordPath;
    }
    stopRecordingInternal(false);
    std::error_code ec;
    std::filesystem::remove(pathToDelete, ec);
  }

  REACT_METHOD(addListener)
  void addListener(std::string) noexcept {}

  REACT_METHOD(removeListeners)
  void removeListeners(double) noexcept {}

 private:
  struct RecordBuffer {
    WAVEHDR header{};
    std::vector<BYTE> data;
  };

  static void CALLBACK waveInProc(
      HWAVEIN,
      UINT msg,
      DWORD_PTR instance,
      DWORD_PTR param1,
      DWORD_PTR) {
    if (msg != WIM_DATA || instance == 0) {
      return;
    }
    auto *self = reinterpret_cast<AudioRecorder *>(instance);
    self->handleWaveData(reinterpret_cast<WAVEHDR *>(param1));
  }

  void handleWaveData(WAVEHDR *header) noexcept {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!header || m_file == INVALID_HANDLE_VALUE) {
      return;
    }

    if (m_recording && header->dwBytesRecorded > 0) {
      DWORD written = 0;
      WriteFile(m_file, header->lpData, header->dwBytesRecorded, &written, nullptr);
      m_dataBytes += written;
      emitLevelFromPcm(header->lpData, written);
    }

    if (m_recording && m_waveIn) {
      header->dwBytesRecorded = 0;
      waveInAddBuffer(m_waveIn, header, sizeof(WAVEHDR));
    }
  }

  void stopRecordingInternal(bool emitSuccess) noexcept {
    std::filesystem::path completedPath;
    bool hadRecording = false;
    HWAVEIN waveIn = nullptr;
    {
      std::lock_guard<std::mutex> lock(m_mutex);
      hadRecording = m_recording || m_waveIn != nullptr || m_file != INVALID_HANDLE_VALUE;
      completedPath = m_recordPath;
      m_recording = false;
      waveIn = m_waveIn;
    }

    if (waveIn) {
      waveInStop(waveIn);
      waveInReset(waveIn);
    }

    {
      std::lock_guard<std::mutex> lock(m_mutex);
      if (m_waveIn) {
        cleanupWaveIn();
      }

      if (m_file != INVALID_HANDLE_VALUE) {
        writeWavHeader(m_dataBytes);
        cleanupFileHandle();
      }
    }

    if (emitSuccess && hadRecording) {
      AppPathHelpers::appendLog("[AudioRecorder]", "recording stopped: " + AppPathHelpers::toUtf8(completedPath));
      emitRecordComplete(true, "", completedPath);
    }
  }

  void cleanupWaveIn() noexcept {
    if (!m_waveIn) {
      return;
    }
    for (auto &buffer : m_buffers) {
      if (buffer && (buffer->header.dwFlags & WHDR_PREPARED)) {
        waveInUnprepareHeader(m_waveIn, &buffer->header, sizeof(WAVEHDR));
      }
    }
    waveInClose(m_waveIn);
    m_waveIn = nullptr;
    m_buffers.clear();
  }

  void cleanupFileHandle() noexcept {
    if (m_file != INVALID_HANDLE_VALUE) {
      CloseHandle(m_file);
      m_file = INVALID_HANDLE_VALUE;
    }
  }

  void writeWavHeader(DWORD dataBytes) noexcept {
    if (m_file == INVALID_HANDLE_VALUE) {
      return;
    }

    DWORD riffSize = 36 + dataBytes;
    DWORD fmtSize = 16;
    WORD audioFormat = 1;
    WORD channels = 1;
    DWORD sampleRate = 16000;
    WORD bitsPerSample = 16;
    WORD blockAlign = channels * bitsPerSample / 8;
    DWORD byteRate = sampleRate * blockAlign;
    DWORD written = 0;

    SetFilePointer(m_file, 0, nullptr, FILE_BEGIN);
    WriteFile(m_file, "RIFF", 4, &written, nullptr);
    WriteFile(m_file, &riffSize, sizeof(riffSize), &written, nullptr);
    WriteFile(m_file, "WAVE", 4, &written, nullptr);
    WriteFile(m_file, "fmt ", 4, &written, nullptr);
    WriteFile(m_file, &fmtSize, sizeof(fmtSize), &written, nullptr);
    WriteFile(m_file, &audioFormat, sizeof(audioFormat), &written, nullptr);
    WriteFile(m_file, &channels, sizeof(channels), &written, nullptr);
    WriteFile(m_file, &sampleRate, sizeof(sampleRate), &written, nullptr);
    WriteFile(m_file, &byteRate, sizeof(byteRate), &written, nullptr);
    WriteFile(m_file, &blockAlign, sizeof(blockAlign), &written, nullptr);
    WriteFile(m_file, &bitsPerSample, sizeof(bitsPerSample), &written, nullptr);
    WriteFile(m_file, "data", 4, &written, nullptr);
    WriteFile(m_file, &dataBytes, sizeof(dataBytes), &written, nullptr);
    SetFilePointer(m_file, 0, nullptr, FILE_END);
  }

  void emitLevelFromPcm(char const *data, DWORD bytes) noexcept {
    if (++m_levelTick % 1 != 0 || bytes < sizeof(int16_t)) {
      return;
    }
    auto samples = reinterpret_cast<int16_t const *>(data);
    size_t count = bytes / sizeof(int16_t);
    double sum = 0.0;
    for (size_t i = 0; i < count; ++i) {
      double v = static_cast<double>(samples[i]) / 32768.0;
      sum += v * v;
    }
    double rms = std::sqrt(sum / std::max<size_t>(count, 1));
    double level = std::clamp(rms * 4.0, 0.0, 1.0);
    emitEvent("onAudioLevel", winrt::Microsoft::ReactNative::JSValueObject{{"level", level}});
  }

  void emitRecordComplete(
      bool success,
      std::string const &error,
      std::filesystem::path const &filePath = {}) noexcept {
    auto path = filePath.empty() ? m_recordPath : filePath;
    winrt::Microsoft::ReactNative::JSValueObject body{
        {"success", success},
        {"filePath", AppPathHelpers::toUtf8(path)},
    };
    if (!error.empty()) {
      body["error"] = error;
    }
    emitEvent("onRecordComplete", std::move(body));
  }

  void emitEvent(
      std::string const &eventName,
      winrt::Microsoft::ReactNative::JSValueObject &&body) noexcept {
    if (!m_reactContext) {
      return;
    }
    m_reactContext.EmitJSEvent(
        L"RCTDeviceEventEmitter",
        winrt::to_hstring(eventName),
        std::move(body));
  }

  std::mutex m_mutex;
  bool m_recording = false;
  HWAVEIN m_waveIn = nullptr;
  HANDLE m_file = INVALID_HANDLE_VALUE;
  DWORD m_dataBytes = 0;
  uint32_t m_levelTick = 0;
  std::filesystem::path m_recordPath;
  std::vector<std::unique_ptr<RecordBuffer>> m_buffers;
  winrt::Microsoft::ReactNative::ReactContext m_reactContext{nullptr};
};

} // namespace winrt::OffhandReactnative
