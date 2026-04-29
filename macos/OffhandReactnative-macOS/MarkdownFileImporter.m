#import "MarkdownFileImporter.h"
#import <Cocoa/Cocoa.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

@implementation MarkdownFileImporter

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

RCT_EXPORT_METHOD(importMarkdownFile:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.allowsMultipleSelection = NO;
    panel.canChooseDirectories = NO;
    panel.canChooseFiles = YES;
    panel.resolvesAliases = YES;
    NSMutableArray<UTType *> *allowedTypes = [NSMutableArray array];
    UTType *mdType = [UTType typeWithFilenameExtension:@"md"];
    UTType *markdownType = [UTType typeWithFilenameExtension:@"markdown"];
    if (mdType) {
      [allowedTypes addObject:mdType];
    }
    if (markdownType) {
      [allowedTypes addObject:markdownType];
    }
    panel.allowedContentTypes = allowedTypes;
    panel.title = @"选择 Markdown 语料文件";
    panel.prompt = @"添加";

    [panel beginWithCompletionHandler:^(NSModalResponse result) {
      if (result != NSModalResponseOK) {
        resolve([NSNull null]);
        return;
      }

      NSURL *url = panel.URLs.firstObject;
      if (!url) {
        resolve([NSNull null]);
        return;
      }

      NSError *readError = nil;
      NSString *content = [NSString stringWithContentsOfURL:url
                                                   encoding:NSUTF8StringEncoding
                                                      error:&readError];
      if (readError || !content) {
        reject(@"markdown_read_failed",
               readError.localizedDescription ?: @"Failed to read markdown file.",
               readError);
        return;
      }

      resolve(@{
        @"fileName": url.lastPathComponent ?: @"",
        @"filePath": url.path ?: @"",
        @"content": content ?: @"",
      });
    }];
  });
}

@end
