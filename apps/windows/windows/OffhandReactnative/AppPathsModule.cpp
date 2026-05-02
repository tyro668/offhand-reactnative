#include "pch.h"
#include "AppPathsModule.h"

#include "NativeHelpers.h"

namespace winrt::OffhandReactnative {
namespace {

constexpr wchar_t kDefaultDatabaseName[] = L"offhand.db";

std::filesystem::path DatabasePath(std::string const &databaseName) {
  auto safeName = NativeHelpers::SafeFileName(NativeHelpers::Utf8ToWide(databaseName), kDefaultDatabaseName);
  return NativeHelpers::DatabaseDirectory() / safeName;
}

} // namespace

void AppPaths::getAppDir(React::ReactPromise<std::string> result) noexcept {
  result.Resolve(NativeHelpers::ToUtf8Path(NativeHelpers::AppDataDirectory()));
}

void AppPaths::getPaths(React::ReactPromise<React::JSValue> result) noexcept {
  auto appDataDir = NativeHelpers::AppDataDirectory();
  auto logsDir = NativeHelpers::LogsDirectory();
  auto recordingsDir = NativeHelpers::RecordingsDirectory();
  auto databaseDir = NativeHelpers::DatabaseDirectory();
  auto databasePath = DatabasePath("");

  result.Resolve(React::JSValueObject{
      {"appDataDir", NativeHelpers::ToUtf8Path(appDataDir)},
      {"logsDir", NativeHelpers::ToUtf8Path(logsDir)},
      {"logFilePath", NativeHelpers::ToUtf8Path(NativeHelpers::LogFilePath())},
      {"recordingsDir", NativeHelpers::ToUtf8Path(recordingsDir)},
      {"databaseDir", NativeHelpers::ToUtf8Path(databaseDir)},
      {"databasePath", NativeHelpers::ToUtf8Path(databasePath)},
      {"databaseName", NativeHelpers::WideToUtf8(kDefaultDatabaseName)},
      {"databaseLocation", "default"},
  });
}

void AppPaths::getDatabaseOpenOptions(
    std::string databaseName,
    React::ReactPromise<React::JSValue> result) noexcept {
  auto databasePath = DatabasePath(databaseName);
  result.Resolve(React::JSValueObject{
      {"name", NativeHelpers::ToUtf8Path(databasePath)},
      {"location", "default"},
      {"path", NativeHelpers::ToUtf8Path(databasePath)},
  });
}

} // namespace winrt::OffhandReactnative
