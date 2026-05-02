#include "pch.h"
#include "TextInserter.h"

#include "NativeHelpers.h"

#include <chrono>
#include <optional>
#include <thread>

namespace winrt::OffhandReactnative {
namespace {

constexpr wchar_t kScope[] = L"TextInserter";

std::wstring TrimTrailingNewlines(std::wstring value) {
  while (!value.empty() && (value.back() == L'\n' || value.back() == L'\r')) {
    value.pop_back();
  }
  return value;
}

std::optional<std::wstring> ReadClipboardText() {
  if (!OpenClipboard(nullptr)) {
    return std::nullopt;
  }

  std::optional<std::wstring> value;
  HANDLE handle = GetClipboardData(CF_UNICODETEXT);
  if (handle) {
    auto *data = static_cast<wchar_t *>(GlobalLock(handle));
    if (data) {
      value = std::wstring(data);
      GlobalUnlock(handle);
    }
  }
  CloseClipboard();
  return value;
}

bool SetClipboardText(std::wstring const &text) {
  if (!OpenClipboard(nullptr)) {
    return false;
  }

  bool ok = false;
  if (EmptyClipboard()) {
    size_t bytes = (text.size() + 1) * sizeof(wchar_t);
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, bytes);
    if (memory) {
      void *target = GlobalLock(memory);
      if (target) {
        memcpy(target, text.c_str(), bytes);
        GlobalUnlock(memory);
        ok = SetClipboardData(CF_UNICODETEXT, memory) != nullptr;
        if (!ok) {
          GlobalFree(memory);
        }
      } else {
        GlobalFree(memory);
      }
    }
  }

  CloseClipboard();
  return ok;
}

bool SendPasteKeystroke() {
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
  return SendInput(4, inputs, sizeof(INPUT)) == 4;
}

} // namespace

void TextInserter::insertText(std::string text, React::ReactPromise<bool> result) noexcept {
  try {
    std::wstring nextText = TrimTrailingNewlines(NativeHelpers::Utf8ToWide(text));
    if (nextText.empty()) {
      result.Resolve(false);
      return;
    }

    auto previousText = ReadClipboardText();
    if (!SetClipboardText(nextText)) {
      NativeHelpers::AppendLog(kScope, L"Failed to set clipboard text.");
      result.Resolve(false);
      return;
    }

    bool sent = SendPasteKeystroke();
    if (previousText.has_value()) {
      std::thread([previous = std::move(previousText.value())]() {
        std::this_thread::sleep_for(std::chrono::milliseconds(1000));
        SetClipboardText(previous);
      }).detach();
    }

    NativeHelpers::AppendLog(kScope, sent ? L"Paste keystroke sent." : L"SendInput failed; text remains on clipboard.");
    result.Resolve(sent);
  } catch (...) {
    NativeHelpers::AppendLog(kScope, L"insertText failed with unknown error.");
    result.Resolve(false);
  }
}

} // namespace winrt::OffhandReactnative
