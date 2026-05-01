#pragma once

#include "AppPaths.h"
#include "JSValue.h"
#include "NativeModules.h"

#include <shellapi.h>
#include <windows.h>

#include <algorithm>
#include <cmath>
#include <string>
#include <utility>

namespace winrt::OffhandReactnative {

REACT_MODULE(OverlayManager)
struct OverlayManager {
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &reactContext) noexcept {
    m_reactContext = reactContext;
    s_instance = this;
    appendNativeLog("native module initialized.");
  }

  ~OverlayManager() {
    stopMonitoringOnUiThread();
    if (s_instance == this) {
      s_instance = nullptr;
    }
  }

  REACT_METHOD(startMonitoring)
  void startMonitoring() noexcept {
    postToUi([this]() noexcept { startMonitoringOnUiThread(); });
  }

  REACT_METHOD(stopMonitoring)
  void stopMonitoring() noexcept {
    postToUi([this]() noexcept { stopMonitoringOnUiThread(); });
  }

  REACT_METHOD(toggleRecording)
  void toggleRecording() noexcept {
    postToUi([this]() noexcept { toggleRecordingOnUiThread("RN toggleRecording"); });
  }

  REACT_METHOD(setOverlayState)
  void setOverlayState(winrt::Microsoft::ReactNative::JSValueObject payload) noexcept {
    postToUi([this, payload = std::move(payload)]() mutable noexcept {
      std::string state = stringValue(payload, "state", "recording");
      std::string label = stringValue(payload, "stateLabel", "");
      std::string duration = stringValue(payload, "duration", "");
      double level = numberValue(payload, "level", m_level);

      if (state == "hidden") {
        hideOverlay();
        return;
      }

      m_state = state;
      m_stateLabel = label;
      if (!duration.empty()) {
        m_duration = AppPathHelpers::fromUtf8(duration);
      }
      m_level = std::clamp(level, 0.0, 1.0);
      ensureOverlayWindow();
      if (!IsWindowVisible(m_overlayWindow)) {
        showOverlay();
      }
      if (m_state == "recording" && m_recordingStartedAt == 0) {
        m_recordingStartedAt = GetTickCount64();
      }
      InvalidateRect(m_overlayWindow, nullptr, FALSE);
    });
  }

  REACT_METHOD(appendLog)
  void appendLog(std::string message) noexcept {
    appendNativeLog("[JS] " + message);
  }

  REACT_METHOD(getLogFilePath)
  void getLogFilePath(
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    result.Resolve(AppPathHelpers::toUtf8(AppPathHelpers::logFilePath()));
  }

  REACT_METHOD(openLogFolder)
  void openLogFolder(
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    auto dir = AppPathHelpers::logsDirectory();
    ShellExecuteW(nullptr, L"open", dir.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    appendNativeLog("opened log folder from settings.");
    result.Resolve(true);
  }

  REACT_METHOD(checkPermissions)
  void checkPermissions(
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    namespace rn = winrt::Microsoft::ReactNative;
    result.Resolve(rn::JSValueObject{
        {"accessibility", true},
        {"inputMonitoring", m_keyboardHook != nullptr},
        {"microphone", true},
        {"microphoneStatus", "authorized"},
    });
  }

  REACT_METHOD(requestAccessibilityPermission)
  void requestAccessibilityPermission(
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    result.Resolve(true);
  }

  REACT_METHOD(requestInputMonitoringPermission)
  void requestInputMonitoringPermission(
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    postToUi([this]() noexcept { startMonitoringOnUiThread(); });
    result.Resolve(true);
  }

  REACT_METHOD(requestMicrophonePermission)
  void requestMicrophonePermission(
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    result.Resolve(true);
  }

  REACT_METHOD(addListener)
  void addListener(std::string) noexcept {}

  REACT_METHOD(removeListeners)
  void removeListeners(double) noexcept {}

 private:
  static inline OverlayManager *s_instance = nullptr;
  static constexpr int kPanelWidth = 280;
  static constexpr int kPanelHeight = 56;
  static constexpr int kBarCount = 6;
  static constexpr UINT_PTR kOverlayTimer = 1001;

  template <typename Fn>
  void postToUi(Fn &&fn) noexcept {
    if (m_reactContext) {
      m_reactContext.UIDispatcher().Post(std::forward<Fn>(fn));
    } else {
      fn();
    }
  }

  void startMonitoringOnUiThread() noexcept {
    if (!m_keyboardHook) {
      m_keyboardHook =
          SetWindowsHookExW(WH_KEYBOARD_LL, &OverlayManager::keyboardHookProc, GetModuleHandleW(nullptr), 0);
      appendNativeLog(m_keyboardHook ? "keyboard monitor started." : "failed to start keyboard monitor.");
    }
  }

  void stopMonitoringOnUiThread() noexcept {
    if (m_keyboardHook) {
      UnhookWindowsHookEx(m_keyboardHook);
      m_keyboardHook = nullptr;
    }
    hideOverlay();
    setRecording(false, "stopMonitoring");
  }

  void toggleRecordingOnUiThread(std::string const &reason) noexcept {
    setRecording(!m_isRecording, reason);
  }

  void setRecording(bool recording, std::string const &reason) noexcept {
    if (m_isRecording == recording) {
      return;
    }
    m_isRecording = recording;
    appendNativeLog(std::string("recording ") + (recording ? "started" : "stopped") + "; reason=" + reason);

    if (recording) {
      m_state = "recording";
      m_stateLabel.clear();
      m_duration = L"00:00";
      m_recordingStartedAt = GetTickCount64();
      m_level = 0.3;
      showOverlay();
    } else {
      m_recordingStartedAt = 0;
      hideOverlay();
    }
    emitRecordingState();
  }

  void emitRecordingState() noexcept {
    if (!m_reactContext) {
      return;
    }
    m_reactContext.EmitJSEvent(
        L"RCTDeviceEventEmitter",
        L"onRecordingStateChange",
        winrt::Microsoft::ReactNative::JSValueObject{{"isRecording", m_isRecording}});
  }

  static LRESULT CALLBACK keyboardHookProc(int code, WPARAM wParam, LPARAM lParam) {
    if (code == HC_ACTION && s_instance) {
      auto *event = reinterpret_cast<KBDLLHOOKSTRUCT *>(lParam);
      bool keyUp = wParam == WM_KEYUP || wParam == WM_SYSKEYUP;
      if (keyUp && (event->vkCode == VK_F8 || event->vkCode == VK_F24)) {
        s_instance->toggleRecordingOnUiThread("keyboard shortcut");
        return 1;
      }
    }
    return CallNextHookEx(nullptr, code, wParam, lParam);
  }

  void ensureOverlayWindow() noexcept {
    if (m_overlayWindow && IsWindow(m_overlayWindow)) {
      return;
    }

    static bool registered = false;
    if (!registered) {
      WNDCLASSEXW wc{};
      wc.cbSize = sizeof(wc);
      wc.lpfnWndProc = &OverlayManager::overlayWndProc;
      wc.hInstance = GetModuleHandleW(nullptr);
      wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
      wc.lpszClassName = L"OffhandRecordingOverlay";
      wc.hbrBackground = nullptr;
      RegisterClassExW(&wc);
      registered = true;
    }

    m_overlayWindow = CreateWindowExW(
        WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT,
        L"OffhandRecordingOverlay",
        L"",
        WS_POPUP,
        0,
        0,
        kPanelWidth,
        kPanelHeight,
        nullptr,
        nullptr,
        GetModuleHandleW(nullptr),
        this);

    if (m_overlayWindow) {
      HRGN region = CreateRoundRectRgn(0, 0, kPanelWidth + 1, kPanelHeight + 1, kPanelHeight, kPanelHeight);
      SetWindowRgn(m_overlayWindow, region, TRUE);
    }
  }

  void showOverlay() noexcept {
    ensureOverlayWindow();
    if (!m_overlayWindow) {
      return;
    }
    positionOverlay();
    ShowWindow(m_overlayWindow, SW_SHOWNOACTIVATE);
    SetWindowPos(
        m_overlayWindow,
        HWND_TOPMOST,
        0,
        0,
        0,
        0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    SetTimer(m_overlayWindow, kOverlayTimer, 80, nullptr);
    InvalidateRect(m_overlayWindow, nullptr, FALSE);
    appendNativeLog("showing recording overlay.");
  }

  void hideOverlay() noexcept {
    if (!m_overlayWindow) {
      return;
    }
    KillTimer(m_overlayWindow, kOverlayTimer);
    ShowWindow(m_overlayWindow, SW_HIDE);
    appendNativeLog("hiding recording overlay.");
  }

  void positionOverlay() noexcept {
    RECT workArea{};
    SystemParametersInfoW(SPI_GETWORKAREA, 0, &workArea, 0);
    int workWidth = workArea.right - workArea.left;
    int workHeight = workArea.bottom - workArea.top;
    int x = workArea.left + (workWidth - kPanelWidth) / 2;
    int y = workArea.bottom - static_cast<int>(workHeight * 0.08) - kPanelHeight;
    SetWindowPos(m_overlayWindow, HWND_TOPMOST, x, y, kPanelWidth, kPanelHeight, SWP_NOACTIVATE);
  }

  static LRESULT CALLBACK overlayWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    OverlayManager *self = reinterpret_cast<OverlayManager *>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
      auto *cs = reinterpret_cast<CREATESTRUCTW *>(lParam);
      self = reinterpret_cast<OverlayManager *>(cs->lpCreateParams);
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
    }

    switch (message) {
      case WM_TIMER:
        if (self) {
          self->tickOverlay();
        }
        return 0;
      case WM_PAINT:
        if (self) {
          self->paintOverlay(hwnd);
          return 0;
        }
        break;
      case WM_ERASEBKGND:
        return 1;
      default:
        break;
    }
    return DefWindowProcW(hwnd, message, wParam, lParam);
  }

  void tickOverlay() noexcept {
    if (m_state == "recording" && m_recordingStartedAt > 0) {
      auto elapsed = static_cast<int>((GetTickCount64() - m_recordingStartedAt) / 1000);
      wchar_t buffer[16]{};
      swprintf_s(buffer, L"%02d:%02d", elapsed / 60, elapsed % 60);
      m_duration = buffer;
      double phase = static_cast<double>(GetTickCount64() % 1200) / 1200.0;
      m_level = std::clamp(0.18 + 0.62 * std::abs(std::sin(phase * 3.141592653589793 * 2.0)), 0.0, 1.0);
    }
    if (m_overlayWindow) {
      InvalidateRect(m_overlayWindow, nullptr, FALSE);
    }
  }

  void paintOverlay(HWND hwnd) noexcept {
    PAINTSTRUCT ps{};
    HDC hdc = BeginPaint(hwnd, &ps);
    RECT rect{0, 0, kPanelWidth, kPanelHeight};

    HBRUSH bg = CreateSolidBrush(RGB(20, 20, 31));
    HPEN noPen = CreatePen(PS_NULL, 0, RGB(0, 0, 0));
    auto oldPen = SelectObject(hdc, noPen);
    auto oldBrush = SelectObject(hdc, bg);
    RoundRect(hdc, rect.left, rect.top, rect.right, rect.bottom, kPanelHeight, kPanelHeight);
    SelectObject(hdc, oldBrush);
    SelectObject(hdc, oldPen);
    DeleteObject(bg);
    DeleteObject(noPen);

    drawDot(hdc);
    drawText(hdc);
    if (m_state == "recording") {
      drawBars(hdc);
    } else if (m_state == "transcribing" || m_state == "enhancing") {
      drawWave(hdc);
    }

    EndPaint(hwnd, &ps);
  }

  void drawDot(HDC hdc) noexcept {
    COLORREF color = RGB(239, 68, 91);
    if (m_state == "starting") color = RGB(245, 184, 64);
    if (m_state == "transcribing") color = RGB(107, 99, 255);
    if (m_state == "enhancing") color = RGB(79, 199, 158);

    HBRUSH brush = CreateSolidBrush(color);
    auto oldBrush = SelectObject(hdc, brush);
    auto oldPen = SelectObject(hdc, GetStockObject(NULL_PEN));
    Ellipse(hdc, 20, 23, 30, 33);
    SelectObject(hdc, oldPen);
    SelectObject(hdc, oldBrush);
    DeleteObject(brush);
  }

  void drawText(HDC hdc) noexcept {
    SetBkMode(hdc, TRANSPARENT);
    HFONT durationFont = CreateFontW(
        17, 0, 0, 0, FW_MEDIUM, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS,
        CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Consolas");
    HFONT labelFont = CreateFontW(
        15, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS,
        CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Segoe UI");

    int labelX = 46;
    if (m_state == "recording") {
      SetTextColor(hdc, RGB(255, 255, 255));
      auto oldFont = SelectObject(hdc, durationFont);
      RECT durationRect{40, 17, 96, 40};
      DrawTextW(hdc, m_duration.c_str(), -1, &durationRect, DT_LEFT | DT_VCENTER | DT_SINGLELINE);
      SelectObject(hdc, oldFont);
      labelX = 152;
    }

    std::wstring status = statusText();
    SetTextColor(hdc, RGB(184, 188, 198));
    auto oldFont = SelectObject(hdc, labelFont);
    RECT labelRect{labelX, 18, kPanelWidth - 20, 40};
    DrawTextW(hdc, status.c_str(), -1, &labelRect, DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS);
    SelectObject(hdc, oldFont);

    DeleteObject(durationFont);
    DeleteObject(labelFont);
  }

  void drawBars(HDC hdc) noexcept {
    HBRUSH brush = CreateSolidBrush(RGB(235, 238, 245));
    auto oldBrush = SelectObject(hdc, brush);
    auto oldPen = SelectObject(hdc, GetStockObject(NULL_PEN));
    int startX = 98;
    for (int i = 0; i < kBarCount; ++i) {
      double phase = static_cast<double>(i) / std::max(1, kBarCount - 1);
      double shaped = m_level * (0.6 + 0.4 * (1.0 - std::abs(phase - 0.5) * 2.0));
      int height = static_cast<int>(4 + (18 - 4) * shaped);
      int y = (kPanelHeight - height) / 2;
      RoundRect(hdc, startX + i * 7, y, startX + i * 7 + 4, y + height, 4, 4);
    }
    SelectObject(hdc, oldPen);
    SelectObject(hdc, oldBrush);
    DeleteObject(brush);
  }

  void drawWave(HDC hdc) noexcept {
    double phase = static_cast<double>(GetTickCount64() % 1000) / 1000.0;
    int radius = static_cast<int>(7 + phase * 11);
    int alpha = static_cast<int>(150 * (1.0 - phase));
    HPEN pen = CreatePen(PS_SOLID, 2, RGB(std::clamp(alpha, 0, 255), std::clamp(alpha, 0, 255), std::clamp(alpha, 0, 255)));
    auto oldPen = SelectObject(hdc, pen);
    auto oldBrush = SelectObject(hdc, GetStockObject(NULL_BRUSH));
    int cx = 25;
    int cy = 28;
    Ellipse(hdc, cx - radius, cy - radius, cx + radius, cy + radius);
    SelectObject(hdc, oldBrush);
    SelectObject(hdc, oldPen);
    DeleteObject(pen);
  }

  std::wstring statusText() const {
    if (!m_stateLabel.empty()) {
      return AppPathHelpers::fromUtf8(m_stateLabel);
    }
    if (m_state == "starting") return L"麦克风启动中";
    if (m_state == "recording") return L"录音中";
    if (m_state == "transcribing") return L"语音转换中";
    if (m_state == "enhancing") return L"文字整理中";
    if (m_state == "transcribe_failed") return L"语音转录失败";
    return L"";
  }

  static std::string stringValue(
      winrt::Microsoft::ReactNative::JSValueObject const &payload,
      char const *key,
      std::string const &fallback) noexcept {
    try {
      auto it = payload.find(key);
      if (it != payload.end()) {
        return it->second.AsString();
      }
    } catch (...) {
    }
    return fallback;
  }

  static double numberValue(
      winrt::Microsoft::ReactNative::JSValueObject const &payload,
      char const *key,
      double fallback) noexcept {
    try {
      auto it = payload.find(key);
      if (it != payload.end()) {
        return it->second.AsDouble();
      }
    } catch (...) {
    }
    return fallback;
  }

  void appendNativeLog(std::string const &message) const noexcept {
    AppPathHelpers::appendLog("[OverlayManager]", message);
  }

  winrt::Microsoft::ReactNative::ReactContext m_reactContext{nullptr};
  HHOOK m_keyboardHook = nullptr;
  HWND m_overlayWindow = nullptr;
  bool m_isRecording = false;
  std::string m_state = "recording";
  std::string m_stateLabel;
  std::wstring m_duration = L"00:00";
  double m_level = 0.0;
  ULONGLONG m_recordingStartedAt = 0;
};

} // namespace winrt::OffhandReactnative
