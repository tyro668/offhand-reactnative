#pragma once

#include "JSValue.h"
#include "NativeModules.h"

#include <windows.h>
#include <string>

namespace winrt::OffhandReactnative {

REACT_MODULE(TextInserter)
struct TextInserter {
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &reactContext) noexcept {
    m_reactContext = reactContext;
  }

  REACT_METHOD(insertText, L"insertText")
  void insertText(
      std::string text,
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    namespace rn = winrt::Microsoft::ReactNative;

    if (m_reactContext) {
      m_reactContext.UIDispatcher().Post(
          [text = std::move(text), result = std::move(result)]() mutable noexcept {
            insertTextOnUiThread(std::move(text), std::move(result));
          });
      return;
    }
    insertTextOnUiThread(std::move(text), std::move(result));
  }

 private:
  static void insertTextOnUiThread(
      std::string text,
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> result) noexcept {
    namespace rn = winrt::Microsoft::ReactNative;

    // Strip trailing newlines
    while (!text.empty() && (text.back() == '\n' || text.back() == '\r')) {
      text.pop_back();
    }
    if (text.empty()) {
      result.Resolve(false);
      return;
    }

    // Copy to clipboard
    std::wstring wtext(text.begin(), text.end());
    if (!OpenClipboard(nullptr)) {
      result.Reject("Failed to open clipboard");
      return;
    }
    EmptyClipboard();
    HGLOBAL hMem = GlobalAlloc(GMEM_MOVEABLE, (wtext.size() + 1) * sizeof(wchar_t));
    if (hMem) {
      wchar_t *pMem = static_cast<wchar_t *>(GlobalLock(hMem));
      wcscpy_s(pMem, wtext.size() + 1, wtext.c_str());
      GlobalUnlock(hMem);
      SetClipboardData(CF_UNICODETEXT, hMem);
    }
    CloseClipboard();

    // Send Ctrl+V
    INPUT inputs[4] = {};
    inputs[0].type = INPUT_KEYBOARD;
    inputs[0].ki.wVk = VK_CONTROL;
    inputs[1].type = INPUT_KEYBOARD;
    inputs[1].ki.wVk = 'V';
    inputs[2].type = INPUT_KEYBOARD;
    inputs[2].ki.wVk = 'V';
    inputs[2].ki.dwFlags = KEYEVENTF_KEYUP;
    inputs[3].type = INPUT_KEYBOARD;
    inputs[3].ki.wVk = VK_CONTROL;
    inputs[3].ki.dwFlags = KEYEVENTF_KEYUP;
    SendInput(4, inputs, sizeof(INPUT));

    result.Resolve(true);
  }

  winrt::Microsoft::ReactNative::ReactContext m_reactContext{nullptr};
};

} // namespace winrt::OffhandReactnative
