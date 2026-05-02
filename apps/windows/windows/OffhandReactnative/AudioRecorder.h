#pragma once

#include "NativeModules.h"

#include <mutex>
#include <string>

#include <winrt/Windows.Media.Capture.h>

namespace React = winrt::Microsoft::ReactNative;

namespace winrt::OffhandReactnative {

REACT_MODULE(AudioRecorder)
struct AudioRecorder {
  REACT_INIT(Initialize)
  void Initialize(React::ReactContext const &reactContext) noexcept;

  REACT_METHOD(startRecording)
  void startRecording() noexcept;

  REACT_METHOD(stopRecording)
  void stopRecording() noexcept;

  REACT_METHOD(cancelRecording)
  void cancelRecording() noexcept;

  REACT_METHOD(addListener)
  void addListener(std::string eventName) noexcept;

  REACT_METHOD(removeListeners)
  void removeListeners(double count) noexcept;

 private:
  void startRecordingWorker() noexcept;
  void stopRecordingWorker(bool cancel) noexcept;
  void emitRecordComplete(bool success, std::wstring const &filePath, std::wstring const &error) noexcept;

  React::ReactContext m_context{nullptr};
  std::mutex m_mutex;
  bool m_isRecording{false};
  std::wstring m_outputPath;
  winrt::Windows::Media::Capture::MediaCapture m_capture{nullptr};
  winrt::Windows::Media::Capture::LowLagMediaRecording m_recording{nullptr};
};

} // namespace winrt::OffhandReactnative
