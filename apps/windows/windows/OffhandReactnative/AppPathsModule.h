#pragma once

#include "NativeModules.h"

namespace React = winrt::Microsoft::ReactNative;

namespace winrt::OffhandReactnative {

REACT_MODULE(AppPaths)
struct AppPaths {
  REACT_METHOD(getAppDir)
  void getAppDir(React::ReactPromise<std::string> result) noexcept;

  REACT_METHOD(getPaths)
  void getPaths(React::ReactPromise<React::JSValue> result) noexcept;

  REACT_METHOD(getDatabaseOpenOptions)
  void getDatabaseOpenOptions(std::string databaseName, React::ReactPromise<React::JSValue> result) noexcept;
};

} // namespace winrt::OffhandReactnative
