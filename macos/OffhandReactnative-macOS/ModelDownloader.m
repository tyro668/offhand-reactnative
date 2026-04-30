#import "ModelDownloader.h"
#import "AppPaths.h"
#import <Cocoa/Cocoa.h>

static NSString *const SherpaRuntimeKeySuffix = @"__sherpaRuntime";

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

static BOOL MDIsSherpaRuntimeKey(NSString *modelKey) {
  return [modelKey hasSuffix:SherpaRuntimeKeySuffix];
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
  if (MDIsSherpaRuntimeKey(modelKey)) {
    NSString *dir = [[self sherpaRuntimeRoot] stringByAppendingPathComponent:@"downloads"];
    [[NSFileManager defaultManager] createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
    return dir;
  }
  NSString *root = [[AppPaths appDataDirectory] stringByAppendingPathComponent:@"models"];
  NSString *dir = [root stringByAppendingPathComponent:modelKey ?: @"unknown"];
  [[NSFileManager defaultManager] createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
  return dir;
}

- (NSString *)sherpaRuntimeRoot {
  return [[AppPaths appDataDirectory] stringByAppendingPathComponent:@"sherpa-onnx/runtime"];
}

- (NSString *)sherpaRuntimeCurrentDirectory {
  return [[self sherpaRuntimeRoot] stringByAppendingPathComponent:@"current"];
}

- (BOOL)isSherpaRuntimeReady {
  NSString *libDir = [[self sherpaRuntimeCurrentDirectory] stringByAppendingPathComponent:@"lib"];
  NSString *cApi = [libDir stringByAppendingPathComponent:@"libsherpa-onnx-c-api.dylib"];
  BOOL hasCapi = [[NSFileManager defaultManager] fileExistsAtPath:cApi];
  NSArray<NSString *> *items =
      [[NSFileManager defaultManager] contentsOfDirectoryAtPath:libDir error:nil] ?: @[];
  BOOL hasOnnxRuntime = NO;
  for (NSString *item in items) {
    if ([item hasPrefix:@"libonnxruntime."] && [item hasSuffix:@".dylib"]) {
      hasOnnxRuntime = YES;
      break;
    }
  }
  return hasCapi && hasOnnxRuntime;
}

- (BOOL)installSherpaRuntimeArchive:(NSString *)archivePath error:(NSString **)errorOut {
  NSFileManager *fm = [NSFileManager defaultManager];
  NSString *root = [self sherpaRuntimeRoot];
  NSString *tmp = [root stringByAppendingPathComponent:@"installing"];
  NSString *current = [self sherpaRuntimeCurrentDirectory];

  [fm removeItemAtPath:tmp error:nil];
  if (![fm createDirectoryAtPath:tmp withIntermediateDirectories:YES attributes:nil error:nil]) {
    if (errorOut) *errorOut = [NSString stringWithFormat:@"Failed to create runtime temp dir: %@", tmp];
    return NO;
  }

  NSTask *task = [[NSTask alloc] init];
  task.launchPath = @"/usr/bin/tar";
  task.arguments = @[@"-xjf", archivePath, @"-C", tmp];
  NSPipe *pipe = [NSPipe pipe];
  task.standardOutput = pipe;
  task.standardError = pipe;

  NSError *launchError = nil;
  if (![task launchAndReturnError:&launchError]) {
    if (errorOut) *errorOut = launchError.localizedDescription ?: @"Failed to launch tar.";
    [fm removeItemAtPath:tmp error:nil];
    return NO;
  }
  [task waitUntilExit];
  NSData *outData = [[pipe fileHandleForReading] readDataToEndOfFile];
  NSString *tarOutput = [[NSString alloc] initWithData:outData encoding:NSUTF8StringEncoding] ?: @"";
  if (task.terminationStatus != 0) {
    if (errorOut) {
      *errorOut = [NSString stringWithFormat:@"Failed to extract Sherpa runtime: %@", tarOutput];
    }
    [fm removeItemAtPath:tmp error:nil];
    return NO;
  }

  NSArray<NSString *> *items = [fm contentsOfDirectoryAtPath:tmp error:nil] ?: @[];
  NSString *runtimeDir = nil;
  for (NSString *item in items) {
    NSString *candidate = [tmp stringByAppendingPathComponent:item];
    BOOL isDir = NO;
    if (![fm fileExistsAtPath:candidate isDirectory:&isDir] || !isDir) continue;
    NSString *cApi =
        [candidate stringByAppendingPathComponent:@"lib/libsherpa-onnx-c-api.dylib"];
    if ([fm fileExistsAtPath:cApi]) {
      runtimeDir = candidate;
      break;
    }
  }

  if (!runtimeDir) {
    if (errorOut) *errorOut = @"Extracted Sherpa runtime archive did not contain lib/libsherpa-onnx-c-api.dylib.";
    [fm removeItemAtPath:tmp error:nil];
    return NO;
  }

  [fm removeItemAtPath:current error:nil];
  NSError *moveError = nil;
  if (![fm moveItemAtPath:runtimeDir toPath:current error:&moveError]) {
    if (errorOut) *errorOut = moveError.localizedDescription ?: @"Failed to install Sherpa runtime.";
    [fm removeItemAtPath:tmp error:nil];
    return NO;
  }

  [fm removeItemAtPath:tmp error:nil];
  if (![self isSherpaRuntimeReady]) {
    if (errorOut) *errorOut = @"Installed Sherpa runtime is incomplete.";
    return NO;
  }
  MDLog(@"Installed Sherpa runtime to %@", current);
  return YES;
}

- (BOOL)installSherpaRuntimeIfNeededFromDirectory:(NSString *)dir error:(NSString **)errorOut {
  if ([self isSherpaRuntimeReady]) {
    return YES;
  }

  NSArray<NSString *> *items = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:dir error:nil] ?: @[];
  NSString *archivePath = nil;
  for (NSString *item in items) {
    if ([item hasSuffix:@".tar.bz2"]) {
      archivePath = [dir stringByAppendingPathComponent:item];
      break;
    }
  }
  if (!archivePath) {
    if (errorOut) *errorOut = [NSString stringWithFormat:@"Sherpa runtime archive not found in %@", dir];
    return NO;
  }
  return [self installSherpaRuntimeArchive:archivePath error:errorOut];
}

RCT_EXPORT_METHOD(downloadModelFiles:(NSString *)modelKey
                  files:(NSArray<NSDictionary *> *)files
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
  MDLog(@"downloadModelFiles called: modelKey=%@ files=%lu", modelKey, (unsigned long)files.count);

  NSString *modelDir = [self modelDirectoryForKey:modelKey];
  MDLog(@"modelDir=%@", modelDir);
  BOOL isRuntimeDownload = MDIsSherpaRuntimeKey(modelKey);

  if (isRuntimeDownload && [self isSherpaRuntimeReady]) {
    MDLog(@"Sherpa runtime already installed, skipping download");
    dispatch_async(dispatch_get_main_queue(), ^{
      [self sendEventWithName:@"onDownloadComplete"
                         body:@{@"modelKey": modelKey ?: @"",
                                @"success": @YES,
                                @"path": [self sherpaRuntimeCurrentDirectory]}];
    });
    resolve(@{@"path": [self sherpaRuntimeCurrentDirectory], @"status": @"already_downloaded"});
    return;
  }

  // Check if already downloaded (all files exist with non-zero size).
  // For tokens.txt files we additionally require a plausible (text-shaped, <50MB)
  // body so corrupt previous downloads do not get reused.
  BOOL allExist = files.count > 0;
  for (NSDictionary *file in files) {
    NSString *name = file[@"name"];
    NSString *path = [modelDir stringByAppendingPathComponent:name];
    NSDictionary *attrs = [[NSFileManager defaultManager] attributesOfItemAtPath:path error:nil];
    long long sz = attrs ? [attrs[NSFileSize] longLongValue] : 0;
    if (!attrs || sz <= 0) {
      allExist = NO;
      break;
    }
    if ([name.lowercaseString hasSuffix:@"tokens.txt"] && sz > 50LL * 1024LL * 1024LL) {
      MDLog(@"Existing tokens file %@ is implausibly large (%lld bytes); will re-download",
            path, sz);
      [[NSFileManager defaultManager] removeItemAtPath:path error:nil];
      allExist = NO;
      break;
    }
  }
  if (allExist) {
    MDLog(@"All files already exist, skipping download");
    if (isRuntimeDownload) {
      NSString *installError = nil;
      BOOL installed = [self installSherpaRuntimeIfNeededFromDirectory:modelDir error:&installError];
      dispatch_async(dispatch_get_main_queue(), ^{
        [self sendEventWithName:@"onDownloadComplete"
                           body:@{@"modelKey": modelKey ?: @"",
                                  @"success": @(installed),
                                  @"path": installed ? [self sherpaRuntimeCurrentDirectory] : modelDir,
                                  @"error": installError ?: @""}];
      });
      resolve(@{@"path": installed ? [self sherpaRuntimeCurrentDirectory] : modelDir,
                @"status": installed ? @"already_downloaded" : @"failed"});
      return;
    }
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
    if (MDIsSherpaRuntimeKey(self.currentModelKey)) {
      NSString *installError = nil;
      BOOL installed = [self installSherpaRuntimeIfNeededFromDirectory:modelDir error:&installError];
      dispatch_async(dispatch_get_main_queue(), ^{
        [self sendEventWithName:@"onDownloadComplete"
                           body:@{@"modelKey": self.currentModelKey ?: @"",
                                  @"success": @(installed),
                                  @"path": installed ? [self sherpaRuntimeCurrentDirectory] : modelDir,
                                  @"error": installError ?: @""}];
      });
      return;
    }
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
  long long expectedBytes = downloadTask.countOfBytesExpectedToReceive;
  long long receivedBytes = downloadTask.countOfBytesReceived;
  MDLog(@"didFinishDownloading: %@ status=%ld expected=%lld received=%lld → %@",
        self.currentFileName, (long)status, expectedBytes, receivedBytes, location.path);

  if (status < 200 || status >= 300) {
    // Non-2xx: treat as failure, advance to next URL. Do NOT move the body.
    MDLog(@"HTTP %ld for %@, will try next URL", (long)status, self.currentFileName);
    self.currentTaskFailed = YES;
    [[NSFileManager defaultManager] removeItemAtURL:location error:nil];
    return;
  }

  // Validate that the body fully matches the advertised length. NSURLSession
  // can otherwise hand us a truncated download and call this method as if it
  // had succeeded, which leads to corrupt model files on disk.
  if (expectedBytes > 0 && receivedBytes != expectedBytes) {
    MDLog(@"Size mismatch for %@: received=%lld expected=%lld; will retry next URL",
          self.currentFileName, receivedBytes, expectedBytes);
    self.currentTaskFailed = YES;
    [[NSFileManager defaultManager] removeItemAtURL:location error:nil];
    return;
  }

  NSString *modelDir = [self modelDirectoryForKey:self.currentModelKey];
  NSString *fileName = self.currentFileName ?: @"file";
  NSString *destPath = [modelDir stringByAppendingPathComponent:fileName];
  [[NSFileManager defaultManager] removeItemAtPath:destPath error:nil];
  NSError *moveError = nil;
  if (![[NSFileManager defaultManager] moveItemAtPath:location.path toPath:destPath error:&moveError]) {
    MDLog(@"Failed to move downloaded file to %@: %@", destPath, moveError.localizedDescription);
    self.currentTaskFailed = YES;
    return;
  }

  // Lightweight content sanity check: tokens.txt must be plain text and small.
  // If the upstream mirror swaps content (e.g. returns model bytes for a
  // tokens.txt URL), reject the file rather than persist a corrupt model.
  if ([fileName.lowercaseString hasSuffix:@"tokens.txt"]) {
    NSDictionary *attrs = [[NSFileManager defaultManager] attributesOfItemAtPath:destPath error:nil];
    long long sz = [attrs[NSFileSize] longLongValue];
    BOOL textOk = sz > 0 && sz <= 50LL * 1024LL * 1024LL;
    if (textOk) {
      NSFileHandle *fh = [NSFileHandle fileHandleForReadingAtPath:destPath];
      NSData *head = [fh readDataOfLength:256];
      [fh closeFile];
      const uint8_t *b = (const uint8_t *)head.bytes;
      for (NSUInteger i = 0; i < head.length; i++) {
        uint8_t c = b[i];
        if (c == 0 || c < 0x09 || (c > 0x0D && c < 0x20)) { textOk = NO; break; }
      }
    }
    if (!textOk) {
      MDLog(@"Downloaded tokens file looks corrupt at %@ (size=%lld); discarding and retrying",
            destPath, sz);
      [[NSFileManager defaultManager] removeItemAtPath:destPath error:nil];
      self.currentTaskFailed = YES;
      return;
    }
  }

  MDLog(@"Saved %@ to %@", fileName, destPath);

  // Emit final 100% progress for this file
  NSString *modelKey = self.currentModelKey ?: @"";
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
