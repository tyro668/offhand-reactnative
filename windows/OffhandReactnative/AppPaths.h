#pragma once

#include "JSValue.h"
#include "NativeModules.h"

#include <shlobj.h>
#include <filesystem>
#include <string>
#include <windows.h>

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
      wchar_t path[MAX_PATH];
      if (SUCCEEDED(SHGetFolderPathW(nullptr, CSIDL_APPDATA, nullptr, 0, path))) {
        std::filesystem::path appDir = std::filesystem::path(path) / L"Offhand";
        std::filesystem::create_directories(appDir);
        result.Resolve(winrt::to_string(winrt::hstring(appDir.wstring())));
        return;
      }
      result.Resolve("");
    } catch (...) {
      result.Resolve("");
    }
  }

 private:
  winrt::Microsoft::ReactNative::ReactContext m_reactContext{nullptr};
};

} // namespace winrt::OffhandReactnative
