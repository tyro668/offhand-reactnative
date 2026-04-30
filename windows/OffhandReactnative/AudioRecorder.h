#pragma once

#include "JSValue.h"
#include "NativeModules.h"

#include <windows.h>
#include <mmsystem.h>
#include <shlobj.h>
#include <filesystem>
#include <string>

#pragma comment(lib, "winmm.lib")

namespace winrt::OffhandReactnative {

REACT_MODULE(AudioRecorder)
struct AudioRecorder {
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &reactContext) noexcept {
    m_reactContext = reactContext;
  }

  REACT_METHOD(startRecording)
  void startRecording(
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    namespace rn = winrt::Microsoft::ReactNative;

    wchar_t appData[MAX_PATH];
    SHGetFolderPathW(nullptr, CSIDL_APPDATA, nullptr, 0, appData);
    std::filesystem::path recDir = std::filesystem::path(appData) / L"Offhand" / L"Recordings";
    std::filesystem::create_directories(recDir);

    // Simple recording via WAV file using waveIn API (stub)
    // Full implementation requires waveInOpen/waveInStart callbacks
    // For now, create placeholder that returns path

    auto now = std::chrono::system_clock::now();
    auto time = std::chrono::system_clock::to_time_t(now);
    std::tm tm;
    localtime_s(&tm, &time);
    wchar_t ts[64];
    wcsftime(ts, 64, L"%Y%m%d_%H%M%S", &tm);

    std::filesystem::path filePath = recDir / (std::wstring(L"recording_") + ts + L".wav");
    m_recordPath = filePath;

    // TODO: Full waveIn implementation for Windows audio recording
    result.Resolve(rn::JSValueObject{
        {"path", winrt::to_string(winrt::hstring(filePath.wstring()))},
    });
  }

  REACT_METHOD(stopRecording)
  void stopRecording(
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    namespace rn = winrt::Microsoft::ReactNative;
    result.Resolve(rn::JSValueObject{
        {"path", winrt::to_string(winrt::hstring(m_recordPath.wstring()))},
        {"success", true},
    });
  }

 private:
  std::filesystem::path m_recordPath;
  winrt::Microsoft::ReactNative::ReactContext m_reactContext{nullptr};
};

} // namespace winrt::OffhandReactnative
