#import "TextInserter.h"
#import <Cocoa/Cocoa.h>
#import <Carbon/Carbon.h>
#import <ApplicationServices/ApplicationServices.h>

@implementation TextInserter

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

RCT_EXPORT_METHOD(insertText:(NSString *)text
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      if (text.length == 0) {
        resolve(@NO);
        return;
      }

      // Strip trailing newlines to avoid accidental command execution in terminals
      NSString *clean = text;
      while ([clean hasSuffix:@"\n"] || [clean hasSuffix:@"\r"]) {
        clean = [clean substringToIndex:clean.length - 1];
      }

      NSRunningApplication *targetApp = [self focusedTargetApplication];
      BOOL terminalTarget = [self isTerminalApplication:targetApp];

      if (!terminalTarget && [self insertViaAccessibility:clean]) {
        resolve(@YES);
        return;
      }

      if ([self insertViaPasteboard:clean targetApplication:targetApp]) {
        resolve(@YES);
      } else {
        reject(@"text_insert_failed", @"Unable to insert text via pasteboard.", nil);
      }
    } @catch (NSException *exception) {
      NSString *reason = exception.reason ?: @"Unknown text insertion exception.";
      NSLog(@"[TextInserter] insertText exception: %@ %@", exception.name, reason);
      reject(@"text_insert_exception", reason, nil);
    }
  });
}

- (BOOL)insertViaAccessibility:(NSString *)text {
  AXUIElementRef systemWide = AXUIElementCreateSystemWide();
  if (!systemWide) return NO;

  AXUIElementRef focused = NULL;
  AXUIElementCopyAttributeValue(systemWide, kAXFocusedUIElementAttribute, (CFTypeRef *)&focused);
  CFRelease(systemWide);
  if (!focused) return NO;

  // Try to get selected text and replace
  CFTypeRef selectedRange = NULL;
  AXError err = AXUIElementCopyAttributeValue(focused, kAXSelectedTextRangeAttribute, &selectedRange);
  if (err == kAXErrorSuccess && selectedRange) {
    // There's a selection or cursor position - set the value
    err = AXUIElementSetAttributeValue(focused, kAXSelectedTextAttribute, (__bridge CFTypeRef)text);
    if (err == kAXErrorSuccess) {
      CFRelease(focused);
      if (selectedRange) CFRelease(selectedRange);
      return YES;
    }
    if (selectedRange) CFRelease(selectedRange);
  }

  if (focused) CFRelease(focused);
  return NO;
}

- (BOOL)insertViaPasteboard:(NSString *)text targetApplication:(NSRunningApplication *)targetApp {
  NSPasteboard *pb = [NSPasteboard generalPasteboard];
  NSDictionary<NSPasteboardType, NSData *> *oldDataByType = [self snapshotPasteboardData:pb];
  NSArray<NSPasteboardType> *oldTypes = [oldDataByType.allKeys copy];

  @try {
    [pb clearContents];
    if (![pb setString:text forType:NSPasteboardTypeString]) {
      return NO;
    }
  } @catch (NSException *exception) {
    NSLog(@"[TextInserter] failed to write temporary pasteboard text: %@ %@", exception.name, exception.reason ?: @"");
    return NO;
  }

  // Simulate one Cmd+V. Posting the same shortcut to multiple event taps can
  // make the target app receive duplicate paste commands.
  usleep(80000);
  if (![self sendPasteShortcutToApplication:targetApp]) {
    return NO;
  }

  // Restore clipboard after a delay
  if (oldTypes.count > 0) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 1000 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      @try {
        [pb declareTypes:oldTypes owner:nil];
        for (NSPasteboardType type in oldTypes) {
          NSData *data = oldDataByType[type];
          if (data) {
            [pb setData:data forType:type];
          }
        }
      } @catch (NSException *exception) {
        NSLog(@"[TextInserter] restore pasteboard skipped after exception: %@ %@", exception.name, exception.reason ?: @"");
      }
    });
  }

  return YES;
}

- (BOOL)sendPasteShortcutToApplication:(NSRunningApplication *)targetApp {
  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  if (!source) {
    NSLog(@"[TextInserter] paste shortcut: failed to create event source");
    return NO;
  }

  CGEventRef vDown = CGEventCreateKeyboardEvent(source, (CGKeyCode)kVK_ANSI_V, true);
  if (!vDown) {
    CFRelease(source);
    NSLog(@"[TextInserter] paste shortcut: failed to create keyDown event");
    return NO;
  }
  CGEventSetFlags(vDown, kCGEventFlagMaskCommand);

  CGEventRef vUp = CGEventCreateKeyboardEvent(source, (CGKeyCode)kVK_ANSI_V, false);
  if (!vUp) {
    CFRelease(vDown);
    CFRelease(source);
    NSLog(@"[TextInserter] paste shortcut: failed to create keyUp event");
    return NO;
  }
  CGEventSetFlags(vUp, kCGEventFlagMaskCommand);

  pid_t targetPid = targetApp ? targetApp.processIdentifier : 0;
  NSString *targetBundleId = targetApp.bundleIdentifier ?: @"";
  NSString *selfBundleId = NSBundle.mainBundle.bundleIdentifier ?: @"";
  if (targetPid > 0 && ![targetBundleId isEqualToString:selfBundleId]) {
    CGEventPostToPid(targetPid, vDown);
    usleep(30000);
    CGEventPostToPid(targetPid, vUp);
  } else {
    CGEventPost(kCGHIDEventTap, vDown);
    usleep(30000);
    CGEventPost(kCGHIDEventTap, vUp);
  }

  CFRelease(vDown);
  CFRelease(vUp);
  CFRelease(source);

  return YES;
}

- (NSRunningApplication *)focusedTargetApplication {
  AXUIElementRef systemWide = AXUIElementCreateSystemWide();
  if (systemWide) {
    AXUIElementRef focused = NULL;
    AXError err = AXUIElementCopyAttributeValue(systemWide, kAXFocusedUIElementAttribute, (CFTypeRef *)&focused);
    CFRelease(systemWide);
    if (err == kAXErrorSuccess && focused) {
      pid_t pid = 0;
      AXError pidErr = AXUIElementGetPid(focused, &pid);
      CFRelease(focused);
      if (pidErr == kAXErrorSuccess && pid > 0) {
        NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
        if (app) {
          return app;
        }
      }
    }
  }

  return NSWorkspace.sharedWorkspace.frontmostApplication;
}

- (BOOL)isTerminalApplication:(NSRunningApplication *)app {
  NSString *bundleId = app.bundleIdentifier.lowercaseString ?: @"";
  NSSet<NSString *> *terminalBundleIds = [NSSet setWithArray:@[
    @"com.apple.terminal",
    @"com.googlecode.iterm2",
    @"com.github.wez.wezterm",
    @"org.alacritty",
    @"net.kovidgoyal.kitty",
    @"com.mitchellh.ghostty",
  ]];
  return [terminalBundleIds containsObject:bundleId];
}

- (NSDictionary<NSPasteboardType, NSData *> *)snapshotPasteboardData:(NSPasteboard *)pasteboard {
  NSMutableDictionary<NSPasteboardType, NSData *> *snapshot = [NSMutableDictionary dictionary];
  NSArray<NSPasteboardType> *types = [pasteboard.types copy] ?: @[];

  for (NSPasteboardType type in types) {
    @try {
      NSData *data = [pasteboard dataForType:type];
      if (data.length > 0) {
        snapshot[type] = data;
      }
    } @catch (NSException *exception) {
      NSLog(@"[TextInserter] pasteboard snapshot skipped type %@ after exception: %@ %@",
            type,
            exception.name,
            exception.reason ?: @"");
    }
  }

  return [snapshot copy];
}

@end
