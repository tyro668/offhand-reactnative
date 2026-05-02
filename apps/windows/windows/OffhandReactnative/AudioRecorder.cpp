#include "pch.h"
#include "AudioRecorder.h"

#include "NativeHelpers.h"

#include <winrt/Windows.Media.MediaProperties.h>
#include <winrt/Windows.Storage.h>

#include <filesystem>
#include <thread>

namespace winrt::OffhandReactnative {
namespace {

constexpr wchar_t kScope[] = L"AudioRecorder";

std::wstring ErrorMessage(std::exception const &e) {
  return NativeHelpers::Utf8ToWide(e.what());
}

} // namespace

void AudioRecorder::Initialize(React::ReactContext const &reactContext) noexcept {
  m_context = reactContext;
}

void AudioRecorder::startRecording() noexcept {
  std::thread([this]() noexcept { startRecordingWorker(); }).detach();
}

void AudioRecorder::stopRecording() noexcept {
  std::thread([this]() noexcept { stopRecordingWorker(false); }).detach();
}

void AudioRecorder::cancelRecording() noexcept {
  std::thread([this]() noexcept { stopRecordingWorker(true); }).detach();
}

void AudioRecorder::addListener(std::string /*eventName*/) noexcept {}

void AudioRecorder::removeListeners(double /*count*/) noexcept {}

void AudioRecorder::startRecordingWorker() noexcept {
  try {
    winrt::init_apartment(winrt::apartment_type::multi_threaded);

    {
      std::lock_guard lock(m_mutex);
      if (m_isRecording) {
        NativeHelpers::AppendLog(kScope, L"startRecording ignored; already recording.");
        return;
      }
      m_isRecording = true;
    }

    auto recordingsDir = NativeHelpers::RecordingsDirectory();
    std::wstring fileName = L"recording_" + NativeHelpers::TimestampForFileName() + L".wav";
    auto outputPath = recordingsDir / fileName;
    {
      std::lock_guard lock(m_mutex);
      m_outputPath = outputPath.wstring();
    }

    using namespace winrt::Windows::Media::Capture;
    using namespace winrt::Windows::Media::MediaProperties;
    using namespace winrt::Windows::Storage;

    MediaCaptureInitializationSettings settings;
    settings.StreamingCaptureMode(StreamingCaptureMode::Audio);

    MediaCapture capture;
    capture.InitializeAsync(settings).get();

    StorageFolder folder = StorageFolder::GetFolderFromPathAsync(recordingsDir.wstring()).get();
    StorageFile file = folder.CreateFileAsync(fileName, CreationCollisionOption::ReplaceExisting).get();

    auto profile = MediaEncodingProfile::CreateWav(AudioEncodingQuality::High);
    auto audio = profile.Audio();
    audio.Subtype(MediaEncodingSubtypes::Pcm());
    audio.SampleRate(16000);
    audio.ChannelCount(1);
    audio.BitsPerSample(16);
    audio.Bitrate(256000);

    auto recording = capture.PrepareLowLagRecordToStorageFileAsync(profile, file).get();
    recording.StartAsync().get();

    {
      std::lock_guard lock(m_mutex);
      m_capture = capture;
      m_recording = recording;
      m_outputPath = outputPath.wstring();
    }

    NativeHelpers::AppendLog(kScope, L"Recording started: " + outputPath.wstring());
  } catch (std::exception const &e) {
    std::wstring path;
    {
      std::lock_guard lock(m_mutex);
      path = m_outputPath;
      m_isRecording = false;
      m_recording = nullptr;
      m_capture = nullptr;
    }
    auto message = ErrorMessage(e);
    NativeHelpers::AppendLog(kScope, L"startRecording failed: " + message);
    emitRecordComplete(false, path, message);
  } catch (...) {
    std::wstring path;
    {
      std::lock_guard lock(m_mutex);
      path = m_outputPath;
      m_isRecording = false;
      m_recording = nullptr;
      m_capture = nullptr;
    }
    NativeHelpers::AppendLog(kScope, L"startRecording failed with unknown error.");
    emitRecordComplete(false, path, L"Failed to start microphone recording.");
  }
}

void AudioRecorder::stopRecordingWorker(bool cancel) noexcept {
  winrt::Windows::Media::Capture::LowLagMediaRecording recording{nullptr};
  std::wstring path;

  {
    std::lock_guard lock(m_mutex);
    if (!m_isRecording) {
      NativeHelpers::AppendLog(kScope, L"stopRecording ignored; recorder is not active.");
      return;
    }
    recording = m_recording;
    path = m_outputPath;
  }

  bool success = false;
  std::wstring error;
  try {
    winrt::init_apartment(winrt::apartment_type::multi_threaded);
    if (recording) {
      recording.StopAsync().get();
      recording.FinishAsync().get();
    }

    if (cancel && !path.empty()) {
      std::error_code ec;
      std::filesystem::remove(std::filesystem::path(path), ec);
    }

    success = !cancel && !path.empty() && std::filesystem::exists(std::filesystem::path(path));
    if (!success && !cancel) {
      error = L"Recording did not produce a WAV file.";
    }
  } catch (std::exception const &e) {
    error = ErrorMessage(e);
  } catch (...) {
    error = L"Failed to stop microphone recording.";
  }

  {
    std::lock_guard lock(m_mutex);
    m_isRecording = false;
    m_recording = nullptr;
    m_capture = nullptr;
    m_outputPath.clear();
  }

  NativeHelpers::AppendLog(kScope, success ? L"Recording stopped: " + path : L"Recording failed: " + error);
  if (!cancel) {
    emitRecordComplete(success, path, error);
  }
}

void AudioRecorder::emitRecordComplete(
    bool success,
    std::wstring const &filePath,
    std::wstring const &error) noexcept {
  if (!m_context) {
    return;
  }

  m_context.EmitJSEvent(
      L"RCTDeviceEventEmitter",
      L"onRecordComplete",
      React::JSValueObject{
          {"success", success},
          {"filePath", NativeHelpers::WideToUtf8(filePath)},
          {"error", NativeHelpers::WideToUtf8(error)},
      });
}

} // namespace winrt::OffhandReactnative
