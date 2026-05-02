#pragma once

#include <filesystem>
#include <string>

namespace winrt::OffhandReactnative::NativeHelpers {

std::wstring Utf8ToWide(std::string const &value);
std::string WideToUtf8(std::wstring const &value);

std::filesystem::path AppDataDirectory();
std::filesystem::path LogsDirectory();
std::filesystem::path RecordingsDirectory();
std::filesystem::path DatabaseDirectory();
std::filesystem::path ModelsDirectory();
std::filesystem::path LogFilePath();

std::filesystem::path EnsureDirectory(std::filesystem::path const &path);
std::string ToUtf8Path(std::filesystem::path const &path);
std::wstring SafeFileName(std::wstring value, std::wstring const &fallback);
std::wstring TimestampForFileName();

void AppendLog(std::wstring const &scope, std::wstring const &message) noexcept;

} // namespace winrt::OffhandReactnative::NativeHelpers
