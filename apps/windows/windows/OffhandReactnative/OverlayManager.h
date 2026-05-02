#pragma once

#include "NativeModules.h"

#include <atomic>
#include <mutex>
#include <string>
#include <thread>

namespace React = winrt::Microsoft::ReactNative;

namespace winrt::OffhandReactnative {

REACT_MODULE(OverlayManager)
struct OverlayManager {
  REACT_INIT(Initialize)
  void Initialize(React::ReactContext const &reactContext) noexcept;

  REACT_METHOD(startMonitoring)
  void startMonitoring() noexcept;

  REACT_METHOD(stopMonitoring)
  void stopMonitoring() noexcept;

  REACT_METHOD(toggleRecording)
  void toggleRecording() noexcept;

  REACT_METHOD(setOverlayState)
  void setOverlayState(React::JSValueObject payload) noexcept;

  REACT_METHOD(getLogFilePath)
  void getLogFilePath(React::ReactPromise<std::string> result) noexcept;

  REACT_METHOD(openLogFolder)
  void openLogFolder(React::ReactPromise<bool> result) noexcept;

  REACT_METHOD(appendLog)
  void appendLog(std::string message) noexcept;

  REACT_METHOD(checkPermissions)
  void checkPermissions(React::ReactPromise<React::JSValue> result) noexcept;

  REACT_METHOD(requestAccessibilityPermission)
  void requestAccessibilityPermission(React::ReactPromise<bool> result) noexcept;

  REACT_METHOD(requestInputMonitoringPermission)
  void requestInputMonitoringPermission(React::ReactPromise<bool> result) noexcept;

  REACT_METHOD(requestMicrophonePermission)
  void requestMicrophonePermission(React::ReactPromise<bool> result) noexcept;

  REACT_METHOD(addListener)
  void addListener(std::string eventName) noexcept;

  REACT_METHOD(removeListeners)
  void removeListeners(double count) noexcept;

 private:
  void threadMain() noexcept;
  void ensureThread() noexcept;
  void postThreadMessage(UINT message, WPARAM wParam = 0, LPARAM lParam = 0) noexcept;
  void toggleRecordingOnThread() noexcept;
  void showOrUpdateOverlayOnThread() noexcept;
  void hideOverlayOnThread() noexcept;
  void paintOverlay(HWND hwnd) noexcept;
  void emitRecordingState(bool isRecording) noexcept;
  void setOverlayStateOnThread(std::wstring state, std::wstring duration, double level, std::wstring label) noexcept;

  static LRESULT CALLBACK HotkeyWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) noexcept;
  static LRESULT CALLBACK OverlayWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) noexcept;

  React::ReactContext m_context{nullptr};
  std::thread m_thread;
  std::atomic<bool> m_running{false};
  std::atomic<bool> m_hotkeyRegistered{false};
  std::atomic<bool> m_recording{false};
  std::atomic<DWORD> m_threadId{0};
  HWND m_messageWindow{nullptr};
  HWND m_overlayWindow{nullptr};

  std::mutex m_stateMutex;
  std::wstring m_state{L"hidden"};
  std::wstring m_duration{L"00:00"};
  std::wstring m_label{};
  double m_level{0};
};

} // namespace winrt::OffhandReactnative
