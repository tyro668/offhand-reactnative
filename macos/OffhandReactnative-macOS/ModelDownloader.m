#import "ModelDownloader.h"
#import "AppPaths.h"
#import <Cocoa/Cocoa.h>

static void MDLog(NSString *format, ...) {
  va_list args;
  va_start(args, format);
  NSString *msg = [[NSString alloc] initWithFormat:format arguments:args];
  va_end(args);

  NSDateFormatter *fmt = [[NSDateFormatter alloc] init];
  fmt.dateFormat = @"yyyy-MM-dd HH:mm:ss";
  NSString *ts = [fmt stringFromDate:[NSDate date]];
  NSLog(@"[MD] %@ %@", ts, msg);

  // Also write to the unified app log file
  NSString *logPath = [AppPaths logFilePath];
  NSString *line = [NSString stringWithFormat:@"[MD] %@ %@\n", ts, msg];
  NSFileHandle *fh = [NSFileHandle fileHandleForWritingAtPath:logPath];
  if (!fh) {
    [line writeToFile:logPath atomically:NO encoding:NSUTF8StringEncoding error:nil];
  } else {
    [fh seekToEndOfFile];
    [fh writeData:[line dataUsingEncoding:NSUTF8StringEncoding]];
    [fh closeFile];
  }
}

@interface ModelDownloader () <NSURLSessionDownloadDelegate>
@property (nonatomic, strong) NSURLSession *session;
@property (nonatomic, copy) NSString *currentModelKey;
@property (nonatomic, copy) NSArray<NSDictionary *> *pendingFiles;
@property (nonatomic, copy) NSArray<NSString *> *currentFileUrls;
@property (nonatomic, copy) NSString *currentFileName;
@property (nonatomic) NSInteger currentFileIndex;
@property (nonatomic) NSInteger currentUrlIndex;
@property (nonatomic) double lastProgressEmitted;
@property (nonatomic) BOOL currentTaskFailed;
@end

@implementation ModelDownloader

RCT_EXPORT_MODULE();

- (NSArray<NSString *> *)supportedEvents {
  return @[@"onDownloadProgress", @"onDownloadComplete"];
}

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

- (instancetype)init {
  self = [super init];
  if (self) {
    NSURLSessionConfiguration *config = [NSURLSessionConfiguration defaultSessionConfiguration];
    config.timeoutIntervalForRequest = 60;
    config.timeoutIntervalForResource = 60 * 60;
    self.session = [NSURLSession sessionWithConfiguration:config delegate:self delegateQueue:nil];
  }
  return self;
}

- (NSString *)modelDirectoryForKey:(NSString *)modelKey {
  NSString *root = [[AppPaths appDataDirectory] stringByAppendingPathComponent:@"models"];
  NSString *dir = [root stringByAppendingPathComponent:modelKey ?: @"unknown"];
  [[NSFileManager defaultManager] createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
  return dir;
}

RCT_EXPORT_METHOD(downloadModelFiles:(NSString *)modelKey
                  files:(NSArray<NSDictionary *> *)files
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
  MDLog(@"downloadModelFiles called: modelKey=%@ files=%lu", modelKey, (unsigned long)files.count);

  NSString *modelDir = [self modelDirectoryForKey:modelKey];
  MDLog(@"modelDir=%@", modelDir);

  // Check if already downloaded (all files exist with non-zero size)
  BOOL allExist = files.count > 0;
  for (NSDictionary *file in files) {
    NSString *name = file[@"name"];
    NSString *path = [modelDir stringByAppendingPathComponent:name];
    NSDictionary *attrs = [[NSFileManager defaultManager] attributesOfItemAtPath:path error:nil];
    if (!attrs || [attrs[NSFileSize] longLongValue] <= 0) {
      allExist = NO;
      break;
    }
  }
  if (allExist) {
    MDLog(@"All files already exist, skipping download");
    dispatch_async(dispatch_get_main_queue(), ^{
      [self sendEventWithName:@"onDownloadComplete"
                         body:@{@"modelKey": modelKey ?: @"",
                                @"success": @YES,
                                @"path": modelDir}];
    });
    resolve(@{@"path": modelDir, @"status": @"already_downloaded"});
    return;
  }

  self.currentModelKey = modelKey;
  self.pendingFiles = files;
  self.currentFileIndex = 0;
  [self downloadNextFile];
  resolve(@{@"path": modelDir, @"status": @"downloading"});
}

- (void)downloadNextFile {
  if (self.currentFileIndex >= self.pendingFiles.count) {
    MDLog(@"All files downloaded successfully");
    NSString *modelDir = [self modelDirectoryForKey:self.currentModelKey];
    dispatch_async(dispatch_get_main_queue(), ^{
      [self sendEventWithName:@"onDownloadComplete"
                         body:@{@"modelKey": self.currentModelKey ?: @"",
                                @"success": @YES,
                                @"path": modelDir}];
    });
    return;
  }

  NSDictionary *file = self.pendingFiles[self.currentFileIndex];
  self.currentFileName = file[@"name"];
  self.currentFileUrls = file[@"urls"];
  self.currentUrlIndex = 0;
  self.lastProgressEmitted = 0;
  MDLog(@"Downloading file %ld/%ld: %@", (long)(self.currentFileIndex + 1), (long)self.pendingFiles.count, self.currentFileName);

  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:@"onDownloadProgress"
                       body:@{@"modelKey": self.currentModelKey ?: @"",
                              @"fileName": self.currentFileName ?: @"",
                              @"progress": @0}];
  });

  [self tryNextUrl];
}

- (void)tryNextUrl {
  if (self.currentUrlIndex >= self.currentFileUrls.count) {
    // All URLs failed for this file → fail the whole download
    MDLog(@"All URLs failed for file %@, aborting", self.currentFileName);
    NSString *failedFile = self.currentFileName ?: @"";
    NSString *modelKey = self.currentModelKey ?: @"";
    dispatch_async(dispatch_get_main_queue(), ^{
      [self sendEventWithName:@"onDownloadComplete"
                         body:@{@"modelKey": modelKey,
                                @"success": @NO,
                                @"error": [NSString stringWithFormat:@"Failed to download %@: all mirrors unavailable", failedFile]}];
    });
    return;
  }

  NSString *urlStr = self.currentFileUrls[self.currentUrlIndex];
  MDLog(@"Trying URL[%ld/%lu] for %@: %@", (long)self.currentUrlIndex, (unsigned long)self.currentFileUrls.count, self.currentFileName, urlStr);
  NSURL *nsurl = [NSURL URLWithString:urlStr];
  if (!nsurl) {
    MDLog(@"Invalid URL, trying next");
    self.currentUrlIndex++;
    [self tryNextUrl];
    return;
  }

  self.currentTaskFailed = NO;
  NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:nsurl];
  [req setValue:@"OffhandReactnative/1.0" forHTTPHeaderField:@"User-Agent"];
  [[self.session downloadTaskWithRequest:req] resume];
  MDLog(@"Download task started for %@", self.currentFileName);
}

RCT_EXPORT_METHOD(cancelDownload:(NSString *)modelKey) {
  MDLog(@"cancelDownload: %@", modelKey);
  [self.session getTasksWithCompletionHandler:^(NSArray *dataTasks, NSArray *uploadTasks, NSArray *downloadTasks) {
    for (NSURLSessionDownloadTask *task in downloadTasks) {
      [task cancel];
    }
  }];
}

#pragma mark - NSURLSessionDownloadDelegate

- (void)URLSession:(NSURLSession *)session downloadTask:(NSURLSessionDownloadTask *)downloadTask
      didWriteData:(int64_t)bytesWritten totalBytesWritten:(int64_t)totalBytesWritten
totalBytesExpectedToWrite:(int64_t)totalBytesExpectedToWrite {
  if (totalBytesExpectedToWrite <= 0) return;
  double progress = (double)totalBytesWritten / (double)totalBytesExpectedToWrite;
  if (progress - self.lastProgressEmitted < 0.05 && progress < 1.0) return;
  self.lastProgressEmitted = progress;

  NSString *modelKey = self.currentModelKey ?: @"";
  NSString *fileName = self.currentFileName ?: @"";
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:@"onDownloadProgress"
                       body:@{@"modelKey": modelKey,
                              @"fileName": fileName,
                              @"progress": @(progress),
                              @"totalBytesWritten": @(totalBytesWritten),
                              @"totalBytesExpected": @(totalBytesExpectedToWrite)}];
  });
}

- (void)URLSession:(NSURLSession *)session downloadTask:(NSURLSessionDownloadTask *)downloadTask
didFinishDownloadingToURL:(NSURL *)location {
  NSHTTPURLResponse *response = (NSHTTPURLResponse *)downloadTask.response;
  NSInteger status = [response isKindOfClass:[NSHTTPURLResponse class]] ? response.statusCode : 0;
  MDLog(@"didFinishDownloading: %@ status=%ld → %@", self.currentFileName, (long)status, location.path);

  if (status < 200 || status >= 300) {
    // Non-2xx: treat as failure, advance to next URL. Do NOT move the body.
    MDLog(@"HTTP %ld for %@, will try next URL", (long)status, self.currentFileName);
    self.currentTaskFailed = YES;
    [[NSFileManager defaultManager] removeItemAtURL:location error:nil];
    return;
  }

  NSString *modelDir = [self modelDirectoryForKey:self.currentModelKey];
  NSString *destPath = [modelDir stringByAppendingPathComponent:self.currentFileName ?: @"file"];
  [[NSFileManager defaultManager] removeItemAtPath:destPath error:nil];
  NSError *moveError = nil;
  if (![[NSFileManager defaultManager] moveItemAtPath:location.path toPath:destPath error:&moveError]) {
    MDLog(@"Failed to move downloaded file to %@: %@", destPath, moveError.localizedDescription);
    self.currentTaskFailed = YES;
    return;
  }
  MDLog(@"Saved %@ to %@", self.currentFileName, destPath);

  // Emit final 100% progress for this file
  NSString *modelKey = self.currentModelKey ?: @"";
  NSString *fileName = self.currentFileName ?: @"";
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:@"onDownloadProgress"
                       body:@{@"modelKey": modelKey,
                              @"fileName": fileName,
                              @"progress": @1.0}];
  });
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
  if (error && error.code == NSURLErrorCancelled) {
    MDLog(@"Download cancelled for %@", self.currentFileName);
    return;
  }

  if (error) {
    MDLog(@"Network error for %@: %@ (code=%ld)", self.currentFileName, error.localizedDescription, (long)error.code);
    self.currentUrlIndex++;
    [self tryNextUrl];
    return;
  }

  if (self.currentTaskFailed) {
    // didFinishDownloadingToURL: flagged a non-2xx status → try next URL
    self.currentUrlIndex++;
    [self tryNextUrl];
    return;
  }

  // Successfully saved → advance to next file
  self.currentFileIndex++;
  [self downloadNextFile];
}

@end
