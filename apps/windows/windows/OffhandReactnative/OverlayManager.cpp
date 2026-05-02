#include "pch.h"
#include "OverlayManager.h"

#include "NativeHelpers.h"

#include <shellapi.h>

#include <algorithm>
#include <chrono>
#include <cmath>

namespace winrt::OffhandReactnative {
namespace {

constexpr wchar_t kScope[] = L"OverlayManager";
constexpr wchar_t kHotkeyClassName[] = L"OffhandHotkeyMessageWindow";
constexpr wchar_t kOverlayClassName[] = L"OffhandRecordingOverlayWindow";
constexpr int kHotkeyId = 0x0f8;
constexpr UINT kSetOverlayStateMessage = WM_APP + 101;
constexpr UINT kToggleRecordingMessage = WM_APP + 102;
constexpr UINT kStopThreadMessage = WM_APP + 103;

std::wstring StateLabel(std::wstring const &state, std::wstring const &label) {
  if (!label.empty()) {
    return label;
  }
  if (state == L"recording") {
    return L"Recording";
  }
  if (state == L"transcribing") {
    return L"Transcribing";
  }
  if (state == L"enhancing") {
    return L"Enhancing";
  }
  if (state == L"starting") {
    return L"Starting microphone";
  }
  return L"Offhand";
}

COLORREF AccentForState(std::wstring const &state) {
  if (state == L"recording") {
    return RGB(64, 196, 125);
  }
  if (state == L"transcribing") {
    return RGB(86, 156, 214);
  }
  if (state == L"enhancing") {
    return RGB(214, 174, 86);
  }
  return RGB(120, 120, 120);
}

void FillRoundRect(HDC dc, RECT const &rect, int radius, HBRUSH brush) {
  auto region = CreateRoundRectRgn(rect.left, rect.top, rect.right, rect.bottom, radius, radius);
  FillRgn(dc, region, brush);
  DeleteObject(region);
}

} // namespace

void OverlayManager::Initialize(React::ReactContext const &reactContext) noexcept {
  m_context = reactContext;
}

void OverlayManager::startMonitoring() noexcept {
  ensureThread();
}

void OverlayManager::stopMonitoring() noexcept {
  if (!m_running.exchange(false)) {
    return;
  }

  postThreadMessage(kStopThreadMessage);
  if (m_thread.joinable()) {
    m_thread.join();
  }
  m_threadId = 0;
  m_messageWindow = nullptr;
  m_overlayWindow = nullptr;
  m_hotkeyRegistered = false;
}

void OverlayManager::toggleRecording() noexcept {
  ensureThread();
  postThreadMessage(kToggleRecordingMessage);
}

void OverlayManager::setOverlayState(React::JSValueObject payload) noexcept {
  auto stringValue = [&payload](std::string const &key) -> std::string {
    auto it = payload.find(key);
    return it == payload.end() ? "" : it->second.AsString();
  };
  auto numberValue = [&payload](std::string const &key) -> double {
    auto it = payload.find(key);
    return it == payload.end() ? 0.0 : it->second.AsDouble();
  };

  auto state = NativeHelpers::Utf8ToWide(stringValue("state"));
  auto duration = NativeHelpers::Utf8ToWide(stringValue("duration"));
  auto label = NativeHelpers::Utf8ToWide(stringValue("stateLabel"));
  double level = numberValue("level");

  {
    std::lock_guard lock(m_stateMutex);
    m_state = state.empty() ? L"hidden" : state;
    m_duration = duration.empty() ? L"00:00" : duration;
    m_label = label;
    m_level = std::clamp(level, 0.0, 1.0);
  }

  ensureThread();
  postThreadMessage(kSetOverlayStateMessage);
}

void OverlayManager::getLogFilePath(React::ReactPromise<std::string> result) noexcept {
  result.Resolve(NativeHelpers::ToUtf8Path(NativeHelpers::LogFilePath()));
}

void OverlayManager::openLogFolder(React::ReactPromise<bool> result) noexcept {
  auto logsDir = NativeHelpers::LogsDirectory().wstring();
  auto value = reinterpret_cast<intptr_t>(
      ShellExecuteW(nullptr, L"open", logsDir.c_str(), nullptr, nullptr, SW_SHOWNORMAL));
  result.Resolve(value > 32);
}

void OverlayManager::appendLog(std::string message) noexcept {
  NativeHelpers::AppendLog(kScope, NativeHelpers::Utf8ToWide(message));
}

void OverlayManager::checkPermissions(React::ReactPromise<React::JSValue> result) noexcept {
  bool hotkeyOk = m_hotkeyRegistered.load();
  result.Resolve(React::JSValueObject{
      {"accessibility", true},
      {"inputMonitoring", hotkeyOk},
      {"microphone", true},
      {"microphoneStatus",
       hotkeyOk ? "F8 global shortcut is registered. Microphone consent is requested when recording starts."
                : "F8 global shortcut is not registered. Another app may be using it."},
  });
}

void OverlayManager::requestAccessibilityPermission(React::ReactPromise<bool> result) noexcept {
  result.Resolve(true);
}

void OverlayManager::requestInputMonitoringPermission(React::ReactPromise<bool> result) noexcept {
  ensureThread();
  result.Resolve(m_hotkeyRegistered.load());
}

void OverlayManager::requestMicrophonePermission(React::ReactPromise<bool> result) noexcept {
  auto value = reinterpret_cast<intptr_t>(
      ShellExecuteW(nullptr, L"open", L"ms-settings:privacy-microphone", nullptr, nullptr, SW_SHOWNORMAL));
  result.Resolve(value > 32);
}

void OverlayManager::addListener(std::string /*eventName*/) noexcept {}

void OverlayManager::removeListeners(double /*count*/) noexcept {}

void OverlayManager::ensureThread() noexcept {
  if (m_running.load()) {
    return;
  }

  bool expected = false;
  if (!m_running.compare_exchange_strong(expected, true)) {
    return;
  }

  m_thread = std::thread([this]() noexcept { threadMain(); });
}

void OverlayManager::postThreadMessage(UINT message, WPARAM wParam, LPARAM lParam) noexcept {
  DWORD threadId = 0;
  for (int i = 0; i < 50; i++) {
    threadId = m_threadId.load();
    if (threadId != 0) {
      break;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  if (threadId != 0) {
    PostThreadMessageW(threadId, message, wParam, lParam);
  }
}

void OverlayManager::threadMain() noexcept {
  winrt::init_apartment(winrt::apartment_type::single_threaded);
  m_threadId = GetCurrentThreadId();

  WNDCLASSEXW hotkeyClass{};
  hotkeyClass.cbSize = sizeof(WNDCLASSEXW);
  hotkeyClass.lpfnWndProc = OverlayManager::HotkeyWndProc;
  hotkeyClass.hInstance = GetModuleHandleW(nullptr);
  hotkeyClass.lpszClassName = kHotkeyClassName;
  RegisterClassExW(&hotkeyClass);

  WNDCLASSEXW overlayClass{};
  overlayClass.cbSize = sizeof(WNDCLASSEXW);
  overlayClass.lpfnWndProc = OverlayManager::OverlayWndProc;
  overlayClass.hInstance = GetModuleHandleW(nullptr);
  overlayClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  overlayClass.lpszClassName = kOverlayClassName;
  RegisterClassExW(&overlayClass);

  m_messageWindow = CreateWindowExW(
      0,
      kHotkeyClassName,
      L"OffhandHotkeyMessageWindow",
      0,
      0,
      0,
      0,
      0,
      HWND_MESSAGE,
      nullptr,
      GetModuleHandleW(nullptr),
      this);

  m_overlayWindow = CreateWindowExW(
      WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED | WS_EX_TRANSPARENT,
      kOverlayClassName,
      L"OffhandRecordingOverlay",
      WS_POPUP,
      CW_USEDEFAULT,
      CW_USEDEFAULT,
      360,
      86,
      nullptr,
      nullptr,
      GetModuleHandleW(nullptr),
      this);

  if (m_overlayWindow) {
    SetLayeredWindowAttributes(m_overlayWindow, 0, 238, LWA_ALPHA);
  }

  if (m_messageWindow && RegisterHotKey(m_messageWindow, kHotkeyId, MOD_NOREPEAT, VK_F8)) {
    m_hotkeyRegistered = true;
    NativeHelpers::AppendLog(kScope, L"F8 global hotkey registered.");
  } else {
    m_hotkeyRegistered = false;
    NativeHelpers::AppendLog(kScope, L"Failed to register F8 global hotkey.");
  }

  MSG msg{};
  while (m_running.load() && GetMessageW(&msg, nullptr, 0, 0) > 0) {
    if (msg.message == kStopThreadMessage) {
      break;
    }
    if (msg.message == kToggleRecordingMessage) {
      toggleRecordingOnThread();
      continue;
    }
    if (msg.message == kSetOverlayStateMessage) {
      showOrUpdateOverlayOnThread();
      continue;
    }
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }

  if (m_messageWindow && m_hotkeyRegistered.load()) {
    UnregisterHotKey(m_messageWindow, kHotkeyId);
  }
  m_hotkeyRegistered = false;
  if (m_overlayWindow) {
    DestroyWindow(m_overlayWindow);
  }
  if (m_messageWindow) {
    DestroyWindow(m_messageWindow);
  }
  m_overlayWindow = nullptr;
  m_messageWindow = nullptr;
}

void OverlayManager::toggleRecordingOnThread() noexcept {
  bool next = !m_recording.load();
  m_recording = next;
  NativeHelpers::AppendLog(kScope, next ? L"Recording toggled on." : L"Recording toggled off.");
  emitRecordingState(next);
}

void OverlayManager::showOrUpdateOverlayOnThread() noexcept {
  std::wstring state;
  {
    std::lock_guard lock(m_stateMutex);
    state = m_state;
  }

  if (state == L"hidden" || state == L"idle") {
    hideOverlayOnThread();
    return;
  }

  if (!m_overlayWindow) {
    return;
  }

  HMONITOR monitor = MonitorFromWindow(GetForegroundWindow(), MONITOR_DEFAULTTONEAREST);
  MONITORINFO info{};
  info.cbSize = sizeof(MONITORINFO);
  GetMonitorInfoW(monitor, &info);
  RECT work = info.rcWork;
  int width = 360;
  int height = 86;
  int x = work.left + ((work.right - work.left) - width) / 2;
  int y = work.bottom - height - 72;

  SetWindowPos(
      m_overlayWindow,
      HWND_TOPMOST,
      x,
      y,
      width,
      height,
      SWP_NOACTIVATE | SWP_SHOWWINDOW);
  InvalidateRect(m_overlayWindow, nullptr, TRUE);
}

void OverlayManager::hideOverlayOnThread() noexcept {
  if (m_overlayWindow) {
    ShowWindow(m_overlayWindow, SW_HIDE);
  }
}

void OverlayManager::paintOverlay(HWND hwnd) noexcept {
  PAINTSTRUCT paint{};
  HDC dc = BeginPaint(hwnd, &paint);
  RECT rect{};
  GetClientRect(hwnd, &rect);

  HBRUSH background = CreateSolidBrush(RGB(30, 32, 36));
  FillRoundRect(dc, rect, 22, background);
  DeleteObject(background);

  std::wstring state;
  std::wstring duration;
  std::wstring label;
  double level = 0;
  {
    std::lock_guard lock(m_stateMutex);
    state = m_state;
    duration = m_duration;
    label = StateLabel(m_state, m_label);
    level = std::clamp(m_level, 0.0, 1.0);
  }

  COLORREF accentColor = AccentForState(state);
  HBRUSH accent = CreateSolidBrush(accentColor);
  RECT dot{24, 30, 48, 54};
  FillRoundRect(dc, dot, 24, accent);

  RECT meter{64, 58, 336, 66};
  HBRUSH meterBack = CreateSolidBrush(RGB(62, 66, 74));
  FillRoundRect(dc, meter, 8, meterBack);
  DeleteObject(meterBack);
  RECT meterFill = meter;
  meterFill.right = meter.left + static_cast<LONG>((meter.right - meter.left) * std::clamp(level, 0.12, 1.0));
  FillRoundRect(dc, meterFill, 8, accent);
  DeleteObject(accent);

  SetBkMode(dc, TRANSPARENT);
  SetTextColor(dc, RGB(245, 247, 250));
  HFONT titleFont = CreateFontW(
      20,
      0,
      0,
      0,
      FW_SEMIBOLD,
      FALSE,
      FALSE,
      FALSE,
      DEFAULT_CHARSET,
      OUT_DEFAULT_PRECIS,
      CLIP_DEFAULT_PRECIS,
      CLEARTYPE_QUALITY,
      DEFAULT_PITCH | FF_SWISS,
      L"Segoe UI");
  HFONT oldFont = static_cast<HFONT>(SelectObject(dc, titleFont));
  RECT labelRect{64, 20, 260, 46};
  DrawTextW(dc, label.c_str(), -1, &labelRect, DT_SINGLELINE | DT_LEFT | DT_VCENTER | DT_END_ELLIPSIS);

  SetTextColor(dc, RGB(210, 216, 225));
  RECT durationRect{260, 20, 336, 46};
  DrawTextW(dc, duration.c_str(), -1, &durationRect, DT_SINGLELINE | DT_RIGHT | DT_VCENTER);
  SelectObject(dc, oldFont);
  DeleteObject(titleFont);

  EndPaint(hwnd, &paint);
}

void OverlayManager::emitRecordingState(bool isRecording) noexcept {
  if (!m_context) {
    return;
  }
  m_context.EmitJSEvent(
      L"RCTDeviceEventEmitter",
      L"onRecordingStateChange",
      React::JSValueObject{{"isRecording", isRecording}});
}

void OverlayManager::setOverlayStateOnThread(
    std::wstring state,
    std::wstring duration,
    double level,
    std::wstring label) noexcept {
  {
    std::lock_guard lock(m_stateMutex);
    m_state = std::move(state);
    m_duration = std::move(duration);
    m_level = level;
    m_label = std::move(label);
  }
  showOrUpdateOverlayOnThread();
}

LRESULT CALLBACK OverlayManager::HotkeyWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) noexcept {
  OverlayManager *self = reinterpret_cast<OverlayManager *>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  if (message == WM_NCCREATE) {
    auto create = reinterpret_cast<CREATESTRUCTW *>(lParam);
    self = reinterpret_cast<OverlayManager *>(create->lpCreateParams);
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
  }

  if (self && message == WM_HOTKEY && static_cast<int>(wParam) == kHotkeyId) {
    self->toggleRecordingOnThread();
    return 0;
  }

  return DefWindowProcW(hwnd, message, wParam, lParam);
}

LRESULT CALLBACK OverlayManager::OverlayWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) noexcept {
  OverlayManager *self = reinterpret_cast<OverlayManager *>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  if (message == WM_NCCREATE) {
    auto create = reinterpret_cast<CREATESTRUCTW *>(lParam);
    self = reinterpret_cast<OverlayManager *>(create->lpCreateParams);
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
  }

  if (self && message == WM_PAINT) {
    self->paintOverlay(hwnd);
    return 0;
  }
  if (message == WM_NCHITTEST) {
    return HTTRANSPARENT;
  }
  return DefWindowProcW(hwnd, message, wParam, lParam);
}

} // namespace winrt::OffhandReactnative
