#pragma once

#include "JSValue.h"
#include "NativeModules.h"

#include <array>
#include <commdlg.h>
#include <exception>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <utility>

namespace winrt::OffhandReactnative {

REACT_MODULE(MarkdownFileImporter)
struct MarkdownFileImporter {
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &reactContext) noexcept {
    m_reactContext = reactContext;
  }

  REACT_METHOD(importMarkdownFile)
  void importMarkdownFile(
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    if (m_reactContext) {
      m_reactContext.UIDispatcher().Post([result = std::move(result)]() mutable noexcept {
        importMarkdownFileOnUiThread(std::move(result));
      });
      return;
    }

    importMarkdownFileOnUiThread(std::move(result));
  }

 private:
  static void importMarkdownFileOnUiThread(
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> result) noexcept {
    namespace rn = winrt::Microsoft::ReactNative;

    try {
      std::array<wchar_t, 32768> fileBuffer{};

      OPENFILENAMEW ofn{};
      ofn.lStructSize = sizeof(ofn);
      ofn.hwndOwner = nullptr;
      ofn.lpstrFile = fileBuffer.data();
      ofn.nMaxFile = static_cast<DWORD>(fileBuffer.size());
      ofn.lpstrFilter = L"Markdown Files (*.md;*.markdown)\0*.md;*.markdown\0All Files (*.*)\0*.*\0";
      ofn.nFilterIndex = 1;
      ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
      ofn.lpstrTitle = L"选择 Markdown 语料文件";

      if (!GetOpenFileNameW(&ofn)) {
        DWORD dialogError = CommDlgExtendedError();
        if (dialogError == 0) {
          result.Resolve(rn::JSValue{nullptr});
        } else {
          std::string message = "Failed to open markdown file dialog: " + std::to_string(dialogError);
          result.Reject(message.c_str());
        }
        return;
      }

      std::wstring filePathWide(fileBuffer.data());
      std::filesystem::path filePath(filePathWide);
      std::ifstream input(filePath, std::ios::binary);
      if (!input) {
        result.Reject("Failed to read markdown file.");
        return;
      }

      std::ostringstream contentStream;
      contentStream << input.rdbuf();

      std::string filePathUtf8 = winrt::to_string(winrt::hstring(filePathWide));
      std::string fileNameUtf8 = winrt::to_string(winrt::hstring(filePath.filename().wstring()));
      std::string content = contentStream.str();

      result.Resolve(rn::JSValueObject{
          {"fileName", std::move(fileNameUtf8)},
          {"filePath", std::move(filePathUtf8)},
          {"content", std::move(content)},
      });
    } catch (std::exception const &e) {
      result.Reject(e.what());
    } catch (...) {
      result.Reject("Failed to import markdown file.");
    }
  }

  winrt::Microsoft::ReactNative::ReactContext m_reactContext{nullptr};
};

} // namespace winrt::OffhandReactnative
