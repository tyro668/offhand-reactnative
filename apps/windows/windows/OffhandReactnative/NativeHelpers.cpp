#include "pch.h"
#include "NativeHelpers.h"

#include <ShlObj.h>

#include <chrono>
#include <fstream>
#include <iomanip>
#include <mutex>
#include <sstream>

namespace winrt::OffhandReactnative::NativeHelpers {
namespace {

constexpr wchar_t kAppDirectoryName[] = L"Offhand-native";
constexpr wchar_t kLogsDirectoryName[] = L"Logs";
constexpr wchar_t kRecordingsDirectoryName[] = L"Recordings";
constexpr wchar_t kDatabaseDirectoryName[] = L"Database";
constexpr wchar_t kModelsDirectoryName[] = L"models";
constexpr wchar_t kLogFileName[] = L"OffhandReactnative.log";

std::mutex g_logMutex;

std::filesystem::path LocalAppDataRoot() {
  PWSTR rawPath = nullptr;
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, KF_FLAG_CREATE, nullptr, &rawPath)) && rawPath) {
    std::filesystem::path result{rawPath};
    CoTaskMemFree(rawPath);
    return result;
  }

  wchar_t *envValue = nullptr;
  size_t envLen = 0;
  if (_wdupenv_s(&envValue, &envLen, L"LOCALAPPDATA") == 0 && envValue) {
    std::filesystem::path result{envValue};
    free(envValue);
    return result;
  }

  return std::filesystem::temp_directory_path();
}

std::wstring NowForLog() {
  auto now = std::chrono::system_clock::now();
  auto time = std::chrono::system_clock::to_time_t(now);
  std::tm tm{};
  localtime_s(&tm, &time);

  std::wostringstream stream;
  stream << std::put_time(&tm, L"%Y-%m-%d %H:%M:%S");
  return stream.str();
}

} // namespace

std::wstring Utf8ToWide(std::string const &value) {
  if (value.empty()) {
    return L"";
  }
  int length = MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0);
  if (length <= 0) {
    return L"";
  }
  std::wstring result(static_cast<size_t>(length), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), length);
  return result;
}

std::string WideToUtf8(std::wstring const &value) {
  if (value.empty()) {
    return "";
  }
  int length = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  if (length <= 0) {
    return "";
  }
  std::string result(static_cast<size_t>(length), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), length, nullptr, nullptr);
  return result;
}

std::filesystem::path EnsureDirectory(std::filesystem::path const &path) {
  std::error_code ec;
  std::filesystem::create_directories(path, ec);
  return path;
}

std::filesystem::path AppDataDirectory() {
  return EnsureDirectory(LocalAppDataRoot() / kAppDirectoryName);
}

std::filesystem::path LogsDirectory() {
  return EnsureDirectory(AppDataDirectory() / kLogsDirectoryName);
}

std::filesystem::path RecordingsDirectory() {
  return EnsureDirectory(AppDataDirectory() / kRecordingsDirectoryName);
}

std::filesystem::path DatabaseDirectory() {
  return EnsureDirectory(AppDataDirectory() / kDatabaseDirectoryName);
}

std::filesystem::path ModelsDirectory() {
  return EnsureDirectory(AppDataDirectory() / kModelsDirectoryName);
}

std::filesystem::path LogFilePath() {
  auto path = LogsDirectory() / kLogFileName;
  std::error_code ec;
  if (!std::filesystem::exists(path, ec)) {
    std::ofstream createFile(path, std::ios::app);
  }
  return path;
}

std::string ToUtf8Path(std::filesystem::path const &path) {
  return WideToUtf8(path.wstring());
}

std::wstring SafeFileName(std::wstring value, std::wstring const &fallback) {
  if (value.empty()) {
    return fallback;
  }

  auto fileName = std::filesystem::path(value).filename().wstring();
  if (fileName.empty() || fileName == L"." || fileName == L"..") {
    return fallback;
  }
  return fileName;
}

std::wstring TimestampForFileName() {
  auto now = std::chrono::system_clock::now();
  auto time = std::chrono::system_clock::to_time_t(now);
  std::tm tm{};
  localtime_s(&tm, &time);

  std::wostringstream stream;
  stream << std::put_time(&tm, L"%Y%m%d_%H%M%S");
  return stream.str();
}

void AppendLog(std::wstring const &scope, std::wstring const &message) noexcept {
  try {
    std::lock_guard lock(g_logMutex);
    std::wofstream file(LogFilePath(), std::ios::app);
    file << L"[" << scope << L"] " << NowForLog() << L" " << message << L"\n";
  } catch (...) {
  }
}

} // namespace winrt::OffhandReactnative::NativeHelpers
