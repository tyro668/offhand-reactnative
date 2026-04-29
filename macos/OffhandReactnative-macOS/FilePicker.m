#import "FilePicker.h"
#import <Cocoa/Cocoa.h>

@implementation FilePicker

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

RCT_EXPORT_METHOD(pickMarkdownFile:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.canChooseFiles = YES;
    panel.canChooseDirectories = NO;
    panel.allowsMultipleSelection = NO;
    panel.allowedContentTypes = @[[UTType typeWithFilenameExtension:@"md"] ?: [UTType plainText]];

    [panel beginWithCompletionHandler:^(NSModalResponse result) {
      if (result == NSModalResponseOK && panel.URL) {
        NSError *err = nil;
        NSString *content = [NSString stringWithContentsOfURL:panel.URL encoding:NSUTF8StringEncoding error:&err];
        if (err) {
          reject(@"read_error", err.localizedDescription, err);
        } else {
          resolve(@{
            @"path": panel.URL.path,
            @"name": panel.URL.lastPathComponent.stringByDeletingPathExtension,
            @"content": content ?: @"",
          });
        }
      } else {
        resolve(@{});
      }
    }];
  });
}

@end
