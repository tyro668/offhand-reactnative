#import "SherpaTranscriber.h"
#import "AppPaths.h"
#import <Foundation/Foundation.h>
#import <React/RCTLog.h>
#import <signal.h>
#import <unistd.h>

// Sherpa transcription is performed in a dedicated child process, started by
// re-execing the app's own binary with `--sherpa-helper`. The child is the only
// process that loads sherpa-onnx + ONNX Runtime, so killing it on idle timeout
// returns all inference memory to the kernel.

static void STLog(NSString *format, ...) {
  va_list args;
  va_start(args, format);
  NSString *msg = [[NSString alloc] initWithFormat:format arguments:args];
  va_end(args);

  NSDateFormatter *fmt = [[NSDateFormatter alloc] init];
  fmt.dateFormat = @"yyyy-MM-dd HH:mm:ss";
  NSString *line =
      [NSString stringWithFormat:@"[ST] %@ %@\n", [fmt stringFromDate:[NSDate date]], msg];

  NSLog(@"%@", line);

  NSString *logPath = [AppPaths logFilePath];
  NSFileHandle *fh = [NSFileHandle fileHandleForWritingAtPath:logPath];
  if (!fh) {
    [line writeToFile:logPath atomically:NO encoding:NSUTF8StringEncoding error:nil];
  } else {
    [fh seekToEndOfFile];
    [fh writeData:[line dataUsingEncoding:NSUTF8StringEncoding]];
    [fh closeFile];
  }
}

@interface SherpaTranscriber ()
@property (nonatomic, strong) dispatch_queue_t workQueue;
@property (nonatomic, assign) double idleReleaseTimeoutMs;
@property (nonatomic, assign) NSInteger activeTranscriptions;
@property (nonatomic, strong) dispatch_source_t idleReleaseTimer;
@property (nonatomic, strong) NSTask *helperTask;
@property (nonatomic, strong) NSPipe *helperStdin;
@property (nonatomic, strong) NSPipe *helperStdout;
@property (nonatomic, strong) NSPipe *helperStderr;
@property (nonatomic, strong) NSMutableData *helperStdoutBuffer;
@end

@implementation SherpaTranscriber

RCT_EXPORT_MODULE();

static const double STDefaultIdleReleaseTimeoutMs = 3.0 * 60.0 * 1000.0;

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (instancetype)init {
  self = [super init];
  if (self) {
    _idleReleaseTimeoutMs = STDefaultIdleReleaseTimeoutMs;
    _activeTranscriptions = 0;
  }
  return self;
}

- (dispatch_queue_t)methodQueue {
  if (!self.workQueue) {
    self.workQueue =
        dispatch_queue_create("com.offhand.sherpa.transcriber", DISPATCH_QUEUE_SERIAL);
  }
  return self.workQueue;
}

- (void)dealloc {
  [self cancelIdleReleaseTimer];
  [self killHelperWithReason:@"dealloc"];
}

#pragma mark - Path helpers

+ (NSString *)runtimeCurrentDir {
  return [[[AppPaths appDataDirectory] stringByAppendingPathComponent:@"sherpa-onnx/runtime"]
      stringByAppendingPathComponent:@"current"];
}

+ (NSString *)runtimeLibDir {
  return [[SherpaTranscriber runtimeCurrentDir] stringByAppendingPathComponent:@"lib"];
}

+ (NSString *)sherpaLibraryPath {
  return [[SherpaTranscriber runtimeLibDir] stringByAppendingPathComponent:@"libsherpa-onnx-c-api.dylib"];
}

+ (NSString *)onnxRuntimeLibraryPath {
  NSString *libDir = [SherpaTranscriber runtimeLibDir];
  NSArray<NSString *> *items =
      [[NSFileManager defaultManager] contentsOfDirectoryAtPath:libDir error:nil] ?: @[];
  for (NSString *item in items) {
    if ([item hasPrefix:@"libonnxruntime."] && [item hasSuffix:@".dylib"]) {
      return [libDir stringByAppendingPathComponent:item];
    }
  }
  return nil;
}

+ (BOOL)isRuntimeReadyAtPath {
  NSString *sherpa = [SherpaTranscriber sherpaLibraryPath];
  NSString *onnx = [SherpaTranscriber onnxRuntimeLibraryPath];
  return [[NSFileManager defaultManager] fileExistsAtPath:sherpa] &&
         onnx.length > 0 &&
         [[NSFileManager defaultManager] fileExistsAtPath:onnx];
}

+ (NSString *)modelDirForKey:(NSString *)modelKey {
  NSString *root = [[AppPaths appDataDirectory] stringByAppendingPathComponent:@"models"];
  return [root stringByAppendingPathComponent:modelKey ?: @""];
}

+ (NSString *)whisperPrefixForKey:(NSString *)modelKey {
  if ([modelKey isEqualToString:@"whisperTiny"]) return @"tiny";
  if ([modelKey isEqualToString:@"whisperBase"]) return @"base";
  if ([modelKey isEqualToString:@"whisperSmall"]) return @"small";
  if ([modelKey isEqualToString:@"whisperMedium"]) return @"medium";
  if ([modelKey isEqualToString:@"whisperLarge"]) return @"large-v3";
  return nil;
}

+ (NSString *)senseVoiceModelFileForKey:(NSString *)modelKey {
  if ([modelKey isEqualToString:@"senseVoiceLarge"]) return @"model.onnx";
  return @"model.int8.onnx";
}

+ (NSString *)normalizeLanguage:(NSString *)language forEngine:(NSString *)engine {
  (void)engine;
  NSString *l = (language ?: @"auto").lowercaseString;
  if ([l isEqualToString:@"asrlanguageauto"] || [l isEqualToString:@"auto"] || l.length == 0) {
    return @"auto";
  }
  if ([l isEqualToString:@"asrlanguagezh"] || [l hasPrefix:@"zh"]) return @"zh";
  if ([l isEqualToString:@"asrlanguageen"] || [l hasPrefix:@"en"]) return @"en";
  return l;
}

#pragma mark - Helper subprocess

- (BOOL)isHelperAlive {
  return self.helperTask != nil && self.helperTask.isRunning;
}

- (void)killHelperWithReason:(NSString *)reason {
  [self cancelIdleReleaseTimer];
  NSTask *task = self.helperTask;
  if (!task) {
    return;
  }

  STLog(@"killing sherpa helper (%@) pid=%d", reason ?: @"manual", task.processIdentifier);
  self.helperStderr.fileHandleForReading.readabilityHandler = nil;

  @try {
    NSFileHandle *input = self.helperStdin.fileHandleForWriting;
    NSData *data = [@"{\"cmd\":\"shutdown\"}\n" dataUsingEncoding:NSUTF8StringEncoding];
    [input writeData:data];
    [input closeFile];
  } @catch (NSException *exception) {
    STLog(@"helper graceful shutdown failed: %@", exception.reason ?: exception.name);
  }

  for (int i = 0; i < 5 && task.isRunning; i++) {
    usleep(50 * 1000);
  }
  if (task.isRunning) {
    @try { [task terminate]; } @catch (NSException *e) { (void)e; }
  }
  for (int i = 0; i < 10 && task.isRunning; i++) {
    usleep(50 * 1000);
  }
  if (task.isRunning) {
    kill(task.processIdentifier, SIGKILL);
  }

  self.helperTask = nil;
  self.helperStdin = nil;
  self.helperStdout = nil;
  self.helperStderr = nil;
  self.helperStdoutBuffer = nil;
}

- (BOOL)startHelperWithError:(NSString **)errorOut {
  if ([self isHelperAlive]) {
    return YES;
  }

  NSString *exePath = NSBundle.mainBundle.executablePath;
  if (exePath.length == 0 || ![NSFileManager.defaultManager fileExistsAtPath:exePath]) {
    if (errorOut) *errorOut = @"Cannot locate app executable to start sherpa helper.";
    return NO;
  }

  NSTask *task = [[NSTask alloc] init];
  task.executableURL = [NSURL fileURLWithPath:exePath];
  task.arguments = @[@"--sherpa-helper"];

  NSPipe *stdinPipe = [NSPipe pipe];
  NSPipe *stdoutPipe = [NSPipe pipe];
  NSPipe *stderrPipe = [NSPipe pipe];
  task.standardInput = stdinPipe;
  task.standardOutput = stdoutPipe;
  task.standardError = stderrPipe;

  stderrPipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *fh) {
    NSData *data = fh.availableData;
    if (data.length == 0) return;
    NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"";
    for (NSString *line in [text componentsSeparatedByString:@"\n"]) {
      if (line.length > 0) STLog(@"helper: %@", line);
    }
  };

  __weak SherpaTranscriber *weakSelf = self;
  task.terminationHandler = ^(NSTask *terminatedTask) {
    SherpaTranscriber *strongSelf = weakSelf;
    STLog(@"sherpa helper exited status=%d reason=%ld",
          terminatedTask.terminationStatus, (long)terminatedTask.terminationReason);
    if (!strongSelf) return;
    dispatch_async([strongSelf methodQueue], ^{
      if (strongSelf.helperTask == terminatedTask) {
        strongSelf.helperStderr.fileHandleForReading.readabilityHandler = nil;
        strongSelf.helperTask = nil;
        strongSelf.helperStdin = nil;
        strongSelf.helperStdout = nil;
        strongSelf.helperStderr = nil;
        strongSelf.helperStdoutBuffer = nil;
      }
    });
  };

  NSError *launchError = nil;
  if (![task launchAndReturnError:&launchError]) {
    stderrPipe.fileHandleForReading.readabilityHandler = nil;
    if (errorOut) {
      *errorOut = [NSString stringWithFormat:@"Failed to launch sherpa helper: %@",
                                             launchError.localizedDescription ?: @"unknown error"];
    }
    return NO;
  }

  self.helperTask = task;
  self.helperStdin = stdinPipe;
  self.helperStdout = stdoutPipe;
  self.helperStderr = stderrPipe;
  self.helperStdoutBuffer = [NSMutableData data];
  STLog(@"sherpa helper launched pid=%d", task.processIdentifier);
  return YES;
}

- (NSDictionary *)sendRequest:(NSDictionary *)request errorOut:(NSString **)errorOut {
  NSError *jsonError = nil;
  NSData *payload = [NSJSONSerialization dataWithJSONObject:request options:0 error:&jsonError];
  if (!payload) {
    if (errorOut) {
      *errorOut = [NSString stringWithFormat:@"request encode failed: %@",
                                             jsonError.localizedDescription ?: @""];
    }
    return nil;
  }

  NSMutableData *line = [payload mutableCopy];
  [line appendBytes:"\n" length:1];

  @try {
    [self.helperStdin.fileHandleForWriting writeData:line];
  } @catch (NSException *exception) {
    if (errorOut) {
      *errorOut = [NSString stringWithFormat:@"helper stdin write failed: %@",
                                             exception.reason ?: exception.name];
    }
    [self killHelperWithReason:@"stdin write failed"];
    return nil;
  }

  NSFileHandle *output = self.helperStdout.fileHandleForReading;
  NSMutableData *buffer = self.helperStdoutBuffer ?: [NSMutableData data];
  self.helperStdoutBuffer = buffer;

  while (YES) {
    const uint8_t *bytes = (const uint8_t *)buffer.bytes;
    NSUInteger newlineIndex = NSNotFound;
    for (NSUInteger i = 0; i < buffer.length; i++) {
      if (bytes[i] == '\n') {
        newlineIndex = i;
        break;
      }
    }

    if (newlineIndex != NSNotFound) {
      NSData *jsonData = [buffer subdataWithRange:NSMakeRange(0, newlineIndex)];
      [buffer replaceBytesInRange:NSMakeRange(0, newlineIndex + 1) withBytes:NULL length:0];
      NSError *parseError = nil;
      id obj = [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:&parseError];
      if (![obj isKindOfClass:NSDictionary.class]) {
        if (errorOut) {
          *errorOut = [NSString stringWithFormat:@"helper response parse failed: %@",
                                                 parseError.localizedDescription ?: @"non-dict response"];
        }
        return nil;
      }
      return obj;
    }

    NSData *chunk = nil;
    @try {
      chunk = [output availableData];
    } @catch (NSException *exception) {
      if (errorOut) {
        *errorOut = [NSString stringWithFormat:@"helper stdout read failed: %@",
                                               exception.reason ?: exception.name];
      }
      [self killHelperWithReason:@"stdout read failed"];
      return nil;
    }

    if (chunk.length == 0) {
      if (errorOut) *errorOut = @"helper closed stdout unexpectedly";
      [self killHelperWithReason:@"helper EOF"];
      return nil;
    }
    [buffer appendData:chunk];
  }
}

#pragma mark - Idle release

- (void)cancelIdleReleaseTimer {
  if (self.idleReleaseTimer) {
    dispatch_source_cancel(self.idleReleaseTimer);
    self.idleReleaseTimer = nil;
  }
}

- (void)scheduleIdleReleaseIfNeeded {
  [self cancelIdleReleaseTimer];
  if (self.activeTranscriptions > 0 || ![self isHelperAlive]) {
    return;
  }

  double timeoutMs = self.idleReleaseTimeoutMs;
  if (timeoutMs <= 0) {
    return;
  }

  dispatch_queue_t queue = [self methodQueue];
  dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, queue);
  int64_t delayNs = (int64_t)(timeoutMs * (double)NSEC_PER_MSEC);
  dispatch_source_set_timer(timer,
                            dispatch_time(DISPATCH_TIME_NOW, delayNs),
                            DISPATCH_TIME_FOREVER,
                            5 * NSEC_PER_SEC);

  __weak SherpaTranscriber *weakSelf = self;
  dispatch_source_set_event_handler(timer, ^{
    SherpaTranscriber *strongSelf = weakSelf;
    if (!strongSelf) return;
    if (strongSelf.activeTranscriptions == 0) {
      [strongSelf killHelperWithReason:@"idle timeout"];
    }
  });

  self.idleReleaseTimer = timer;
  dispatch_resume(timer);
  STLog(@"scheduled Sherpa helper kill in %.0f ms", timeoutMs);
}

#pragma mark - JS API

RCT_EXPORT_METHOD(isRuntimeReady:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  resolve(@([SherpaTranscriber isRuntimeReadyAtPath]));
}

RCT_EXPORT_METHOD(isModelReady:(NSString *)engine
                  modelKey:(NSString *)modelKey
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  NSString *modelDir = [SherpaTranscriber modelDirForKey:modelKey];
  NSFileManager *fm = NSFileManager.defaultManager;
  BOOL ready = NO;
  if ([engine isEqualToString:@"sensevoice"]) {
    NSString *modelFile = [SherpaTranscriber senseVoiceModelFileForKey:modelKey];
    ready = [fm fileExistsAtPath:[modelDir stringByAppendingPathComponent:modelFile]] &&
            [fm fileExistsAtPath:[modelDir stringByAppendingPathComponent:@"tokens.txt"]];
  } else if ([engine isEqualToString:@"whisper"]) {
    NSString *prefix = [SherpaTranscriber whisperPrefixForKey:modelKey];
    if (prefix) {
      ready =
          [fm fileExistsAtPath:[modelDir stringByAppendingPathComponent:[NSString stringWithFormat:@"%@-encoder.int8.onnx", prefix]]] &&
          [fm fileExistsAtPath:[modelDir stringByAppendingPathComponent:[NSString stringWithFormat:@"%@-decoder.int8.onnx", prefix]]] &&
          [fm fileExistsAtPath:[modelDir stringByAppendingPathComponent:[NSString stringWithFormat:@"%@-tokens.txt", prefix]]];
    }
  }
  resolve(@(ready));
}

RCT_EXPORT_METHOD(setIdleReleaseTimeoutMs:(nonnull NSNumber *)timeoutMs
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  double nextTimeoutMs = timeoutMs ? [timeoutMs doubleValue] : STDefaultIdleReleaseTimeoutMs;
  if (nextTimeoutMs != nextTimeoutMs || nextTimeoutMs < 0) {
    nextTimeoutMs = STDefaultIdleReleaseTimeoutMs;
  }
  self.idleReleaseTimeoutMs = nextTimeoutMs;
  STLog(@"Sherpa idle release timeout set to %.0f ms", self.idleReleaseTimeoutMs);
  [self scheduleIdleReleaseIfNeeded];
  resolve(@YES);
}

RCT_EXPORT_METHOD(transcribeFile:(NSString *)filePath
                  engine:(NSString *)engine
                  modelKey:(NSString *)modelKey
                  language:(NSString *)language
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  if (filePath.length == 0) {
    reject(@"sherpa_no_file", @"Audio file path is empty.", nil);
    return;
  }
  if (![NSFileManager.defaultManager fileExistsAtPath:filePath]) {
    reject(@"sherpa_no_file",
           [NSString stringWithFormat:@"Audio file not found: %@", filePath], nil);
    return;
  }
  if (![SherpaTranscriber isRuntimeReadyAtPath]) {
    reject(@"sherpa_runtime_missing",
           [NSString stringWithFormat:
                @"Sherpa runtime is not downloaded. Please download a model in ASR settings first. Runtime path: %@",
                [SherpaTranscriber runtimeCurrentDir]],
           nil);
    return;
  }

  self.activeTranscriptions += 1;
  [self cancelIdleReleaseTimer];
  __block BOOL finished = NO;
  void (^finish)(void) = ^{
    if (finished) return;
    finished = YES;
    if (self.activeTranscriptions > 0) self.activeTranscriptions -= 1;
    [self scheduleIdleReleaseIfNeeded];
  };

  NSString *normalizedLang = [SherpaTranscriber normalizeLanguage:language forEngine:engine];
  STLog(@"transcribeFile engine=%@ modelKey=%@ lang=%@ file=%@",
        engine, modelKey, normalizedLang, filePath);

  NSString *startError = nil;
  if (![self startHelperWithError:&startError]) {
    STLog(@"start helper failed: %@", startError);
    finish();
    reject(@"sherpa_helper_start_failed",
           startError ?: @"Failed to start sherpa helper.", nil);
    return;
  }

  NSDictionary *request = @{
    @"cmd": @"transcribe",
    @"runtimeDir": [SherpaTranscriber runtimeCurrentDir],
    @"engine": engine ?: @"",
    @"modelKey": modelKey ?: @"",
    @"modelDir": [SherpaTranscriber modelDirForKey:modelKey],
    @"language": normalizedLang,
    @"filePath": filePath,
  };

  NSString *requestError = nil;
  NSDictionary *response = [self sendRequest:request errorOut:&requestError];
  if (!response) {
    finish();
    reject(@"sherpa_helper_failed",
           requestError ?: @"Sherpa helper communication failed.", nil);
    return;
  }

  if (![response[@"ok"] boolValue]) {
    NSString *errorText = response[@"error"];
    finish();
    reject(@"sherpa_helper_error",
           errorText.length > 0 ? errorText : @"Sherpa helper reported an error.", nil);
    return;
  }

  NSString *text = response[@"text"];
  if (![text isKindOfClass:NSString.class]) {
    text = @"";
  }
  STLog(@"transcribed text length=%lu", (unsigned long)text.length);

  finish();
  resolve(text);
}

@end
