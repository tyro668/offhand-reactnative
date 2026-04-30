#import "SherpaTranscriber.h"
#import "AppPaths.h"
#import <Foundation/Foundation.h>
#import <React/RCTLog.h>
#import <sherpa-onnx/c-api/c-api.h>
#import <dlfcn.h>

#import <string>

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

struct SherpaOnnxApi {
  const SherpaOnnxOfflineRecognizer *(*CreateOfflineRecognizer)(
      const SherpaOnnxOfflineRecognizerConfig *config);
  void (*DestroyOfflineRecognizer)(const SherpaOnnxOfflineRecognizer *recognizer);
  const SherpaOnnxOfflineStream *(*CreateOfflineStream)(
      const SherpaOnnxOfflineRecognizer *recognizer);
  void (*DestroyOfflineStream)(const SherpaOnnxOfflineStream *stream);
  void (*AcceptWaveformOffline)(const SherpaOnnxOfflineStream *stream,
                                int32_t sample_rate,
                                const float *samples,
                                int32_t n);
  void (*OfflineStreamSetOption)(const SherpaOnnxOfflineStream *stream,
                                 const char *key,
                                 const char *value);
  void (*DecodeOfflineStream)(const SherpaOnnxOfflineRecognizer *recognizer,
                              const SherpaOnnxOfflineStream *stream);
  const SherpaOnnxOfflineRecognizerResult *(*GetOfflineStreamResult)(
      const SherpaOnnxOfflineStream *stream);
  void (*DestroyOfflineRecognizerResult)(
      const SherpaOnnxOfflineRecognizerResult *r);
  const SherpaOnnxWave *(*ReadWave)(const char *filename);
  void (*FreeWave)(const SherpaOnnxWave *wave);
};

@interface SherpaTranscriber () {
  const SherpaOnnxOfflineRecognizer *_recognizer;
  void *_onnxRuntimeHandle;
  void *_sherpaHandle;
  SherpaOnnxApi _api;
}
@property (nonatomic, copy) NSString *cachedKey;
@property (nonatomic, strong) dispatch_queue_t workQueue;
@end

@implementation SherpaTranscriber

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (dispatch_queue_t)methodQueue {
  if (!self.workQueue) {
    self.workQueue =
        dispatch_queue_create("com.offhand.sherpa.transcriber", DISPATCH_QUEUE_SERIAL);
  }
  return self.workQueue;
}

- (void)dealloc {
  if (_recognizer) {
    if (_api.DestroyOfflineRecognizer) {
      _api.DestroyOfflineRecognizer(_recognizer);
    }
    _recognizer = nullptr;
  }
  [self unloadRuntime];
}

- (void)unloadRuntime {
  if (_sherpaHandle) {
    dlclose(_sherpaHandle);
    _sherpaHandle = nullptr;
  }
  if (_onnxRuntimeHandle) {
    dlclose(_onnxRuntimeHandle);
    _onnxRuntimeHandle = nullptr;
  }
  memset(&_api, 0, sizeof(_api));
}

#pragma mark - Helpers

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

- (BOOL)loadSymbol:(void **)target name:(const char *)name error:(NSString **)errorOut {
  dlerror();
  *target = dlsym(_sherpaHandle, name);
  const char *err = dlerror();
  if (err || !*target) {
    if (errorOut) {
      *errorOut = [NSString stringWithFormat:@"Sherpa runtime is missing symbol %s: %s",
                                             name, err ?: "not found"];
    }
    return NO;
  }
  return YES;
}

- (BOOL)ensureRuntimeLoaded:(NSString **)errorOut {
  if (_sherpaHandle) {
    return YES;
  }

  if (![SherpaTranscriber isRuntimeReadyAtPath]) {
    if (errorOut) {
      *errorOut = [NSString stringWithFormat:
          @"Sherpa runtime is not downloaded. Please download a SenseVoice or Whisper model in ASR settings first. Runtime path: %@",
          [SherpaTranscriber runtimeCurrentDir]];
    }
    return NO;
  }

  NSString *onnxPath = [SherpaTranscriber onnxRuntimeLibraryPath];
  if (onnxPath.length > 0) {
    _onnxRuntimeHandle = dlopen(onnxPath.UTF8String, RTLD_NOW | RTLD_GLOBAL);
    if (!_onnxRuntimeHandle) {
      if (errorOut) {
        *errorOut = [NSString stringWithFormat:@"Failed to load ONNX Runtime at %@: %s",
                                               onnxPath, dlerror()];
      }
      return NO;
    }
  }

  NSString *sherpaPath = [SherpaTranscriber sherpaLibraryPath];
  _sherpaHandle = dlopen(sherpaPath.UTF8String, RTLD_NOW | RTLD_LOCAL);
  if (!_sherpaHandle) {
    if (errorOut) {
      *errorOut = [NSString stringWithFormat:@"Failed to load Sherpa runtime at %@: %s",
                                             sherpaPath, dlerror()];
    }
    if (_onnxRuntimeHandle) {
      dlclose(_onnxRuntimeHandle);
      _onnxRuntimeHandle = nullptr;
    }
    return NO;
  }

#define LOAD_SHERPA_SYMBOL(field, symbol)                                      \
  if (![self loadSymbol:(void **)&_api.field name:symbol error:errorOut]) {    \
    [self unloadRuntime];                                                      \
    return NO;                                                                 \
  }
  LOAD_SHERPA_SYMBOL(CreateOfflineRecognizer, "SherpaOnnxCreateOfflineRecognizer");
  LOAD_SHERPA_SYMBOL(DestroyOfflineRecognizer, "SherpaOnnxDestroyOfflineRecognizer");
  LOAD_SHERPA_SYMBOL(CreateOfflineStream, "SherpaOnnxCreateOfflineStream");
  LOAD_SHERPA_SYMBOL(DestroyOfflineStream, "SherpaOnnxDestroyOfflineStream");
  LOAD_SHERPA_SYMBOL(AcceptWaveformOffline, "SherpaOnnxAcceptWaveformOffline");
  LOAD_SHERPA_SYMBOL(OfflineStreamSetOption, "SherpaOnnxOfflineStreamSetOption");
  LOAD_SHERPA_SYMBOL(DecodeOfflineStream, "SherpaOnnxDecodeOfflineStream");
  LOAD_SHERPA_SYMBOL(GetOfflineStreamResult, "SherpaOnnxGetOfflineStreamResult");
  LOAD_SHERPA_SYMBOL(DestroyOfflineRecognizerResult, "SherpaOnnxDestroyOfflineRecognizerResult");
  LOAD_SHERPA_SYMBOL(ReadWave, "SherpaOnnxReadWave");
  LOAD_SHERPA_SYMBOL(FreeWave, "SherpaOnnxFreeWave");
#undef LOAD_SHERPA_SYMBOL

  STLog(@"Sherpa runtime loaded from %@", sherpaPath);
  return YES;
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
  // senseVoiceSmall = quantized; senseVoiceLarge = full precision
  if ([modelKey isEqualToString:@"senseVoiceLarge"]) return @"model.onnx";
  return @"model.int8.onnx";
}

+ (long long)fileSizeAtPath:(NSString *)path {
  NSDictionary *attrs = [NSFileManager.defaultManager attributesOfItemAtPath:path error:nil];
  if (!attrs) return -1;
  return [attrs[NSFileSize] longLongValue];
}

+ (BOOL)looksLikeTokensFileAtPath:(NSString *)path {
  // Tokens files are line-oriented UTF-8 text. Real ones are <50MB; ours is ~309KB.
  // Reject anything obviously binary or implausibly large.
  long long size = [self fileSizeAtPath:path];
  if (size <= 0) return NO;
  if (size > 50LL * 1024LL * 1024LL) return NO;  // > 50MB → not a tokens file

  NSFileHandle *fh = [NSFileHandle fileHandleForReadingAtPath:path];
  if (!fh) return NO;
  NSData *head = [fh readDataOfLength:512];
  [fh closeFile];
  if (head.length == 0) return NO;

  const uint8_t *bytes = (const uint8_t *)head.bytes;
  for (NSUInteger i = 0; i < head.length; i++) {
    uint8_t b = bytes[i];
    if (b == 0) return NO;          // NUL → binary
    // Tokens files use ASCII tokens + UTF-8 continuation bytes; reject obvious
    // ONNX/protobuf headers (control bytes outside whitespace).
    if (b < 0x09) return NO;
    if (b > 0x0D && b < 0x20) return NO;
  }
  return YES;
}

+ (BOOL)looksLikeOnnxFileAtPath:(NSString *)path minBytes:(long long)minBytes {
  long long size = [self fileSizeAtPath:path];
  if (size < minBytes) return NO;
  NSFileHandle *fh = [NSFileHandle fileHandleForReadingAtPath:path];
  if (!fh) return NO;
  NSData *head = [fh readDataOfLength:32];
  [fh closeFile];
  if (head.length < 8) return NO;
  // ONNX files are protobuf — they start with field-tag bytes (typically 0x08
  // for varint or 0x12 for length-delimited). The current shipping models we
  // care about begin with bytes that include "onnx" near the head; we just
  // require a non-text leading byte plus a recognisable signature within the
  // first 32 bytes.
  const char *needle = "onnx";
  for (NSInteger i = 0; i + 4 <= (NSInteger)head.length; i++) {
    if (memcmp((const char *)head.bytes + i, needle, 4) == 0) return YES;
  }
  // Fallback: protobuf-ish first byte
  uint8_t first = ((const uint8_t *)head.bytes)[0];
  return first == 0x08 || first == 0x12;
}

+ (NSString *)normalizeLanguage:(NSString *)language forEngine:(NSString *)engine {
  NSString *l = (language ?: @"auto").lowercaseString;
  if ([l isEqualToString:@"asrlanguageauto"] || [l isEqualToString:@"auto"] || l.length == 0) {
    return @"auto";
  }
  if ([l isEqualToString:@"asrlanguagezh"] || [l hasPrefix:@"zh"]) return @"zh";
  if ([l isEqualToString:@"asrlanguageen"] || [l hasPrefix:@"en"]) return @"en";
  return l;
}

#pragma mark - Recognizer build

- (BOOL)ensureRecognizerForEngine:(NSString *)engine
                         modelKey:(NSString *)modelKey
                         language:(NSString *)language
                            error:(NSString **)errorOut {
  if (![self ensureRuntimeLoaded:errorOut]) {
    return NO;
  }

  NSString *cacheKey = [NSString stringWithFormat:@"%@|%@|%@", engine, modelKey, language];
  if (_recognizer && [self.cachedKey isEqualToString:cacheKey]) {
    return YES;
  }

  if (_recognizer) {
    _api.DestroyOfflineRecognizer(_recognizer);
    _recognizer = nullptr;
    self.cachedKey = nil;
  }

  NSString *modelDir = [SherpaTranscriber modelDirForKey:modelKey];
  NSFileManager *fm = NSFileManager.defaultManager;
  if (![fm fileExistsAtPath:modelDir]) {
    if (errorOut) {
      *errorOut = [NSString stringWithFormat:@"Model directory not found: %@", modelDir];
    }
    return NO;
  }

  // Persist std::string for paths so the C-API pointers remain valid for the duration
  // of SherpaOnnxCreateOfflineRecognizer().
  std::string tokensStr;
  std::string modelStr;
  std::string encoderStr;
  std::string decoderStr;
  std::string langStr = [language UTF8String] ?: "";
  std::string taskStr = "transcribe";
  std::string decodingStr = "greedy_search";
  std::string providerStr = "cpu";

  SherpaOnnxOfflineRecognizerConfig config;
  memset(&config, 0, sizeof(config));
  config.feat_config.sample_rate = 16000;
  config.feat_config.feature_dim = 80;
  config.model_config.num_threads = 1;
  config.model_config.debug = 0;
  config.model_config.provider = providerStr.c_str();
  config.decoding_method = decodingStr.c_str();
  config.max_active_paths = 4;

  if ([engine isEqualToString:@"sensevoice"]) {
    NSString *modelFile = [SherpaTranscriber senseVoiceModelFileForKey:modelKey];
    NSString *modelPath = [modelDir stringByAppendingPathComponent:modelFile];
    NSString *tokensPath = [modelDir stringByAppendingPathComponent:@"tokens.txt"];
    if (![fm fileExistsAtPath:modelPath] || ![fm fileExistsAtPath:tokensPath]) {
      if (errorOut) {
        *errorOut = [NSString
            stringWithFormat:@"Missing SenseVoice files at %@ (need %@ and tokens.txt)",
                             modelDir, modelFile];
      }
      return NO;
    }
    if (![SherpaTranscriber looksLikeTokensFileAtPath:tokensPath]) {
      if (errorOut) {
        *errorOut = [NSString
            stringWithFormat:@"Corrupt tokens file at %@ (size=%lld). Please delete %@ and re-download the model.",
                             tokensPath, [SherpaTranscriber fileSizeAtPath:tokensPath], modelDir];
      }
      return NO;
    }
    if (![SherpaTranscriber looksLikeOnnxFileAtPath:modelPath
                                          minBytes:50LL * 1024LL * 1024LL]) {
      if (errorOut) {
        *errorOut = [NSString
            stringWithFormat:@"Corrupt or incomplete model file at %@ (size=%lld). Please delete %@ and re-download the model.",
                             modelPath, [SherpaTranscriber fileSizeAtPath:modelPath], modelDir];
      }
      return NO;
    }
    modelStr = [modelPath UTF8String];
    tokensStr = [tokensPath UTF8String];
    config.model_config.tokens = tokensStr.c_str();
    config.model_config.sense_voice.model = modelStr.c_str();
    config.model_config.sense_voice.language = langStr.c_str();
    config.model_config.sense_voice.use_itn = 1;
  } else if ([engine isEqualToString:@"whisper"]) {
    NSString *prefix = [SherpaTranscriber whisperPrefixForKey:modelKey];
    if (!prefix) {
      if (errorOut) *errorOut = [NSString stringWithFormat:@"Unknown whisper key %@", modelKey];
      return NO;
    }
    NSString *enc =
        [modelDir stringByAppendingPathComponent:[NSString stringWithFormat:@"%@-encoder.int8.onnx", prefix]];
    NSString *dec =
        [modelDir stringByAppendingPathComponent:[NSString stringWithFormat:@"%@-decoder.int8.onnx", prefix]];
    NSString *tokens =
        [modelDir stringByAppendingPathComponent:[NSString stringWithFormat:@"%@-tokens.txt", prefix]];
    if (![fm fileExistsAtPath:enc] || ![fm fileExistsAtPath:dec] || ![fm fileExistsAtPath:tokens]) {
      if (errorOut) {
        *errorOut = [NSString
            stringWithFormat:@"Missing Whisper files in %@ (need %@-encoder.int8.onnx, decoder, tokens)",
                             modelDir, prefix];
      }
      return NO;
    }
    if (![SherpaTranscriber looksLikeTokensFileAtPath:tokens]) {
      if (errorOut) {
        *errorOut = [NSString
            stringWithFormat:@"Corrupt tokens file at %@ (size=%lld). Please delete %@ and re-download the model.",
                             tokens, [SherpaTranscriber fileSizeAtPath:tokens], modelDir];
      }
      return NO;
    }
    if (![SherpaTranscriber looksLikeOnnxFileAtPath:enc minBytes:1LL * 1024LL * 1024LL] ||
        ![SherpaTranscriber looksLikeOnnxFileAtPath:dec minBytes:1LL * 1024LL * 1024LL]) {
      if (errorOut) {
        *errorOut = [NSString
            stringWithFormat:@"Corrupt or incomplete Whisper model in %@. Please delete %@ and re-download the model.",
                             modelDir, modelDir];
      }
      return NO;
    }
    encoderStr = [enc UTF8String];
    decoderStr = [dec UTF8String];
    tokensStr = [tokens UTF8String];

    // Whisper expects ISO-639-1 language code; pass empty for auto-detect.
    if ([language isEqualToString:@"auto"]) {
      langStr.clear();
    }
    config.model_config.tokens = tokensStr.c_str();
    config.model_config.whisper.encoder = encoderStr.c_str();
    config.model_config.whisper.decoder = decoderStr.c_str();
    config.model_config.whisper.language = langStr.c_str();
    config.model_config.whisper.task = taskStr.c_str();
    config.model_config.whisper.tail_paddings = 0;
  } else {
    if (errorOut) *errorOut = [NSString stringWithFormat:@"Unsupported engine %@", engine];
    return NO;
  }

  STLog(@"creating recognizer engine=%@ modelKey=%@ language=%@", engine, modelKey, language);
  const SherpaOnnxOfflineRecognizer *r = _api.CreateOfflineRecognizer(&config);
  if (!r) {
    if (errorOut) *errorOut = @"SherpaOnnxCreateOfflineRecognizer returned NULL";
    return NO;
  }
  _recognizer = r;
  self.cachedKey = cacheKey;
  STLog(@"recognizer ready (%@)", cacheKey);
  return YES;
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

  NSString *normalizedLang = [SherpaTranscriber normalizeLanguage:language forEngine:engine];
  STLog(@"transcribeFile engine=%@ modelKey=%@ lang=%@ file=%@", engine, modelKey, normalizedLang,
        filePath);

  NSString *err = nil;
  if (![self ensureRecognizerForEngine:engine
                              modelKey:modelKey
                              language:normalizedLang
                                 error:&err]) {
    STLog(@"ensureRecognizer failed: %@", err);
    reject(@"sherpa_init_failed", err ?: @"Failed to initialize recognizer.", nil);
    return;
  }

  const SherpaOnnxWave *wave = _api.ReadWave([filePath UTF8String]);
  if (!wave) {
    reject(@"sherpa_wave_read_failed",
           [NSString stringWithFormat:@"Failed to read WAV: %@", filePath], nil);
    return;
  }

  const SherpaOnnxOfflineStream *stream = _api.CreateOfflineStream(_recognizer);
  if (!stream) {
    _api.FreeWave(wave);
    reject(@"sherpa_stream_failed", @"Failed to create offline stream.", nil);
    return;
  }

  if ([engine isEqualToString:@"sensevoice"]) {
    _api.OfflineStreamSetOption(stream, "language", [normalizedLang UTF8String]);
  }

  _api.AcceptWaveformOffline(stream, wave->sample_rate, wave->samples, wave->num_samples);
  _api.DecodeOfflineStream(_recognizer, stream);

  const SherpaOnnxOfflineRecognizerResult *result = _api.GetOfflineStreamResult(stream);
  NSString *text = @"";
  if (result && result->text) {
    text = [NSString stringWithUTF8String:result->text] ?: @"";
  }
  STLog(@"transcribed text length=%lu", (unsigned long)text.length);

  if (result) {
    _api.DestroyOfflineRecognizerResult(result);
  }
  _api.DestroyOfflineStream(stream);
  _api.FreeWave(wave);

  resolve(text);
}

@end
