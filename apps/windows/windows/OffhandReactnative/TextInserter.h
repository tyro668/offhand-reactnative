#pragma once

#include "NativeModules.h"

#include <string>

namespace React = winrt::Microsoft::ReactNative;

namespace winrt::OffhandReactnative {

REACT_MODULE(TextInserter)
struct TextInserter {
  REACT_METHOD(insertText)
  void insertText(std::string text, React::ReactPromise<bool> result) noexcept;
};

} // namespace winrt::OffhandReactnative
