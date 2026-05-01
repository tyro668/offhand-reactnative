#pragma once

#include "JSValue.h"
#include "NativeModules.h"

#include <shlobj.h>
#include <windows.h>

#include <chrono>
#include <filesystem>
#include <fstream>
#include <malloc.h>
#include <mutex>
#include <sstream>
#include <string>

namespace winrt::OffhandReactnative::AppPathHelpers {

inline constexpr wchar_t kAppDirectoryName[] = L"Offhand-native";
inline constexpr wchar_t kLegacyAppDirectoryName[] = L"Offhand";
inline constexpr wchar_t kLogsDirectoryName[] = L"Logs";
inline constexpr wchar_t kRecordingsDirectoryName[] = L"Recordings";
inline constexpr wchar_t kDatabaseDirectoryName[] = L"Database";
inline constexpr wchar_t kLogFileName[] = L"OffhandReactnative.log";

inline std::filesystem::path roamingAppDataDirectory() {
  PWSTR knownPath = nullptr;
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_RoamingAppData, 0, nullptr, &knownPath)) &&
      knownPath != nullptr) {
    std::filesystem::path path(knownPath);
    CoTaskMemFree(knownPath);
    return path;
  }

  wchar_t appData[MAX_PATH]{};
  if (SUCCEEDED(SHGetFolderPathW(nullptr, CSIDL_APPDATA, nullptr, 0, appData))) {
    return std::filesystem::path(appData);
  }

  wchar_t current[MAX_PATH]{};
  GetCurrentDirectoryW(MAX_PATH, current);
  return std::filesystem::path(current);
}

inline void ensureDirectory(std::filesystem::path const &path) {
  std::error_code ec;
  std::filesystem::create_directories(path, ec);
}

inline void copyDirectoryIfNeeded(std::filesystem::path const &source, std::filesystem::path const &target) {
  std::error_code ec;
  if (!std::filesystem::exists(source, ec) || std::filesystem::exists(target, ec)) {
    return;
  }
  ensureDirectory(target.parent_path());
  std::filesystem::copy(
      source,
      target,
      std::filesystem::copy_options::recursive | std::filesystem::copy_options::skip_existing,
      ec);
}

inline std::filesystem::path appDataDirectory() {
  auto root = roamingAppDataDirectory();
  auto target = root / kAppDirectoryName;
  copyDirectoryIfNeeded(root / kLegacyAppDirectoryName, target);
  ensureDirectory(target);
  return target;
}

inline std::filesystem::path logsDirectory() {
  auto path = appDataDirectory() / kLogsDirectoryName;
  ensureDirectory(path);
  return path;
}

inline std::filesystem::path recordingsDirectory() {
  auto path = appDataDirectory() / kRecordingsDirectoryName;
  ensureDirectory(path);
  return path;
}

inline std::filesystem::path databaseDirectory() {
  auto path = appDataDirectory() / kDatabaseDirectoryName;
  ensureDirectory(path);
  return path;
}

inline std::filesystem::path modelsDirectory() {
  auto path = appDataDirectory() / L"models";
  ensureDirectory(path);
  return path;
}

inline std::filesystem::path sherpaRuntimeRoot() {
  auto path = appDataDirectory() / L"sherpa-onnx" / L"runtime";
  ensureDirectory(path);
  return path;
}

inline std::filesystem::path sherpaRuntimeCurrentDirectory() {
  auto path = sherpaRuntimeRoot() / L"current";
  ensureDirectory(path);
  return path;
}

inline std::filesystem::path logFilePath() {
  auto path = logsDirectory() / kLogFileName;
  if (!std::filesystem::exists(path)) {
    std::ofstream create(path, std::ios::binary | std::ios::app);
  }
  return path;
}

inline std::string toUtf8(std::filesystem::path const &path) {
  return winrt::to_string(winrt::hstring(path.wstring()));
}

inline std::wstring fromUtf8(std::string const &value) {
  winrt::hstring text = winrt::to_hstring(value);
  return std::wstring(text.c_str(), text.size());
}

inline std::mutex &logMutex() {
  static std::mutex mutex;
  return mutex;
}

inline void appendLog(std::string const &tag, std::string const &message) {
  std::lock_guard<std::mutex> lock(logMutex());
  try {
    std::ofstream out(logFilePath(), std::ios::binary | std::ios::app);
    if (!out) {
      return;
    }
    out << tag << " " << message << "\r\n";
  } catch (...) {
  }
}

inline void trimWorkingSet() {
  _heapmin();
  SetProcessWorkingSetSize(GetCurrentProcess(), static_cast<SIZE_T>(-1), static_cast<SIZE_T>(-1));
}

} // namespace winrt::OffhandReactnative::AppPathHelpers

namespace winrt::OffhandReactnative {

REACT_MODULE(AppPaths)
struct AppPaths {
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &reactContext) noexcept {
    m_reactContext = reactContext;
  }

  REACT_METHOD(getAppDir)
  void getAppDir(
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    try {
      result.Resolve(AppPathHelpers::toUtf8(AppPathHelpers::appDataDirectory()));
    } catch (...) {
      result.Resolve("");
    }
  }

 private:
  winrt::Microsoft::ReactNative::ReactContext m_reactContext{nullptr};
};

} // namespace winrt::OffhandReactnative
