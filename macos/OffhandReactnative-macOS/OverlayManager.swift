import Cocoa
import React
import ApplicationServices
import AVFoundation

@objc(OverlayManager)
final class OverlayManager: RCTEventEmitter {

  // MARK: - State
  private var overlayPanel: NSPanel?
  private var overlayView: OverlayView?
  private var durationTimer: Timer?
  private var levelTimer: Timer?
  private var recordingStartedAt: Date?
  private var simulatedLevel: Double = 0.0
  private var currentOverlayState: String = "recording"
  private var currentStateLabel: String?
  private let logQueue = DispatchQueue(label: "com.offhand.overlaymanager.log")

  // CGEventTap state (HID-level, head-insert -> highest priority).
  private var eventTap: CFMachPort?
  private var runLoopSource: CFRunLoopSource?
  private var permissionRetryTimer: Timer?

  private var isRecording = false
  private var fnIsDown = false
  private var fnPressWasPure = false
  private var hasListeners = false
  private var monitoringRequested = false
  private var lastFnReleaseAt: TimeInterval = 0
  private var flagsChangedLogCount = 0
  private var keyEventLogCount = 0

  private static let logDirectoryURL: URL = {
    URL(fileURLWithPath: AppPaths.logsDirectory(), isDirectory: true)
  }()

  private static let logFileURL: URL = {
    URL(fileURLWithPath: AppPaths.logFilePath(), isDirectory: false)
  }()

  // MARK: - RN module setup

  override static func requiresMainQueueSetup() -> Bool { true }

  override init() {
    super.init()
    log("native module initialized.")
  }

  override func supportedEvents() -> [String]? {
    return ["onRecordingStateChange"]
  }

  override func startObserving() {
    hasListeners = true
    log("RN listener attached.")
  }

  override func stopObserving() {
    hasListeners = false
    log("RN listener detached.")
  }

  // MARK: - RN exported methods

  @objc func startMonitoring() {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.monitoringRequested = true
      self.log("startMonitoring called from RN.")
      self.installEventTap(promptForPermissions: true)
    }
  }

  @objc func stopMonitoring() {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.log("stopMonitoring called from RN.")
      self.monitoringRequested = false
      self.stopPermissionRetry()
      self.removeEventTap()
      self.hideOverlay()
      self.setRecording(false, reason: "stopMonitoring")
    }
  }

  @objc func toggleRecording() {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.log("toggleRecording called from RN.")
      self.performToggle(reason: "RN toggleRecording")
    }
  }

  /// Allow JS to push richer overlay state transitions (starting → recording
  /// → transcribing → enhancing → transcribe_failed). When `state` is
  /// supplied as `"hidden"` the overlay is dismissed without changing the
  /// internal recording boolean.
  @objc func setOverlayState(_ payload: NSDictionary) {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      let state = payload["state"] as? String ?? "recording"
      let stateLabel = payload["stateLabel"] as? String
      let durationOverride = payload["duration"] as? String
      let levelOverride = payload["level"] as? Double

      if state == "hidden" {
        self.hideOverlay()
        return
      }

      self.currentOverlayState = state
      self.currentStateLabel = stateLabel

      // Showing for the first time outside of the fn-toggle path.
      if self.overlayPanel == nil || self.overlayPanel?.isVisible == false {
        self.showOverlay()
      }

      let duration = durationOverride ?? self.formattedDuration()
      let level = levelOverride ?? self.simulatedLevel
      self.overlayView?.update(
        state: state,
        duration: duration,
        level: level,
        stateLabel: stateLabel
      )

      // Only the recording state runs the duration / level timers.
      if state == "recording" {
        self.startDurationAndLevelTimers()
      } else {
        self.stopDurationAndLevelTimers()
      }
    }
  }

  @objc func getLogFilePath(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    ensureLogFileExists()
    resolve(Self.logFileURL.path)
  }

  @objc func openLogFolder(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    guard ensureLogFileExists() else {
      reject("log_folder_unavailable", "Unable to create the log folder.", nil)
      return
    }
    NSWorkspace.shared.open(Self.logDirectoryURL)
    log("opened log folder from settings.")
    resolve(true)
  }

  @objc func appendLog(_ message: String) {
    log("[JS] \(message)")
  }

  // MARK: - Permission inspection (exposed to JS)

  /// Returns the current authorization state for accessibility (HID event tap),
  /// input monitoring, and microphone access. JS calls this on a timer to
  /// drive the sidebar status pills.
  @objc func checkPermissions(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    let accessibility = AXIsProcessTrusted()
    let inputMonitoring: Bool
    if #available(macOS 10.15, *) {
      inputMonitoring = CGPreflightListenEventAccess()
    } else {
      inputMonitoring = true
    }
    let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
    let microphone = micStatus == .authorized
    let microphoneStatus: String = {
      switch micStatus {
      case .authorized:    return "authorized"
      case .denied:        return "denied"
      case .restricted:    return "restricted"
      case .notDetermined: return "notDetermined"
      @unknown default:    return "unknown"
      }
    }()

    resolve([
      "accessibility": accessibility,
      "inputMonitoring": inputMonitoring,
      "microphone": microphone,
      "microphoneStatus": microphoneStatus,
    ])
  }

  /// Prompt the user for Accessibility access. The system shows the prompt
  /// only the first time; afterwards the user must toggle the switch in
  /// System Settings, so we also open the relevant pane.
  @objc func requestAccessibilityPermission(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    let opts: NSDictionary = [
      kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true
    ]
    let trusted = AXIsProcessTrustedWithOptions(opts)
    if !trusted {
      if let url = URL(string: "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility") {
        NSWorkspace.shared.open(url)
      }
    }
    resolve(trusted)
  }

  /// Prompt the user for Input Monitoring access (HID-level event tap).
  @objc func requestInputMonitoringPermission(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    if #available(macOS 10.15, *) {
      let granted = CGRequestListenEventAccess()
      if !granted {
        if let url = URL(string: "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ListenEvent") {
          NSWorkspace.shared.open(url)
        }
      }
      resolve(granted)
    } else {
      resolve(true)
    }
  }

  /// Prompt the user for microphone access.
  @objc func requestMicrophonePermission(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    let status = AVCaptureDevice.authorizationStatus(for: .audio)
    switch status {
    case .authorized:
      resolve(true)
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .audio) { granted in
        DispatchQueue.main.async { resolve(granted) }
      }
    case .denied, .restricted:
      if let url = URL(string: "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone") {
        NSWorkspace.shared.open(url)
      }
      resolve(false)
    @unknown default:
      resolve(false)
    }
  }

  // MARK: - File logging

  @discardableResult
  private func ensureLogFileExists() -> Bool {
    do {
      try FileManager.default.createDirectory(
        at: Self.logDirectoryURL,
        withIntermediateDirectories: true
      )
      if !FileManager.default.fileExists(atPath: Self.logFileURL.path) {
        _ = FileManager.default.createFile(atPath: Self.logFileURL.path, contents: nil)
      }
      return true
    } catch {
      NSLog("[OverlayManager] failed to prepare log file: %@", "\(error)")
      return false
    }
  }

  private func log(_ message: String) {
    let line = "[OverlayManager] \(message)"
    NSLog("%@", line)

    let timestamp = ISO8601DateFormatter().string(from: Date())
    let fileLine = "\(timestamp) \(line)\n"
    logQueue.async { [weak self] in
      guard let self = self, self.ensureLogFileExists() else { return }
      guard let data = fileLine.data(using: .utf8) else { return }

      do {
        let handle = try FileHandle(forWritingTo: Self.logFileURL)
        handle.seekToEndOfFile()
        handle.write(data)
        handle.closeFile()
      } catch {
        NSLog("[OverlayManager] failed to append log file: %@", "\(error)")
      }
    }
  }

  // MARK: - Global fn-key tap (highest priority)
  //
  // CGEventTap installed at HID level with head-insert placement: this
  // intercepts the fn key BEFORE the system's input-source / Globe-key
  // handler, and lets us swallow (return nil) the event so the IME
  // switcher / emoji panel never fires.

  private func installEventTap(promptForPermissions: Bool) {
    guard eventTap == nil else {
      log("installEventTap skipped; tap already installed.")
      return
    }

    // HID-level taps require Accessibility permission. Prompt the user.
    let opts: NSDictionary = [
      kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: promptForPermissions
    ]
    let accessibilityTrusted = AXIsProcessTrustedWithOptions(opts)
    let listenTrusted: Bool
    if #available(macOS 10.15, *) {
      listenTrusted = CGPreflightListenEventAccess()
      if promptForPermissions && !listenTrusted {
        _ = CGRequestListenEventAccess()
      }
    } else {
      listenTrusted = true
    }
    log(
      "permission check: accessibility=\(accessibilityTrusted ? "granted" : "missing") inputMonitoring=\(listenTrusted ? "granted" : "missing") prompt=\(promptForPermissions ? "true" : "false")"
    )

    guard accessibilityTrusted && listenTrusted else {
      log("waiting for keyboard permissions before installing CGEventTap.")
      startPermissionRetry()
      return
    }

    let mask =
      (1 << CGEventType.flagsChanged.rawValue) |
      (1 << CGEventType.keyDown.rawValue)      |
      (1 << CGEventType.keyUp.rawValue)
    let selfPtr = Unmanaged.passUnretained(self).toOpaque()

    // kVK_Function == 63 (0x3F). On Apple Silicon Macs the fn / Globe key
    // also emits real keyDown/keyUp events with this keycode, and macOS's
    // dictation / input-source switch is driven from those events. We must
    // swallow them too, otherwise pressing fn pops the dictation prompt.
    // (Inlined as a literal because CGEventTapCallBack must be a pure
    // C function pointer and cannot capture context.)

    let callback: CGEventTapCallBack = { _, type, event, refcon in
      guard let refcon = refcon else { return Unmanaged.passUnretained(event) }
      let mgr = Unmanaged<OverlayManager>.fromOpaque(refcon).takeUnretainedValue()

      // Re-enable if the system disabled the tap.
      if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        mgr.log("CGEventTap disabled by system (\(type.rawValue)); re-enabling.")
        if let tap = mgr.eventTap {
          CGEvent.tapEnable(tap: tap, enable: true)
        }
        return Unmanaged.passUnretained(event)
      }

      let flags = event.flags
      let otherMods: CGEventFlags = [
        .maskCommand, .maskAlternate, .maskControl, .maskShift,
      ]
      let pureFn = flags.intersection(otherMods).rawValue == 0

      // ---- Real keyDown / keyUp on the Globe / fn key (keycode 63) ----
      if type == .keyDown || type == .keyUp {
        let keycode = event.getIntegerValueField(.keyboardEventKeycode)
        if keycode == 63 {
          mgr.logFnKeyEvent(type: type, flags: flags, pureFn: pureFn)
          if pureFn {
            // On release we toggle, on press we just remember state.
            mgr.fnIsDown = type == .keyDown
            mgr.fnPressWasPure = true
            if type == .keyUp {
              DispatchQueue.main.async { mgr.handleFnRelease(source: "keyUp") }
            }
            return nil   // swallow -> no dictation / no Globe-key behaviour
          }
          mgr.fnPressWasPure = false
          mgr.log("fn key event ignored because another modifier is held.")
        }
        return Unmanaged.passUnretained(event)
      }

      // ---- flagsChanged backup path (older Macs / external keyboards) ----
      guard type == .flagsChanged else {
        return Unmanaged.passUnretained(event)
      }

      let fnNow = flags.contains(.maskSecondaryFn)
      let keycode = event.getIntegerValueField(.keyboardEventKeycode)
      mgr.logFlagsChangedIfNeeded(keycode: keycode, flags: flags, fnNow: fnNow, pureFn: pureFn)

      if fnNow && !mgr.fnIsDown {
        mgr.fnIsDown = true
        mgr.fnPressWasPure = pureFn
        mgr.log("fn down detected via flagsChanged. pureFn=\(pureFn ? "true" : "false")")
        if pureFn { return nil }
      } else if !fnNow && mgr.fnIsDown {
        mgr.fnIsDown = false
        let shouldToggle = mgr.fnPressWasPure && pureFn
        mgr.fnPressWasPure = false
        mgr.log("fn up detected via flagsChanged. pureFn=\(pureFn ? "true" : "false") shouldToggle=\(shouldToggle ? "true" : "false")")
        if shouldToggle {
          DispatchQueue.main.async { mgr.handleFnRelease(source: "flagsChanged") }
          return nil
        }
      }

      return Unmanaged.passUnretained(event)
    }

    guard let tap = CGEvent.tapCreate(
      tap: .cghidEventTap,           // earliest possible point
      place: .headInsertEventTap,    // before all other taps
      options: .defaultTap,          // active: may modify / drop events
      eventsOfInterest: CGEventMask(mask),
      callback: callback,
      userInfo: selfPtr
    ) else {
      log("CGEventTap.create failed even though permissions look granted. Check App Sandbox/Input Monitoring and relaunch if needed.")
      startPermissionRetry()
      return
    }

    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)

    self.eventTap = tap
    self.runLoopSource = source
    stopPermissionRetry()
    log("CGEventTap installed (HID head-insert).")
  }

  private func startPermissionRetry() {
    guard monitoringRequested, permissionRetryTimer == nil else { return }
    permissionRetryTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
      guard let self = self else { return }
      guard self.monitoringRequested, self.eventTap == nil else {
        self.stopPermissionRetry()
        return
      }
      self.log("retrying CGEventTap installation.")
      self.installEventTap(promptForPermissions: false)
    }
  }

  private func stopPermissionRetry() {
    permissionRetryTimer?.invalidate()
    permissionRetryTimer = nil
  }

  private func removeEventTap() {
    if let source = runLoopSource {
      CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
      runLoopSource = nil
    }
    if let tap = eventTap {
      CGEvent.tapEnable(tap: tap, enable: false)
      eventTap = nil
    }
    fnIsDown = false
    fnPressWasPure = false
    log("CGEventTap removed.")
  }

  // MARK: - Toggle

  private func handleFnRelease(source: String) {
    let now = ProcessInfo.processInfo.systemUptime
    if now - lastFnReleaseAt < 0.12 {
      log("duplicate fn release ignored from \(source).")
      return
    }
    lastFnReleaseAt = now
    log("fn release accepted from \(source); toggling recording.")
    performToggle(reason: "fn \(source)")
  }

  private func performToggle(reason: String) {
    setRecording(!isRecording, reason: reason)
  }

  private func setRecording(_ nextValue: Bool, reason: String) {
    guard isRecording != nextValue else {
      log("recording already \(isRecording ? "on" : "off"); reason=\(reason).")
      return
    }
    isRecording = nextValue
    log("recording \(isRecording ? "started" : "stopped"); reason=\(reason).")
    if isRecording {
      currentOverlayState = "recording"
      currentStateLabel = "等待录音"
      showOverlay()
    } else if hasListeners && reason.hasPrefix("fn ") {
      currentOverlayState = "transcribing"
      currentStateLabel = "录音转文字"
      stopDurationAndLevelTimers()
      recordingStartedAt = nil
      if overlayPanel == nil || overlayPanel?.isVisible == false {
        showOverlay()
      } else {
        overlayView?.update(
          state: currentOverlayState,
          duration: "00:00",
          level: simulatedLevel,
          stateLabel: currentStateLabel
        )
      }
    } else {
      hideOverlay()
    }
    if hasListeners {
      sendEvent(withName: "onRecordingStateChange",
                body: ["isRecording": isRecording])
    } else {
      log("recording state changed but RN has no active listener.")
    }
  }

  private func logFnKeyEvent(type: CGEventType, flags: CGEventFlags, pureFn: Bool) {
    keyEventLogCount += 1
    log("fn \(type == .keyDown ? "keyDown" : "keyUp") event received. pureFn=\(pureFn ? "true" : "false") flags=\(describe(flags: flags)) count=\(keyEventLogCount)")
  }

  private func logFlagsChangedIfNeeded(
    keycode: Int64,
    flags: CGEventFlags,
    fnNow: Bool,
    pureFn: Bool
  ) {
    let isFnCandidate = keycode == 63 || fnNow || fnIsDown
    guard isFnCandidate || flagsChangedLogCount < 12 else { return }
    flagsChangedLogCount += 1
    log("flagsChanged received. keycode=\(keycode) fnNow=\(fnNow ? "true" : "false") pureFn=\(pureFn ? "true" : "false") flags=\(describe(flags: flags)) sample=\(flagsChangedLogCount)")
  }

  private func describe(flags: CGEventFlags) -> String {
    var names: [String] = []
    if flags.contains(.maskSecondaryFn) { names.append("fn") }
    if flags.contains(.maskCommand) { names.append("cmd") }
    if flags.contains(.maskAlternate) { names.append("opt") }
    if flags.contains(.maskControl) { names.append("ctrl") }
    if flags.contains(.maskShift) { names.append("shift") }
    if names.isEmpty { names.append("none") }
    return "\(names.joined(separator: "+")) raw=\(flags.rawValue)"
  }

  // MARK: - Overlay window

  private func createOverlayIfNeeded() {
    guard overlayPanel == nil else { return }
    guard let screen = NSScreen.main else { return }

    let panelW: CGFloat = 280
    let panelH: CGFloat = 56
    let frame = screen.visibleFrame
    let x = frame.midX - panelW / 2
    let y = frame.minY + 80

    let panel = NSPanel(
      contentRect: NSRect(x: x, y: y, width: panelW, height: panelH),
      styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
      backing: .buffered,
      defer: false
    )
    panel.isFloatingPanel = true
    panel.level = NSWindow.Level(rawValue: Int(CGShieldingWindowLevel()))
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.titleVisibility = .hidden
    panel.titlebarAppearsTransparent = true
    panel.isReleasedWhenClosed = false
    panel.ignoresMouseEvents = true
    panel.collectionBehavior = [
      .canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle,
    ]
    panel.hidesOnDeactivate = false
    panel.alphaValue = 0

    let view = OverlayView(frame: NSRect(x: 0, y: 0, width: panelW, height: panelH))
    panel.contentView = view

    self.overlayPanel = panel
    self.overlayView = view
  }

  private func positionOverlay() {
    guard let panel = overlayPanel, let screen = NSScreen.main else { return }
    let screenFrame = screen.visibleFrame
    let panelFrame = panel.frame
    let x = screenFrame.midX - panelFrame.width / 2
    let y = screenFrame.origin.y + 80
    panel.setFrameOrigin(NSPoint(x: x, y: y))
  }

  private func showOverlay() {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.createOverlayIfNeeded()
      guard let panel = self.overlayPanel else { return }
      self.log("showing recording overlay.")
      self.positionOverlay()

      // Reset duration when transitioning into a fresh recording session.
      if self.currentOverlayState == "recording" {
        self.recordingStartedAt = Date()
        self.simulatedLevel = 0.0
      }
      self.overlayView?.update(
        state: self.currentOverlayState,
        duration: self.formattedDuration(),
        level: self.simulatedLevel,
        stateLabel: self.currentStateLabel
      )

      panel.orderFrontRegardless()
      NSAnimationContext.runAnimationGroup({ ctx in
        ctx.duration = 0.18
        panel.animator().alphaValue = 1.0
      })

      if self.currentOverlayState == "recording" {
        self.startDurationAndLevelTimers()
      }
    }
  }

  private func hideOverlay() {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.stopDurationAndLevelTimers()
      self.recordingStartedAt = nil
      guard let panel = self.overlayPanel else { return }
      self.log("hiding recording overlay.")
      NSAnimationContext.runAnimationGroup({ ctx in
        ctx.duration = 0.18
        panel.animator().alphaValue = 0
      }, completionHandler: {
        panel.orderOut(nil)
      })
    }
  }

  // MARK: - Duration / simulated audio level

  private func formattedDuration() -> String {
    guard let start = recordingStartedAt else { return "00:00" }
    let elapsed = Int(Date().timeIntervalSince(start))
    return String(format: "%02d:%02d", elapsed / 60, elapsed % 60)
  }

  private func startDurationAndLevelTimers() {
    if recordingStartedAt == nil {
      recordingStartedAt = Date()
    }
    if durationTimer == nil {
      durationTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) {
        [weak self] _ in
        guard let self = self else { return }
        self.overlayView?.update(
          state: self.currentOverlayState,
          duration: self.formattedDuration(),
          level: self.simulatedLevel,
          stateLabel: self.currentStateLabel
        )
      }
    }
    if levelTimer == nil {
      // Without a real audio capture pipeline, we synthesize a
      // pleasant-looking level signal so the bars feel alive while the
      // user speaks. JS can override this with `setOverlayState({level})`.
      levelTimer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) {
        [weak self] _ in
        guard let self = self else { return }
        let target = Double.random(in: 0.15...0.9)
        self.simulatedLevel = self.simulatedLevel * 0.6 + target * 0.4
        self.overlayView?.update(
          state: self.currentOverlayState,
          duration: self.formattedDuration(),
          level: self.simulatedLevel,
          stateLabel: self.currentStateLabel
        )
      }
    }
  }

  private func stopDurationAndLevelTimers() {
    durationTimer?.invalidate()
    durationTimer = nil
    levelTimer?.invalidate()
    levelTimer = nil
  }

  override func invalidate() {
    stopPermissionRetry()
    removeEventTap()
    hideOverlay()
    super.invalidate()
  }
}
