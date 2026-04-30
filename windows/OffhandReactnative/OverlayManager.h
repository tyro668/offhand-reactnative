#pragma once

#include "JSValue.h"
#include "NativeModules.h"

#include <windows.h>
#include <string>

namespace winrt::OffhandReactnative {

REACT_MODULE(OverlayManager)
struct OverlayManager {
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &reactContext) noexcept {
    m_reactContext = reactContext;
  }

  REACT_METHOD(startMonitoring)
  void startMonitoring(
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    // TODO: Register global hotkey for Fn key on Windows
    // Requires RegisterHotKey or low-level keyboard hook
    result.Resolve(true);
  }

  REACT_METHOD(stopMonitoring)
  void stopMonitoring(
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    result.Resolve(true);
  }

  REACT_METHOD(toggleRecording)
  void toggleRecording(
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    m_recording = !m_recording;
    namespace rn = winrt::Microsoft::ReactNative;
    if (m_reactContext) {
      m_reactContext.EmitJSEvent(L"RCTDeviceEventEmitter", L"onRecordingStateChange",
                                 rn::JSValueObject{{"isRecording", m_recording}});
    }
    result.Resolve(true);
  }

  REACT_METHOD(updateOverlayState)
  void updateOverlayState(
      std::string /*state*/,
      std::string /*duration*/,
      double /*level*/,
      std::string /*label*/,
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    // TODO: Create overlay window on Windows
    result.Resolve(true);
  }

  REACT_METHOD(appendLog)
  void appendLog(
      std::string /*message*/,
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    result.Resolve(true);
  }

 private:
  bool m_recording = false;
  winrt::Microsoft::ReactNative::ReactContext m_reactContext{nullptr};
};

} // namespace winrt::OffhandReactnative
