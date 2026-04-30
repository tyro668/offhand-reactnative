#pragma once

#include "JSValue.h"
#include "NativeModules.h"

#include <shlobj.h>
#include <filesystem>
#include <string>
#include <urlmon.h>
#include <windows.h>

#pragma comment(lib, "urlmon.lib")

namespace winrt::OffhandReactnative {

REACT_MODULE(ModelDownloader)
struct ModelDownloader {
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &reactContext) noexcept {
    m_reactContext = reactContext;
  }

  REACT_METHOD(downloadModelFiles)
  void downloadModelFiles(
      std::string modelKey,
      winrt::Microsoft::ReactNative::JSValueArray &&files,
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    namespace rn = winrt::Microsoft::ReactNative;

    try {
      wchar_t appDataPath[MAX_PATH];
      SHGetFolderPathW(nullptr, CSIDL_APPDATA, nullptr, 0, appDataPath);
      std::filesystem::path modelDir =
          std::filesystem::path(appDataPath) / L"Offhand" / L"models" /
          std::filesystem::path(std::wstring(modelKey.begin(), modelKey.end()));
      std::filesystem::create_directories(modelDir);

      // Check if already downloaded
      bool allExist = true;
      for (auto const &file : files) {
        auto obj = file.AsObject();
        std::string name = obj["name"].AsString();
        std::wstring wname(name.begin(), name.end());
        if (!std::filesystem::exists(modelDir / wname)) {
          allExist = false;
          break;
        }
      }
      if (allExist) {
        result.Resolve(rn::JSValueObject{
            {"path", winrt::to_string(winrt::hstring(modelDir.wstring()))},
            {"status", "already_downloaded"},
        });
        return;
      }

      // Download each file
      for (auto const &file : files) {
        auto obj = file.AsObject();
        std::string name = obj["name"].AsString();
        auto urls = obj["urls"].AsArray();

        bool downloaded = false;
        for (auto const &urlVal : urls) {
          std::string url = urlVal.AsString();
          std::wstring wname(name.begin(), name.end());
          std::wstring wurl(url.begin(), url.end());
          std::filesystem::path destPath = modelDir / wname;

          HRESULT hr = URLDownloadToFileW(nullptr, wurl.c_str(), destPath.c_str(), 0, nullptr);
          if (SUCCEEDED(hr)) {
            downloaded = true;
            break;
          }
        }
        if (!downloaded) {
          // Continue with remaining files anyway
        }
      }

      result.Resolve(rn::JSValueObject{
          {"path", winrt::to_string(winrt::hstring(modelDir.wstring()))},
          {"status", "downloading"},
      });
    } catch (std::exception const &e) {
      result.Reject(e.what());
    }
  }

  REACT_METHOD(cancelDownload)
  void cancelDownload(std::string /*modelKey*/) noexcept {
    // URLDownloadToFile doesn't support cancellation
  }

 private:
  winrt::Microsoft::ReactNative::ReactContext m_reactContext{nullptr};
};

} // namespace winrt::OffhandReactnative
