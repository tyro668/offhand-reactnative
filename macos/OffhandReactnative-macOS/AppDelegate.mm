#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

@interface AppDelegate ()
@property (nonatomic, strong) NSStatusItem *statusItem;
@end

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  self.moduleName = @"OffhandReactnative";
  self.initialProps = @{};
  self.dependencyProvider = [RCTAppDependencyProvider new];

  [super applicationDidFinishLaunching:notification];

  dispatch_async(dispatch_get_main_queue(), ^{
    [self applyMainWindowTitle];
  });

  [self setupStatusBarItem];
}

- (NSImage *)shishouApplicationIcon
{
  NSImage *icon = [NSApp applicationIconImage];
  if (icon && icon.isValid) {
    return icon;
  }

  icon = [NSImage imageNamed:@"AppIcon"];
  if (icon && icon.isValid) {
    return icon;
  }

  NSString *iconPath = [[NSBundle mainBundle] pathForResource:@"AppIcon" ofType:@"icns"];
  if (iconPath.length > 0) {
    icon = [[NSImage alloc] initWithContentsOfFile:iconPath];
  }

  return icon.isValid ? icon : nil;
}

- (void)applyMainWindowTitle
{
  for (NSWindow *window in NSApp.windows) {
    window.title = @"释手语音输入法";
  }
}

- (void)setupStatusBarItem
{
  self.statusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];

  NSImage *icon = [[self shishouApplicationIcon] copy];
  if (!icon) {
    icon = [NSImage imageNamed:NSImageNameTouchBarAudioInputTemplate];
  }

  icon.size = NSMakeSize(18, 18);
  [icon setTemplate:NO];
  self.statusItem.button.image = icon;
  self.statusItem.button.toolTip = @"释手语音输入法";

  // Menu
  NSMenu *menu = [[NSMenu alloc] init];
  [menu addItem:[[NSMenuItem alloc] initWithTitle:@"打开释手语音输入法" action:@selector(showMainWindow) keyEquivalent:@""]];
  [menu addItem:[NSMenuItem separatorItem]];
  [menu addItem:[[NSMenuItem alloc] initWithTitle:@"退出 / Quit" action:@selector(terminateApp) keyEquivalent:@""]];
  self.statusItem.menu = menu;
}

- (void)showMainWindow
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [NSApp activateIgnoringOtherApps:YES];
    NSWindow *window = NSApp.windows.firstObject;
    if (window) {
      [self applyMainWindowTitle];
      [window makeKeyAndOrderFront:nil];
    } else {
      // Re-create if needed (react-native handles this)
      [NSApp activateIgnoringOtherApps:YES];
    }
  });
}

- (void)terminateApp
{
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
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
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
