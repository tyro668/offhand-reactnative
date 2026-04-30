#import "OverlayManager.h"
#import <Cocoa/Cocoa.h>

// ---- constants ----
static const CGFloat kPanelWidth = 280;
static const CGFloat kPanelHeight = 56;
static const NSInteger kBarCount = 6;
static const CGFloat kBarWidth = 4;
static const CGFloat kBarGap = 3;

// ---- OverlayView: custom NSView for recording HUD ----
@interface OverlayView : NSView
@property (nonatomic, strong) NSView *dotView;
@property (nonatomic, strong) NSTextField *durationLabel;
@property (nonatomic, strong) NSMutableArray<NSView *> *barViews;
@property (nonatomic, strong) NSTextField *statusLabel;
@property (nonatomic, strong) NSTimer *pulseTimer;
@property (nonatomic) CGFloat dotScale;
@property (nonatomic, strong) CAShapeLayer *waveLayer;
- (void)updateState:(NSString *)state duration:(NSString *)duration level:(double)level label:(NSString *)label;
- (void)updateBars:(CGFloat)level;
- (void)startPulse;
- (void)stopPulse;
- (void)startWave;
- (void)stopWave;
@end

@implementation OverlayView

- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame];
  if (self) {
    [self setup];
  }
  return self;
}

- (void)setup {
  self.wantsLayer = YES;

  // Dark background
  NSView *bg = [[NSView alloc] initWithFrame:self.bounds];
  bg.wantsLayer = YES;
  bg.layer.backgroundColor = [[NSColor colorWithRed:0.08 green:0.08 blue:0.12 alpha:0.92] CGColor];
  bg.layer.cornerRadius = kPanelHeight / 2;
  bg.layer.masksToBounds = YES;
  bg.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [self addSubview:bg];

  // Recording dot
  CGFloat dotSize = 10;
  self.dotView = [[NSView alloc] initWithFrame:NSMakeRect(20, (kPanelHeight - dotSize) / 2, dotSize, dotSize)];
  self.dotView.wantsLayer = YES;
  self.dotView.layer.backgroundColor = [NSColor systemRedColor].CGColor;
  self.dotView.layer.cornerRadius = dotSize / 2;
  [self addSubview:self.dotView];

  // Duration label
  self.durationLabel = [NSTextField labelWithString:@"00:00"];
  self.durationLabel.frame = NSMakeRect(40, (kPanelHeight - 20) / 2, 56, 20);
  self.durationLabel.font = [NSFont monospacedDigitSystemFontOfSize:15 weight:NSFontWeightMedium];
  self.durationLabel.textColor = [NSColor whiteColor];
  self.durationLabel.alignment = NSTextAlignmentLeft;
  self.durationLabel.hidden = YES;
  [self addSubview:self.durationLabel];

  // Volume bars
  self.barViews = [NSMutableArray array];
  CGFloat barStartX = 98;
  for (NSInteger i = 0; i < kBarCount; i++) {
    NSView *bar = [[NSView alloc] initWithFrame:NSMakeRect(barStartX + i * (kBarWidth + kBarGap), (kPanelHeight - 8) / 2, kBarWidth, 8)];
    bar.wantsLayer = YES;
    bar.layer.backgroundColor = [[NSColor whiteColor] colorWithAlphaComponent:0.8].CGColor;
    bar.layer.cornerRadius = 2;
    bar.hidden = YES;
    [self addSubview:bar];
    [self.barViews addObject:bar];
  }

  // Status label – vertically align its center to the dot's center
  CGFloat barEndX = barStartX + kBarCount * kBarWidth + (kBarCount - 1) * kBarGap;
  CGFloat labelHeight = 16;
  self.statusLabel = [NSTextField labelWithString:@""];
  self.statusLabel.frame = NSMakeRect(barEndX + 12,
                                       self.dotView.frame.origin.y + dotSize / 2 - labelHeight / 2,
                                       130,
                                       labelHeight);
  self.statusLabel.font = [NSFont systemFontOfSize:13 weight:NSFontWeightRegular];
  self.statusLabel.textColor = [[NSColor whiteColor] colorWithAlphaComponent:0.6];
  self.statusLabel.alignment = NSTextAlignmentLeft;
  [self addSubview:self.statusLabel];

  [self startPulse];
}

- (NSString *)defaultStatusForState:(NSString *)state {
  if ([state isEqualToString:@"starting"]) return @"麦克风启动中";
  if ([state isEqualToString:@"recording"]) return @"录音中";
  if ([state isEqualToString:@"transcribing"]) return @"语音转换中";
  if ([state isEqualToString:@"enhancing"]) return @"文字整理中";
  if ([state isEqualToString:@"transcribe_failed"]) return @"语音转录失败";
  return @"";
}

- (void)updateState:(NSString *)state duration:(NSString *)duration level:(double)level label:(NSString *)label {
  dispatch_async(dispatch_get_main_queue(), ^{
    self.durationLabel.stringValue = duration ?: @"00:00";
    CGFloat lvl = (CGFloat)MAX(0.0, MIN(1.0, level));
    NSString *statusText = (label && label.length > 0) ? label : [self defaultStatusForState:state];

    if ([state isEqualToString:@"starting"]) {
      self.dotView.layer.backgroundColor = [NSColor systemYellowColor].CGColor;
      self.dotView.hidden = NO;
      self.durationLabel.hidden = YES;
      for (NSView *bar in self.barViews) bar.hidden = YES;
      [self stopWave];
      [self stopPulse];
    } else if ([state isEqualToString:@"recording"]) {
      self.dotView.layer.backgroundColor = [NSColor systemRedColor].CGColor;
      self.dotView.hidden = NO;
      self.durationLabel.hidden = NO;
      for (NSView *bar in self.barViews) bar.hidden = NO;
      [self stopWave];
      [self startPulse];
      [self updateBars:lvl];
    } else if ([state isEqualToString:@"transcribing"]) {
      self.dotView.layer.backgroundColor = [[NSColor colorWithRed:0.42 green:0.39 blue:1.0 alpha:1.0] CGColor];
      self.dotView.hidden = NO;
      self.durationLabel.hidden = YES;
      for (NSView *bar in self.barViews) bar.hidden = YES;
      [self stopPulse];
      [self startWave];
    } else if ([state isEqualToString:@"enhancing"]) {
      self.dotView.layer.backgroundColor = [[NSColor colorWithRed:0.31 green:0.78 blue:0.62 alpha:1.0] CGColor];
      self.dotView.hidden = NO;
      self.durationLabel.hidden = YES;
      for (NSView *bar in self.barViews) bar.hidden = YES;
      [self stopPulse];
      [self startWave];
    } else if ([state isEqualToString:@"transcribe_failed"]) {
      self.dotView.layer.backgroundColor = [NSColor systemRedColor].CGColor;
      self.dotView.hidden = NO;
      self.durationLabel.hidden = YES;
      for (NSView *bar in self.barViews) bar.hidden = YES;
      [self stopWave];
      [self stopPulse];
    } else {
      for (NSView *bar in self.barViews) bar.hidden = YES;
      [self stopWave];
      [self stopPulse];
    }

    self.statusLabel.stringValue = statusText;
  });
}

- (void)updateBars:(CGFloat)level {
  CGFloat minH = 4;
  CGFloat maxH = 18;
  for (NSInteger i = 0; i < self.barViews.count; i++) {
    CGFloat phase = (CGFloat)i / (CGFloat)MAX(self.barViews.count - 1, 1);
    CGFloat shaped = level * (0.6 + 0.4 * (1.0 - fabs(phase - 0.5) * 2.0));
    CGFloat h = minH + (maxH - minH) * shaped;
    NSView *bar = self.barViews[i];
    NSRect frame = bar.frame;
    frame.size.height = h;
    frame.origin.y = (kPanelHeight - h) / 2;
    bar.animator.frame = frame;
  }
}

- (void)startPulse {
  [self stopPulse];
  __weak typeof(self) weakSelf = self;
  self.pulseTimer = [NSTimer scheduledTimerWithTimeInterval:0.6 repeats:YES block:^(NSTimer *timer) {
    __strong typeof(weakSelf) strongSelf = weakSelf;
    if (!strongSelf) return;
    [NSAnimationContext runAnimationGroup:^(NSAnimationContext *ctx) {
      ctx.duration = 0.3;
      strongSelf.dotView.animator.alphaValue = strongSelf.dotScale > 1.0 ? 1.0 : 0.4;
    } completionHandler:nil];
    strongSelf.dotScale = strongSelf.dotScale > 1.0 ? 1.0 : 1.3;
  }];
}

- (void)stopPulse {
  [self.pulseTimer invalidate];
  self.pulseTimer = nil;
  self.dotView.alphaValue = 1.0;
}

- (void)startWave {
  [self stopWave];
  CGPoint center = CGPointMake(self.dotView.frame.origin.x + self.dotView.frame.size.width / 2,
                                self.dotView.frame.origin.y + self.dotView.frame.size.height / 2);
  CGFloat startR = 6;
  CGFloat endR = 16;

  CAShapeLayer *wave = [CAShapeLayer layer];
  wave.fillColor = [NSColor clearColor].CGColor;
  wave.strokeColor = [[NSColor whiteColor] colorWithAlphaComponent:0.6].CGColor;
  wave.lineWidth = 1.5;
  wave.path = CGPathCreateWithEllipseInRect(CGRectMake(center.x - startR, center.y - startR, startR * 2, startR * 2), NULL);

  [self.layer addSublayer:wave];
  self.waveLayer = wave;

  CABasicAnimation *scale = [CABasicAnimation animationWithKeyPath:@"transform.scale"];
  scale.fromValue = @1.0;
  scale.toValue = @(endR / startR);
  scale.duration = 1.0;

  CABasicAnimation *opacity = [CABasicAnimation animationWithKeyPath:@"opacity"];
  opacity.fromValue = @0.8;
  opacity.toValue = @0.0;
  opacity.duration = 1.0;

  CAAnimationGroup *group = [CAAnimationGroup animation];
  group.animations = @[scale, opacity];
  group.duration = 1.0;
  group.repeatCount = HUGE_VALF;
  [wave addAnimation:group forKey:@"wave"];
}

- (void)stopWave {
  [self.waveLayer removeAllAnimations];
  [self.waveLayer removeFromSuperlayer];
  self.waveLayer = nil;
}

@end

// ---- OverlayManager: React Native bridge ----
@interface OverlayManager ()
@property (nonatomic, strong) NSPanel *overlayPanel;
@property (nonatomic, strong) OverlayView *overlayView;
@property (nonatomic) BOOL isRecording;
@property (nonatomic) id eventMonitor;
@property (nonatomic) CFMachPortRef eventTap;
@property (nonatomic) BOOL fnPressed;
@property (nonatomic, strong) NSTimer *tapKeepAlive;
@end

@implementation OverlayManager

RCT_EXPORT_MODULE();

- (NSArray<NSString *> *)supportedEvents {
  return @[@"onRecordingStateChange"];
}

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

// ---- Overlay window ----

- (void)createOverlayPanel {
  if (self.overlayPanel) return;

  NSRect panelRect = NSMakeRect(0, 0, kPanelWidth, kPanelHeight);
  NSScreen *screen = [NSScreen mainScreen];
  CGFloat x = (screen.frame.size.width - kPanelWidth) / 2;
  CGFloat y = screen.frame.size.height * 0.08;

  self.overlayPanel = [[NSPanel alloc] initWithContentRect:panelRect
                                                styleMask:NSWindowStyleMaskNonactivatingPanel | NSWindowStyleMaskFullSizeContentView
                                                  backing:NSBackingStoreBuffered
                                                    defer:NO];
  self.overlayPanel.level = NSFloatingWindowLevel;
  self.overlayPanel.isFloatingPanel = YES;
  self.overlayPanel.backgroundColor = [NSColor clearColor];
  self.overlayPanel.opaque = NO;
  self.overlayPanel.hasShadow = YES;
  self.overlayPanel.ignoresMouseEvents = YES;
  self.overlayPanel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
  self.overlayPanel.alphaValue = 0;

  [self.overlayPanel setFrameOrigin:NSMakePoint(x, y)];

  // Titlebar
  self.overlayPanel.titleVisibility = NSWindowTitleHidden;
  self.overlayPanel.titlebarAppearsTransparent = YES;
  self.overlayPanel.styleMask |= NSWindowStyleMaskFullSizeContentView;

  self.overlayView = [[OverlayView alloc] initWithFrame:NSMakeRect(0, 0, kPanelWidth, kPanelHeight)];
  self.overlayPanel.contentView = self.overlayView;
}

- (void)showOverlay {
  [self createOverlayPanel];
  [self.overlayPanel orderFrontRegardless];
  [NSAnimationContext runAnimationGroup:^(NSAnimationContext *ctx) {
    ctx.duration = 0.25;
    self.overlayPanel.animator.alphaValue = 1.0;
  } completionHandler:nil];
}

- (void)hideOverlay {
  [NSAnimationContext runAnimationGroup:^(NSAnimationContext *ctx) {
    ctx.duration = 0.2;
    self.overlayPanel.animator.alphaValue = 0;
  } completionHandler:^{
    [self.overlayPanel orderOut:nil];
  }];
}

- (void)updateOverlay:(NSString *)state duration:(NSString *)duration level:(double)level label:(NSString *)label {
  [self.overlayView updateState:state duration:duration level:level label:label];
}

// ---- Fn key monitoring via CGEventTap ----

- (void)startEventTap {
  if (self.eventTap) return;

  __weak typeof(self) weakSelf = self;

  CGEventMask mask = CGEventMaskBit(kCGEventFlagsChanged);
  self.eventTap = CGEventTapCreate(kCGHIDEventTap, kCGHeadInsertEventTap, kCGEventTapOptionDefault, mask, ^CGEventRef(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *refcon) {
    __strong typeof(weakSelf) strongSelf = (__bridge typeof(strongSelf))refcon;
    if (!strongSelf) return event;

    if (type == kCGEventFlagsChanged) {
      CGEventFlags flags = CGEventGetFlags(event);
      BOOL fnNow = (flags & kCGEventFlagMaskSecondaryFn) != 0;

      if (fnNow && !strongSelf.fnPressed) {
        strongSelf.fnPressed = YES;
      }
      if (!fnNow && strongSelf.fnPressed) {
        strongSelf.fnPressed = NO;
        [strongSelf toggleRecording];
      }
    }
    return event;
  }, (__bridge void *)self);

  if (self.eventTap) {
    CFRunLoopSourceRef source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, self.eventTap, 0);
    CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
    CFRelease(source);
    CGEventTapEnable(self.eventTap, true);

    // Keep-alive timer to re-enable tap if disabled by system
    __weak typeof(self) wSelf = self;
    self.tapKeepAlive = [NSTimer scheduledTimerWithTimeInterval:0.5 repeats:YES block:^(NSTimer *timer) {
      __strong typeof(wSelf) sSelf = wSelf;
      if (!sSelf || !sSelf.eventTap) {
        [timer invalidate];
        return;
      }
      if (!CGEventTapIsEnabled(sSelf.eventTap)) {
        CGEventTapEnable(sSelf.eventTap, true);
      }
    }];
  } else {
    // Fallback to NSEvent monitor if CGEventTap fails (e.g. no accessibility permission)
    [self startNSEventMonitor];
  }
}

- (void)stopEventTap {
  [self.tapKeepAlive invalidate];
  self.tapKeepAlive = nil;

  if (self.eventTap) {
    CGEventTapEnable(self.eventTap, false);
    CFMachPortInvalidate(self.eventTap);
    CFRelease(self.eventTap);
    self.eventTap = NULL;
  }

  if (self.eventMonitor) {
    [NSEvent removeMonitor:self.eventMonitor];
    self.eventMonitor = nil;
  }
}

- (void)startNSEventMonitor {
  if (self.eventMonitor) return;

  __weak typeof(self) weakSelf = self;
  self.eventMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskFlagsChanged handler:^(NSEvent *event) {
    __strong typeof(weakSelf) strongSelf = weakSelf;
    if (!strongSelf) return;

    BOOL fnNow = (event.modifierFlags & NSEventModifierFlagFunction) != 0;
    if (fnNow && !strongSelf.fnPressed) {
      strongSelf.fnPressed = YES;
    }
    if (!fnNow && strongSelf.fnPressed) {
      strongSelf.fnPressed = NO;
      [strongSelf toggleRecording];
    }
  }];
}

- (void)toggleRecording {
  self.isRecording = !self.isRecording;

  if (self.isRecording) {
    [self showOverlay];
    [self.overlayView updateState:@"recording" duration:@"00:00" level:0.3 label:nil];
  } else {
    [self hideOverlay];
  }

  [self sendEventWithName:@"onRecordingStateChange"
                     body:@{@"isRecording": @(self.isRecording)}];
}

// ---- RCT exported methods ----

RCT_EXPORT_METHOD(startMonitoring) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self startEventTap];
  });
}

RCT_EXPORT_METHOD(stopMonitoring) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self stopEventTap];
    [self hideOverlay];
    self.isRecording = NO;
  });
}

RCT_EXPORT_METHOD(toggleRecording) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self toggleRecording];
  });
}

RCT_EXPORT_METHOD(updateOverlayState:(NSString *)state duration:(NSString *)duration level:(nonnull NSNumber *)level label:(NSString *)label) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self updateOverlay:state duration:duration level:level.doubleValue label:label];
  });
}

@end
