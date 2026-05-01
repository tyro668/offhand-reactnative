#pragma once

#include "AppPaths.h"
#include "JSValue.h"
#include "NativeModules.h"

#include <urlmon.h>
#include <windows.h>

#include <atomic>
#include <algorithm>
#include <cctype>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#pragma comment(lib, "urlmon.lib")

namespace winrt::OffhandReactnative {

REACT_MODULE(ModelDownloader)
struct ModelDownloader {
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &reactContext) noexcept {
    m_reactContext = reactContext;
  }

  ~ModelDownloader() {
    m_cancelRequested = true;
  }

  REACT_METHOD(downloadModelFiles)
  void downloadModelFiles(
      std::string modelKey,
      winrt::Microsoft::ReactNative::JSValueArray &&files,
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    namespace rn = winrt::Microsoft::ReactNative;
    try {
      auto parsedFiles = parseFiles(files);
      auto targetDir = modelDirectoryForKey(modelKey);
      AppPathHelpers::ensureDirectory(targetDir);
      appendLog("downloadModelFiles called: modelKey=" + modelKey + " files=" + std::to_string(parsedFiles.size()));

      bool runtimeDownload = isSherpaRuntimeKey(modelKey);
      if (runtimeDownload && isSherpaRuntimeReady()) {
        auto current = AppPathHelpers::sherpaRuntimeCurrentDirectory();
        emitComplete(modelKey, true, current, "");
        result.Resolve(rn::JSValueObject{
            {"path", AppPathHelpers::toUtf8(current)},
            {"status", "already_downloaded"},
        });
        return;
      }

      if (!parsedFiles.empty() && allFilesReady(targetDir, parsedFiles)) {
        if (runtimeDownload) {
          std::string installError;
          bool installed = installSherpaRuntimeIfNeeded(targetDir, installError);
          auto path = installed ? AppPathHelpers::sherpaRuntimeCurrentDirectory() : targetDir;
          emitComplete(modelKey, installed, path, installError);
          result.Resolve(rn::JSValueObject{
              {"path", AppPathHelpers::toUtf8(path)},
              {"status", installed ? "already_downloaded" : "failed"},
          });
          return;
        }
        emitComplete(modelKey, true, targetDir, "");
        result.Resolve(rn::JSValueObject{
            {"path", AppPathHelpers::toUtf8(targetDir)},
            {"status", "already_downloaded"},
        });
        return;
      }

      m_cancelRequested = false;
      std::thread([this, modelKey = std::move(modelKey), parsedFiles = std::move(parsedFiles)]() mutable {
        downloadWorker(std::move(modelKey), std::move(parsedFiles));
      }).detach();

      result.Resolve(rn::JSValueObject{
          {"path", AppPathHelpers::toUtf8(targetDir)},
          {"status", "downloading"},
      });
    } catch (std::exception const &e) {
      result.Reject(e.what());
    } catch (...) {
      result.Reject("Failed to start model download.");
    }
  }

  REACT_METHOD(cancelDownload)
  void cancelDownload(std::string modelKey) noexcept {
    appendLog("cancelDownload: " + modelKey);
    m_cancelRequested = true;
  }

  REACT_METHOD(addListener)
  void addListener(std::string) noexcept {}

  REACT_METHOD(removeListeners)
  void removeListeners(double) noexcept {}

 private:
  static constexpr char kSherpaRuntimeSuffix[] = "__sherpaRuntime";

  struct DownloadFile {
    std::string name;
    std::vector<std::string> urls;
  };

  class DownloadCallback final : public IBindStatusCallback {
   public:
    DownloadCallback(
        ModelDownloader *owner,
        std::string modelKey,
        std::string fileName,
        std::atomic_bool *cancelRequested)
        : m_owner(owner),
          m_modelKey(std::move(modelKey)),
          m_fileName(std::move(fileName)),
          m_cancelRequested(cancelRequested) {}

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void **object) override {
      if (!object) return E_POINTER;
      if (iid == IID_IUnknown || iid == IID_IBindStatusCallback) {
        *object = static_cast<IBindStatusCallback *>(this);
        AddRef();
        return S_OK;
      }
      *object = nullptr;
      return E_NOINTERFACE;
    }

    ULONG STDMETHODCALLTYPE AddRef() override {
      return ++m_refCount;
    }

    ULONG STDMETHODCALLTYPE Release() override {
      ULONG count = --m_refCount;
      return count;
    }

    HRESULT STDMETHODCALLTYPE OnStartBinding(DWORD, IBinding *) override {
      return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetPriority(LONG *) override {
      return E_NOTIMPL;
    }
    HRESULT STDMETHODCALLTYPE OnLowResource(DWORD) override {
      return S_OK;
    }
    HRESULT STDMETHODCALLTYPE OnStopBinding(HRESULT, LPCWSTR) override {
      return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetBindInfo(DWORD *flags, BINDINFO *bindInfo) override {
      if (flags) *flags = BINDF_GETNEWESTVERSION | BINDF_NOWRITECACHE;
      if (bindInfo) bindInfo->cbSize = sizeof(BINDINFO);
      return S_OK;
    }
    HRESULT STDMETHODCALLTYPE OnDataAvailable(DWORD, DWORD, FORMATETC *, STGMEDIUM *) override {
      return S_OK;
    }
    HRESULT STDMETHODCALLTYPE OnObjectAvailable(REFIID, IUnknown *) override {
      return S_OK;
    }

    HRESULT STDMETHODCALLTYPE OnProgress(
        ULONG progress,
        ULONG progressMax,
        ULONG,
        LPCWSTR) override {
      if (m_cancelRequested && *m_cancelRequested) {
        return E_ABORT;
      }
      if (!m_owner || progressMax == 0) {
        return S_OK;
      }
      double ratio = static_cast<double>(progress) / static_cast<double>(progressMax);
      if (ratio - m_lastProgress >= 0.05 || ratio >= 1.0) {
        m_lastProgress = ratio;
        m_owner->emitProgress(m_modelKey, m_fileName, ratio, progress, progressMax);
      }
      return S_OK;
    }

   private:
    std::atomic_ulong m_refCount{1};
    ModelDownloader *m_owner = nullptr;
    std::string m_modelKey;
    std::string m_fileName;
    std::atomic_bool *m_cancelRequested = nullptr;
    double m_lastProgress = 0.0;
  };

  static bool isSherpaRuntimeKey(std::string const &modelKey) {
    return modelKey.size() >= std::char_traits<char>::length(kSherpaRuntimeSuffix) &&
           modelKey.compare(modelKey.size() - std::char_traits<char>::length(kSherpaRuntimeSuffix),
                            std::char_traits<char>::length(kSherpaRuntimeSuffix),
                            kSherpaRuntimeSuffix) == 0;
  }

  std::vector<DownloadFile> parseFiles(winrt::Microsoft::ReactNative::JSValueArray const &files) {
    std::vector<DownloadFile> out;
    for (auto const &file : files) {
      auto obj = file.AsObject();
      DownloadFile parsed;
      parsed.name = obj["name"].AsString();
      for (auto const &url : obj["urls"].AsArray()) {
        parsed.urls.push_back(url.AsString());
      }
      out.push_back(std::move(parsed));
    }
    return out;
  }

  std::filesystem::path modelDirectoryForKey(std::string const &modelKey) {
    if (isSherpaRuntimeKey(modelKey)) {
      auto path = AppPathHelpers::sherpaRuntimeRoot() / L"downloads";
      AppPathHelpers::ensureDirectory(path);
      return path;
    }
    auto path = AppPathHelpers::modelsDirectory() / AppPathHelpers::fromUtf8(modelKey);
    AppPathHelpers::ensureDirectory(path);
    return path;
  }

  bool allFilesReady(std::filesystem::path const &dir, std::vector<DownloadFile> const &files) {
    for (auto const &file : files) {
      auto path = dir / AppPathHelpers::fromUtf8(file.name);
      std::error_code ec;
      if (!std::filesystem::exists(path, ec) || std::filesystem::file_size(path, ec) == 0) {
        return false;
      }
      if (endsWithLower(file.name, "tokens.txt") && !looksLikeTokensFile(path)) {
        std::filesystem::remove(path, ec);
        return false;
      }
    }
    return true;
  }

  void downloadWorker(std::string modelKey, std::vector<DownloadFile> files) noexcept {
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    auto dir = modelDirectoryForKey(modelKey);
    bool ok = true;
    std::string error;

    for (auto const &file : files) {
      if (m_cancelRequested) {
        ok = false;
        error = "Download cancelled.";
        break;
      }
      emitProgress(modelKey, file.name, 0.0, 0, 0);
      if (!downloadOneFile(modelKey, dir, file, error)) {
        ok = false;
        break;
      }
    }

    if (ok && isSherpaRuntimeKey(modelKey)) {
      ok = installSherpaRuntimeIfNeeded(dir, error);
      emitComplete(modelKey, ok, ok ? AppPathHelpers::sherpaRuntimeCurrentDirectory() : dir, error);
    } else {
      emitComplete(modelKey, ok, dir, error);
    }
    CoUninitialize();
  }

  bool downloadOneFile(
      std::string const &modelKey,
      std::filesystem::path const &dir,
      DownloadFile const &file,
      std::string &error) noexcept {
    auto dest = dir / AppPathHelpers::fromUtf8(file.name);
    for (auto const &url : file.urls) {
      if (m_cancelRequested) {
        error = "Download cancelled.";
        return false;
      }
      std::error_code ec;
      std::filesystem::remove(dest, ec);
      appendLog("trying URL for " + file.name + ": " + url);
      DownloadCallback callback(this, modelKey, file.name, &m_cancelRequested);
      HRESULT hr = URLDownloadToFileW(
          nullptr,
          AppPathHelpers::fromUtf8(url).c_str(),
          dest.c_str(),
          0,
          &callback);
      if (FAILED(hr)) {
        error = "Failed to download " + file.name + " (HRESULT " + std::to_string(static_cast<unsigned long>(hr)) + ")";
        appendLog(error);
        continue;
      }
      if (!std::filesystem::exists(dest, ec) || std::filesystem::file_size(dest, ec) == 0) {
        error = "Downloaded file is empty: " + file.name;
        continue;
      }
      if (endsWithLower(file.name, "tokens.txt") && !looksLikeTokensFile(dest)) {
        std::filesystem::remove(dest, ec);
        error = "Downloaded tokens file looks corrupt: " + file.name;
        continue;
      }
      emitProgress(modelKey, file.name, 1.0, 1, 1);
      appendLog("saved " + file.name + " to " + AppPathHelpers::toUtf8(dest));
      return true;
    }
    if (error.empty()) {
      error = "Failed to download " + file.name + ": all mirrors unavailable.";
    }
    return false;
  }

  bool installSherpaRuntimeIfNeeded(std::filesystem::path const &downloadDir, std::string &error) noexcept {
    if (isSherpaRuntimeReady()) {
      return true;
    }

    std::filesystem::path archive;
    std::error_code ec;
    for (auto const &entry : std::filesystem::directory_iterator(downloadDir, ec)) {
      if (entry.path().extension() == L".bz2") {
        archive = entry.path();
        break;
      }
    }
    if (archive.empty()) {
      error = "Sherpa runtime archive not found.";
      return false;
    }

    auto root = AppPathHelpers::sherpaRuntimeRoot();
    auto installing = root / L"installing";
    auto current = AppPathHelpers::sherpaRuntimeCurrentDirectory();
    std::filesystem::remove_all(installing, ec);
    AppPathHelpers::ensureDirectory(installing);

    std::wstring command = L"tar.exe -xjf \"" + archive.wstring() + L"\" -C \"" + installing.wstring() + L"\"";
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    std::vector<wchar_t> mutableCommand(command.begin(), command.end());
    mutableCommand.push_back(L'\0');
    BOOL launched = CreateProcessW(
        nullptr,
        mutableCommand.data(),
        nullptr,
        nullptr,
        FALSE,
        CREATE_NO_WINDOW,
        nullptr,
        nullptr,
        &startup,
        &process);
    if (!launched) {
      error = "Failed to launch tar.exe to extract Sherpa runtime.";
      return false;
    }
    WaitForSingleObject(process.hProcess, INFINITE);
    DWORD exitCode = 1;
    GetExitCodeProcess(process.hProcess, &exitCode);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    if (exitCode != 0) {
      error = "Failed to extract Sherpa runtime archive.";
      return false;
    }

    auto runtimeDir = findDirectoryContainingRuntime(installing);
    if (runtimeDir.empty()) {
      error = "Extracted Sherpa runtime archive did not contain required DLLs.";
      return false;
    }

    std::filesystem::remove_all(current, ec);
    std::filesystem::rename(runtimeDir, current, ec);
    if (ec) {
      error = "Failed to install Sherpa runtime: " + ec.message();
      return false;
    }
    std::filesystem::remove_all(installing, ec);
    bool ready = isSherpaRuntimeReady();
    if (!ready) {
      error = "Installed Sherpa runtime is incomplete.";
    } else {
      appendLog("Installed Sherpa runtime to " + AppPathHelpers::toUtf8(current));
    }
    return ready;
  }

  static std::filesystem::path findDirectoryContainingRuntime(std::filesystem::path const &root) {
    std::error_code ec;
    for (auto const &entry : std::filesystem::recursive_directory_iterator(root, ec)) {
      if (!entry.is_regular_file(ec)) {
        continue;
      }
      std::wstring name = entry.path().filename().wstring();
      std::transform(name.begin(), name.end(), name.begin(), ::towlower);
      if (name == L"sherpa-onnx-c-api.dll") {
        auto dllDir = entry.path().parent_path();
        if (runtimeHasDlls(dllDir)) {
          return dllDir;
        }
        auto base = dllDir.parent_path();
        if (!base.empty() && runtimeHasDlls(base)) {
          return base;
        }
      }
    }
    return {};
  }

  static bool runtimeHasDlls(std::filesystem::path const &runtimeDir) {
    return !findRuntimeDll(runtimeDir, L"sherpa-onnx-c-api.dll").empty() &&
           !findRuntimeDll(runtimeDir, L"onnxruntime.dll").empty();
  }

  static std::filesystem::path findRuntimeDll(std::filesystem::path const &runtimeDir, std::wstring const &dllName) {
    std::error_code ec;
    for (auto const &entry : std::filesystem::recursive_directory_iterator(runtimeDir, ec)) {
      if (!entry.is_regular_file(ec)) {
        continue;
      }
      std::wstring name = entry.path().filename().wstring();
      std::transform(name.begin(), name.end(), name.begin(), ::towlower);
      if (name == dllName) {
        return entry.path();
      }
    }
    return {};
  }

  static bool isSherpaRuntimeReady() {
    return runtimeHasDlls(AppPathHelpers::sherpaRuntimeCurrentDirectory());
  }

  static bool looksLikeTokensFile(std::filesystem::path const &path) {
    std::error_code ec;
    auto size = std::filesystem::file_size(path, ec);
    if (ec || size == 0 || size > 50ULL * 1024ULL * 1024ULL) {
      return false;
    }
    std::ifstream in(path, std::ios::binary);
    char buffer[256]{};
    in.read(buffer, sizeof(buffer));
    std::streamsize read = in.gcount();
    if (read <= 0) {
      return false;
    }
    for (std::streamsize i = 0; i < read; ++i) {
      unsigned char c = static_cast<unsigned char>(buffer[i]);
      if (c == 0 || c < 0x09 || (c > 0x0D && c < 0x20)) {
        return false;
      }
    }
    return true;
  }

  static bool endsWithLower(std::string value, std::string const &suffix) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
      return static_cast<char>(std::tolower(c));
    });
    return value.size() >= suffix.size() &&
           value.compare(value.size() - suffix.size(), suffix.size(), suffix) == 0;
  }

  void emitProgress(
      std::string const &modelKey,
      std::string const &fileName,
      double progress,
      unsigned long written,
      unsigned long expected) noexcept {
    if (!m_reactContext) {
      return;
    }
    m_reactContext.EmitJSEvent(
        L"RCTDeviceEventEmitter",
        L"onDownloadProgress",
        winrt::Microsoft::ReactNative::JSValueObject{
            {"modelKey", modelKey},
            {"fileName", fileName},
            {"progress", progress},
            {"totalBytesWritten", static_cast<double>(written)},
            {"totalBytesExpected", static_cast<double>(expected)},
        });
  }

  void emitComplete(
      std::string const &modelKey,
      bool success,
      std::filesystem::path const &path,
      std::string const &error) noexcept {
    if (!m_reactContext) {
      return;
    }
    m_reactContext.EmitJSEvent(
        L"RCTDeviceEventEmitter",
        L"onDownloadComplete",
        winrt::Microsoft::ReactNative::JSValueObject{
            {"modelKey", modelKey},
            {"success", success},
            {"path", AppPathHelpers::toUtf8(path)},
            {"error", error},
        });
  }

  void appendLog(std::string const &message) noexcept {
    AppPathHelpers::appendLog("[MD]", message);
  }

  std::atomic_bool m_cancelRequested{false};
  winrt::Microsoft::ReactNative::ReactContext m_reactContext{nullptr};
};

} // namespace winrt::OffhandReactnative
