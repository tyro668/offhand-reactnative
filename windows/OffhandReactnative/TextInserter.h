#pragma once

#include "AppPaths.h"
#include "JSValue.h"
#include "NativeModules.h"

#include <windows.h>

#include <chrono>
#include <string>
#include <thread>
#include <utility>
#include <vector>

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
  struct ClipboardItem {
    UINT format = 0;
    std::vector<BYTE> bytes;
  };

  static void insertTextOnUiThread(
      std::string text,
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> result) noexcept {
    while (!text.empty() && (text.back() == '\n' || text.back() == '\r')) {
      text.pop_back();
    }
    if (text.empty()) {
      result.Resolve(false);
      return;
    }

    std::wstring wtext = AppPathHelpers::fromUtf8(text);
    std::vector<ClipboardItem> oldClipboard;
    if (!writeClipboardText(wtext, oldClipboard)) {
      result.Reject("Failed to write temporary text to the clipboard.");
      return;
    }

    Sleep(80);
    sendPasteShortcut();

    std::thread([oldClipboard = std::move(oldClipboard)]() mutable {
      std::this_thread::sleep_for(std::chrono::milliseconds(1000));
      restoreClipboard(oldClipboard);
      oldClipboard.clear();
      AppPathHelpers::trimWorkingSet();
    }).detach();

    result.Resolve(true);
  }

  static std::vector<ClipboardItem> snapshotClipboard() noexcept {
    std::vector<ClipboardItem> snapshot;
    UINT format = 0;
    while ((format = EnumClipboardFormats(format)) != 0) {
      HANDLE handle = GetClipboardData(format);
      if (!handle) {
        continue;
      }
      SIZE_T size = GlobalSize(handle);
      if (size == 0) {
        continue;
      }
      void *locked = GlobalLock(handle);
      if (!locked) {
        continue;
      }
      ClipboardItem item;
      item.format = format;
      item.bytes.resize(size);
      memcpy(item.bytes.data(), locked, size);
      GlobalUnlock(handle);
      snapshot.emplace_back(std::move(item));
    }
    return snapshot;
  }

  static bool writeClipboardText(
      std::wstring const &text,
      std::vector<ClipboardItem> &oldClipboard) noexcept {
    if (!OpenClipboard(nullptr)) {
      return false;
    }

    oldClipboard = snapshotClipboard();
    EmptyClipboard();

    SIZE_T bytes = (text.size() + 1) * sizeof(wchar_t);
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, bytes);
    if (!memory) {
      CloseClipboard();
      return false;
    }
    void *locked = GlobalLock(memory);
    if (!locked) {
      GlobalFree(memory);
      CloseClipboard();
      return false;
    }
    memcpy(locked, text.c_str(), bytes);
    GlobalUnlock(memory);

    if (!SetClipboardData(CF_UNICODETEXT, memory)) {
      GlobalFree(memory);
      CloseClipboard();
      return false;
    }
    CloseClipboard();
    return true;
  }

  static void restoreClipboard(std::vector<ClipboardItem> const &items) noexcept {
    if (items.empty() || !OpenClipboard(nullptr)) {
      return;
    }

    EmptyClipboard();
    for (auto const &item : items) {
      if (item.format == 0 || item.bytes.empty()) {
        continue;
      }
      HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, item.bytes.size());
      if (!memory) {
        continue;
      }
      void *locked = GlobalLock(memory);
      if (!locked) {
        GlobalFree(memory);
        continue;
      }
      memcpy(locked, item.bytes.data(), item.bytes.size());
      GlobalUnlock(memory);
      if (!SetClipboardData(item.format, memory)) {
        GlobalFree(memory);
      }
    }
    CloseClipboard();
  }

  static void sendPasteShortcut() noexcept {
    INPUT inputs[4]{};
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
  }

  winrt::Microsoft::ReactNative::ReactContext m_reactContext{nullptr};
};

} // namespace winrt::OffhandReactnative
