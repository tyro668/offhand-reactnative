import Cocoa

/// Standalone recording overlay view, ported from the Flutter Offhand
/// reference implementation. Renders a small floating pill with a blurred
/// background, a pulsing recording indicator, a mm:ss duration counter,
/// six animated level bars, a status label and a wave animation used while
/// transcribing / enhancing.
final class OverlayView: NSView {

  // Subviews / layers
  private let backgroundView = NSVisualEffectView()
  private let darkOverlay = NSView()
  private let dotView = NSView()
  private let durationLabel = NSTextField(labelWithString: "00:00")
  private let statusLabel = NSTextField(labelWithString: "")
  private var barViews: [NSView] = []
  private var waveLayer: CAShapeLayer?
  private var pulseTimer: Timer?
  private var dotScale: CGFloat = 1.0
  private var lastLevel: CGFloat = 0.0

  // Layout constants
  private let dotSize: CGFloat = 10
  private let barCount = 6
  private let barWidth: CGFloat = 4
  private let barGap: CGFloat = 3

  override init(frame: NSRect) {
    super.init(frame: frame)
    setupViews()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    setupViews()
  }

  private func setupViews() {
    wantsLayer = true
    layer?.masksToBounds = true
    layer?.cornerRadius = bounds.height / 2

    // Blurred background
    backgroundView.frame = bounds
    backgroundView.autoresizingMask = [.width, .height]
    backgroundView.material = .hudWindow
    backgroundView.state = .active
    backgroundView.blendingMode = .behindWindow
    backgroundView.wantsLayer = true
    backgroundView.layer?.cornerRadius = bounds.height / 2
    backgroundView.layer?.masksToBounds = true
    addSubview(backgroundView)

    // Dark overlay tint
    darkOverlay.frame = bounds
    darkOverlay.autoresizingMask = [.width, .height]
    darkOverlay.wantsLayer = true
    darkOverlay.layer?.backgroundColor =
      NSColor(red: 0.10, green: 0.10, blue: 0.15, alpha: 0.85).cgColor
    darkOverlay.layer?.cornerRadius = bounds.height / 2
    darkOverlay.layer?.masksToBounds = true
    addSubview(darkOverlay)

    // Recording indicator dot
    dotView.frame = NSRect(
      x: 20,
      y: (bounds.height - dotSize) / 2,
      width: dotSize,
      height: dotSize
    )
    dotView.wantsLayer = true
    dotView.layer?.backgroundColor = NSColor.systemRed.cgColor
    dotView.layer?.cornerRadius = dotSize / 2
    addSubview(dotView)

    // Duration label (monospaced digits)
    durationLabel.frame = NSRect(x: 40, y: (bounds.height - 20) / 2, width: 56, height: 20)
    durationLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 15, weight: .medium)
    durationLabel.textColor = .white
    durationLabel.alignment = .left
    durationLabel.backgroundColor = .clear
    durationLabel.isBordered = false
    durationLabel.isEditable = false
    addSubview(durationLabel)

    // Audio level bars
    let barStartX: CGFloat = 98
    for i in 0..<barCount {
      let bar = NSView(frame: NSRect(
        x: barStartX + CGFloat(i) * (barWidth + barGap),
        y: (bounds.height - 8) / 2,
        width: barWidth,
        height: 8
      ))
      bar.wantsLayer = true
      bar.layer?.backgroundColor = NSColor.white.withAlphaComponent(0.8).cgColor
      bar.layer?.cornerRadius = 2
      addSubview(bar)
      barViews.append(bar)
    }

    // Status label – vertically align its center to the dot's center
    let barEndX = barStartX
      + CGFloat(barCount) * barWidth
      + CGFloat(barCount - 1) * barGap
    let labelHeight: CGFloat = 16
    statusLabel.frame = NSRect(
      x: barEndX + 12,
      y: dotView.frame.midY - labelHeight / 2,
      width: bounds.width - barEndX - 18,
      height: labelHeight
    )
    statusLabel.font = NSFont.systemFont(ofSize: 13, weight: .regular)
    statusLabel.textColor = NSColor.white.withAlphaComponent(0.7)
    statusLabel.alignment = .left
    statusLabel.backgroundColor = .clear
    statusLabel.isBordered = false
    statusLabel.isEditable = false
    statusLabel.isSelectable = false
    addSubview(statusLabel)

    startPulse()
  }

  // MARK: - Public API

  /// Update the visual state of the overlay.
  /// - Parameters:
  ///   - state: one of `starting`, `recording`, `transcribing`, `enhancing`,
  ///            `transcribe_failed`.
  ///   - duration: mm:ss formatted duration, only shown while recording.
  ///   - level: 0...1 audio level, drives the height of the level bars.
  ///   - stateLabel: optional override for the right-hand text label.
  func update(state: String, duration: String, level: Double, stateLabel: String? = nil) {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.durationLabel.stringValue = duration
      self.lastLevel = CGFloat(max(0.0, min(1.0, level)))
      let label = stateLabel ?? self.defaultStatusText(for: state)

      switch state {
      case "starting":
        self.statusLabel.stringValue = label
        self.dotView.layer?.backgroundColor = NSColor.systemYellow.cgColor
        self.dotView.isHidden = false
        self.durationLabel.isHidden = true
        self.barViews.forEach { $0.isHidden = true }
        self.stopWaveAnimation()
        self.stopPulse()

      case "recording":
        self.statusLabel.stringValue = label
        self.dotView.layer?.backgroundColor = NSColor.systemRed.cgColor
        self.dotView.isHidden = false
        self.durationLabel.isHidden = false
        self.barViews.forEach { $0.isHidden = false }
        self.stopWaveAnimation()
        self.startPulse()
        self.updateBars(level: self.lastLevel)

      case "transcribing":
        self.statusLabel.stringValue = label
        self.dotView.layer?.backgroundColor =
          NSColor(red: 0.42, green: 0.39, blue: 1.0, alpha: 1.0).cgColor
        self.dotView.isHidden = false
        self.durationLabel.isHidden = true
        self.barViews.forEach { $0.isHidden = true }
        self.stopPulse()
        self.startWaveAnimation()

      case "enhancing":
        self.statusLabel.stringValue = label
        self.dotView.layer?.backgroundColor =
          NSColor(red: 0.31, green: 0.78, blue: 0.62, alpha: 1.0).cgColor
        self.dotView.isHidden = false
        self.durationLabel.isHidden = true
        self.barViews.forEach { $0.isHidden = true }
        self.stopPulse()
        self.startWaveAnimation()

      case "transcribe_failed":
        self.statusLabel.stringValue = label
        self.dotView.layer?.backgroundColor = NSColor.systemRed.cgColor
        self.dotView.isHidden = false
        self.durationLabel.isHidden = true
        self.barViews.forEach { $0.isHidden = true }
        self.stopWaveAnimation()
        self.stopPulse()

      default:
        self.statusLabel.stringValue = label
        self.barViews.forEach { $0.isHidden = true }
        self.stopWaveAnimation()
        self.stopPulse()
      }
    }
  }

  // MARK: - Helpers

  private func defaultStatusText(for state: String) -> String {
    switch state {
    case "starting":          return "等待录音"
    case "recording":         return "等待录音"
    case "transcribing":      return "录音转文字"
    case "enhancing":         return "文本增强"
    case "transcribe_failed": return "语音转录失败"
    default:                  return ""
    }
  }

  private func updateBars(level: CGFloat) {
    let minHeight: CGFloat = 4
    let maxHeight: CGFloat = 18
    for (index, bar) in barViews.enumerated() {
      let phase = CGFloat(index) / CGFloat(max(barViews.count - 1, 1))
      let shaped = level * (0.6 + 0.4 * (1.0 - abs(phase - 0.5) * 2.0))
      let height = minHeight + (maxHeight - minHeight) * shaped
      var frame = bar.frame
      frame.size.height = height
      frame.origin.y = (bounds.height - height) / 2
      bar.animator().frame = frame
    }
  }

  private func startPulse() {
    stopPulse()
    pulseTimer = Timer.scheduledTimer(withTimeInterval: 0.6, repeats: true) {
      [weak self] _ in
      guard let self = self else { return }
      NSAnimationContext.runAnimationGroup { context in
        context.duration = 0.3
        self.dotView.animator().alphaValue = self.dotScale > 1.0 ? 1.0 : 0.4
      }
      self.dotScale = self.dotScale > 1.0 ? 1.0 : 1.3
    }
  }

  private func stopPulse() {
    pulseTimer?.invalidate()
    pulseTimer = nil
    dotView.alphaValue = 1.0
  }

  private func startWaveAnimation() {
    stopWaveAnimation()
    let center = CGPoint(x: dotView.frame.midX, y: dotView.frame.midY)
    let startRadius: CGFloat = 6
    let endRadius: CGFloat = 16

    let wave = CAShapeLayer()
    wave.fillColor = NSColor.clear.cgColor
    wave.strokeColor = NSColor.white.withAlphaComponent(0.6).cgColor
    wave.lineWidth = 1.5
    wave.path = CGPath(ellipseIn: CGRect(
      x: center.x - startRadius,
      y: center.y - startRadius,
      width: startRadius * 2,
      height: startRadius * 2
    ), transform: nil)

    layer?.addSublayer(wave)
    waveLayer = wave

    let scale = CABasicAnimation(keyPath: "transform.scale")
    scale.fromValue = 1.0
    scale.toValue = endRadius / startRadius
    scale.duration = 1.0

    let opacity = CABasicAnimation(keyPath: "opacity")
    opacity.fromValue = 0.8
    opacity.toValue = 0.0
    opacity.duration = 1.0

    let group = CAAnimationGroup()
    group.animations = [scale, opacity]
    group.duration = 1.0
    group.repeatCount = .infinity
    wave.add(group, forKey: "wave")
  }

  private func stopWaveAnimation() {
    waveLayer?.removeAllAnimations()
    waveLayer?.removeFromSuperlayer()
    waveLayer = nil
  }

  override func draw(_ dirtyRect: NSRect) {
    NSColor.clear.setFill()
    dirtyRect.fill()
  }
}
