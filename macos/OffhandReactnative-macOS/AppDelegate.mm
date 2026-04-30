#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

@interface AppDelegate ()
@property (nonatomic, strong) NSStatusItem *statusItem;
@property (nonatomic, strong) NSWindow *mainWindow;
@end

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  self.moduleName = @"OffhandReactnative";
  self.initialProps = @{};
  self.dependencyProvider = [RCTAppDependencyProvider new];

  [super applicationDidFinishLaunching:notification];

  dispatch_async(dispatch_get_main_queue(), ^{
    [self setupMainWindow];
    [self setupStatusBarItem];
  });
}

- (void)setupMainWindow
{
  for (NSWindow *window in NSApp.windows) {
    if ([window isKindOfClass:[NSWindow class]] && (window.styleMask & NSWindowStyleMaskTitled)) {
      self.mainWindow = window;
      window.title = @"释手";
      window.releasedWhenClosed = NO;

      // Intercept close to hide instead of destroy
      [[NSNotificationCenter defaultCenter] addObserver:self
                                               selector:@selector(windowWillClose:)
                                                   name:NSWindowWillCloseNotification
                                                 object:window];
      break;
    }
  }
}

- (void)windowWillClose:(NSNotification *)notification
{
  NSWindow *window = notification.object;
  if (window == self.mainWindow) {
    // Don't actually close — just hide
    [window orderOut:nil];
  }
}

- (void)setupStatusBarItem
{
  self.statusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];

  NSImage *icon = [NSApp applicationIconImage];
  if (!icon) {
    icon = [NSImage imageNamed:NSImageNameTouchBarAudioInputTemplate];
  }
  icon.size = NSMakeSize(18, 18);
  self.statusItem.button.image = icon;
  self.statusItem.button.toolTip = @"释手 Offhand";

  NSMenu *menu = [[NSMenu alloc] init];
  [menu addItem:[[NSMenuItem alloc] initWithTitle:@"打开 / Open" action:@selector(showMainWindow) keyEquivalent:@""]];
  [menu addItem:[NSMenuItem separatorItem]];
  [menu addItem:[[NSMenuItem alloc] initWithTitle:@"退出 / Quit" action:@selector(terminateApp) keyEquivalent:@""]];
  self.statusItem.menu = menu;
}

- (void)showMainWindow
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.mainWindow) {
      [NSApp activateIgnoringOtherApps:YES];
      [self.mainWindow makeKeyAndOrderFront:nil];
    } else {
      // Fallback: find any window
      for (NSWindow *window in NSApp.windows) {
        if (window.styleMask & NSWindowStyleMaskTitled) {
          self.mainWindow = window;
          window.releasedWhenClosed = NO;
          [NSApp activateIgnoringOtherApps:YES];
          [window makeKeyAndOrderFront:nil];
          return;
        }
      }
    }
  });
}

- (void)terminateApp
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
  [NSApp terminate:nil];
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag
{
  [self showMainWindow];
  return YES;
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender
{
  return NO;
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  NSURL *bundleURL = [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
  if (bundleURL) {
    return bundleURL;
  }

  NSString *host = [[NSUserDefaults standardUserDefaults] stringForKey:@"RCT_jsLocation"];
  if (host.length == 0) {
    NSString *port = NSProcessInfo.processInfo.environment[@"RCT_METRO_PORT"];
    if (port.length == 0) {
      port = @"8081";
    }
    host = [NSString stringWithFormat:@"localhost:%@", port];
  }
  return [RCTBundleURLProvider jsBundleURLForBundleRoot:@"index"
                                           packagerHost:host
                                              enableDev:YES
                                     enableMinification:NO
                                        inlineSourceMap:NO];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

- (BOOL)concurrentRootEnabled
{
#ifdef RN_FABRIC_ENABLED
  return true;
#else
  return false;
#endif
}

@end
