#import "SherpaHelper.h"

#import <Foundation/Foundation.h>
#import <sherpa-onnx/c-api/c-api.h>
#import <dlfcn.h>

#import <string>

// ---------------------------------------------------------------------------
// Sherpa runtime symbol table (dynamically loaded so the parent app does not
// link against the sherpa dylibs).
// ---------------------------------------------------------------------------

namespace {

struct SherpaApi {
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

static void *g_onnxHandle = nullptr;
static void *g_sherpaHandle = nullptr;
static SherpaApi g_api;
static const SherpaOnnxOfflineRecognizer *g_recognizer = nullptr;
static NSString *g_cachedKey = nil;

static void HelperLog(NSString *fmt, ...) {
  va_list args;
  va_start(args, fmt);
  NSString *msg = [[NSString alloc] initWithFormat:fmt arguments:args];
  va_end(args);
  // stderr is read line-by-line by the parent and forwarded to the app log.
  fprintf(stderr, "[SherpaHelper] %s\n", msg.UTF8String);
  fflush(stderr);
}

static NSString *FindOnnxRuntimeDylib(NSString *libDir) {
  NSArray *items = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:libDir
                                                                       error:nil] ?: @[];
  for (NSString *item in items) {
    if ([item hasPrefix:@"libonnxruntime."] && [item hasSuffix:@".dylib"]) {
      return [libDir stringByAppendingPathComponent:item];
    }
  }
  return nil;
}

static BOOL LoadSymbol(void **target, const char *name, NSString **err) {
  dlerror();
  *target = dlsym(g_sherpaHandle, name);
  const char *e = dlerror();
  if (e || !*target) {
    if (err) {
      *err = [NSString stringWithFormat:@"missing symbol %s: %s", name, e ?: "not found"];
    }
    return NO;
  }
  return YES;
}

static BOOL EnsureRuntimeLoaded(NSString *runtimeDir, NSString **errorOut) {
  if (g_sherpaHandle) return YES;

  NSString *libDir = [runtimeDir stringByAppendingPathComponent:@"lib"];
  NSString *sherpaPath =
      [libDir stringByAppendingPathComponent:@"libsherpa-onnx-c-api.dylib"];
  NSString *onnxPath = FindOnnxRuntimeDylib(libDir);

  NSFileManager *fm = NSFileManager.defaultManager;
  if (![fm fileExistsAtPath:sherpaPath] || onnxPath.length == 0 ||
      ![fm fileExistsAtPath:onnxPath]) {
    if (errorOut) {
      *errorOut = [NSString stringWithFormat:@"Sherpa runtime not present at %@", libDir];
    }
    return NO;
  }

  g_onnxHandle = dlopen(onnxPath.UTF8String, RTLD_NOW | RTLD_GLOBAL);
  if (!g_onnxHandle) {
    if (errorOut) {
      *errorOut = [NSString stringWithFormat:@"dlopen onnx failed: %s", dlerror()];
    }
    return NO;
  }

  g_sherpaHandle = dlopen(sherpaPath.UTF8String, RTLD_NOW | RTLD_LOCAL);
  if (!g_sherpaHandle) {
    if (errorOut) {
      *errorOut = [NSString stringWithFormat:@"dlopen sherpa failed: %s", dlerror()];
    }
    dlclose(g_onnxHandle);
    g_onnxHandle = nullptr;
    return NO;
  }

  memset(&g_api, 0, sizeof(g_api));
#define LOAD(field, sym)                                                      \
  if (!LoadSymbol((void **)&g_api.field, sym, errorOut)) return NO;
  LOAD(CreateOfflineRecognizer, "SherpaOnnxCreateOfflineRecognizer");
  LOAD(DestroyOfflineRecognizer, "SherpaOnnxDestroyOfflineRecognizer");
  LOAD(CreateOfflineStream, "SherpaOnnxCreateOfflineStream");
  LOAD(DestroyOfflineStream, "SherpaOnnxDestroyOfflineStream");
  LOAD(AcceptWaveformOffline, "SherpaOnnxAcceptWaveformOffline");
  LOAD(OfflineStreamSetOption, "SherpaOnnxOfflineStreamSetOption");
  LOAD(DecodeOfflineStream, "SherpaOnnxDecodeOfflineStream");
  LOAD(GetOfflineStreamResult, "SherpaOnnxGetOfflineStreamResult");
  LOAD(DestroyOfflineRecognizerResult, "SherpaOnnxDestroyOfflineRecognizerResult");
  LOAD(ReadWave, "SherpaOnnxReadWave");
  LOAD(FreeWave, "SherpaOnnxFreeWave");
#undef LOAD

  HelperLog(@"runtime loaded from %@", sherpaPath);
  return YES;
}

static NSString *WhisperPrefix(NSString *modelKey) {
  if ([modelKey isEqualToString:@"whisperTiny"]) return @"tiny";
  if ([modelKey isEqualToString:@"whisperBase"]) return @"base";
  if ([modelKey isEqualToString:@"whisperSmall"]) return @"small";
  if ([modelKey isEqualToString:@"whisperMedium"]) return @"medium";
  if ([modelKey isEqualToString:@"whisperLarge"]) return @"large-v3";
  return nil;
}

static NSString *SenseVoiceModelFile(NSString *modelKey) {
  if ([modelKey isEqualToString:@"senseVoiceLarge"]) return @"model.onnx";
  return @"model.int8.onnx";
}

static BOOL EnsureRecognizer(NSString *engine,
                             NSString *modelKey,
                             NSString *modelDir,
                             NSString *language,
                             NSString **errorOut) {
  NSString *cacheKey =
      [NSString stringWithFormat:@"%@|%@|%@|%@", engine, modelKey, modelDir, language];
  if (g_recognizer && [g_cachedKey isEqualToString:cacheKey]) {
    return YES;
  }
  if (g_recognizer) {
    g_api.DestroyOfflineRecognizer(g_recognizer);
    g_recognizer = nullptr;
    g_cachedKey = nil;
  }

  NSFileManager *fm = NSFileManager.defaultManager;
  if (![fm fileExistsAtPath:modelDir]) {
    if (errorOut) *errorOut = [NSString stringWithFormat:@"model dir not found: %@", modelDir];
    return NO;
  }

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
    NSString *modelFile = SenseVoiceModelFile(modelKey);
    NSString *modelPath = [modelDir stringByAppendingPathComponent:modelFile];
    NSString *tokensPath = [modelDir stringByAppendingPathComponent:@"tokens.txt"];
    if (![fm fileExistsAtPath:modelPath] || ![fm fileExistsAtPath:tokensPath]) {
      if (errorOut) {
        *errorOut = [NSString stringWithFormat:@"missing SenseVoice files at %@", modelDir];
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
    NSString *prefix = WhisperPrefix(modelKey);
    if (!prefix) {
      if (errorOut) *errorOut = [NSString stringWithFormat:@"unknown whisper key %@", modelKey];
      return NO;
    }
    NSString *enc = [modelDir stringByAppendingPathComponent:
        [NSString stringWithFormat:@"%@-encoder.int8.onnx", prefix]];
    NSString *dec = [modelDir stringByAppendingPathComponent:
        [NSString stringWithFormat:@"%@-decoder.int8.onnx", prefix]];
    NSString *tok = [modelDir stringByAppendingPathComponent:
        [NSString stringWithFormat:@"%@-tokens.txt", prefix]];
    if (![fm fileExistsAtPath:enc] || ![fm fileExistsAtPath:dec] || ![fm fileExistsAtPath:tok]) {
      if (errorOut) {
        *errorOut = [NSString stringWithFormat:@"missing Whisper files in %@", modelDir];
      }
      return NO;
    }
    encoderStr = [enc UTF8String];
    decoderStr = [dec UTF8String];
    tokensStr = [tok UTF8String];
    if ([language isEqualToString:@"auto"]) langStr.clear();
    config.model_config.tokens = tokensStr.c_str();
    config.model_config.whisper.encoder = encoderStr.c_str();
    config.model_config.whisper.decoder = decoderStr.c_str();
    config.model_config.whisper.language = langStr.c_str();
    config.model_config.whisper.task = taskStr.c_str();
    config.model_config.whisper.tail_paddings = 0;
  } else {
    if (errorOut) *errorOut = [NSString stringWithFormat:@"unsupported engine %@", engine];
    return NO;
  }

  HelperLog(@"creating recognizer engine=%@ modelKey=%@ language=%@", engine, modelKey, language);
  const SherpaOnnxOfflineRecognizer *r = g_api.CreateOfflineRecognizer(&config);
  if (!r) {
    if (errorOut) *errorOut = @"CreateOfflineRecognizer returned NULL";
    return NO;
  }
  g_recognizer = r;
  g_cachedKey = [cacheKey copy];
  HelperLog(@"recognizer ready");
  return YES;
}

static NSString *Transcribe(NSString *filePath,
                            NSString *engine,
                            NSString *language,
                            NSString **errorOut) {
  const SherpaOnnxWave *wave = g_api.ReadWave([filePath UTF8String]);
  if (!wave) {
    if (errorOut) *errorOut = [NSString stringWithFormat:@"failed to read WAV: %@", filePath];
    return nil;
  }
  const SherpaOnnxOfflineStream *stream = g_api.CreateOfflineStream(g_recognizer);
  if (!stream) {
    g_api.FreeWave(wave);
    if (errorOut) *errorOut = @"failed to create offline stream";
    return nil;
  }
  if ([engine isEqualToString:@"sensevoice"]) {
    g_api.OfflineStreamSetOption(stream, "language", [language UTF8String]);
  }
  g_api.AcceptWaveformOffline(stream, wave->sample_rate, wave->samples, wave->num_samples);
  g_api.DecodeOfflineStream(g_recognizer, stream);
  const SherpaOnnxOfflineRecognizerResult *result = g_api.GetOfflineStreamResult(stream);
  NSString *text = @"";
  if (result && result->text) {
    text = [NSString stringWithUTF8String:result->text] ?: @"";
  }
  if (result) g_api.DestroyOfflineRecognizerResult(result);
  g_api.DestroyOfflineStream(stream);
  g_api.FreeWave(wave);
  return text;
}

static NSData *ReadLineFromStdin() {
  NSMutableData *data = [NSMutableData data];
  while (1) {
    int c = fgetc(stdin);
    if (c == EOF) {
      return data.length > 0 ? data : nil;
    }
    if (c == '\n') return data;
    uint8_t b = (uint8_t)c;
    [data appendBytes:&b length:1];
  }
}

static void WriteJsonLine(NSDictionary *obj) {
  NSError *err = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:obj options:0 error:&err];
  if (!data) {
    fprintf(stdout, "{\"ok\":false,\"error\":\"json serialization failed\"}\n");
  } else {
    fwrite(data.bytes, 1, data.length, stdout);
    fputc('\n', stdout);
  }
  fflush(stdout);
}

}  // namespace

int sherpa_helper_main(int argc, const char **argv) {
  (void)argc;
  (void)argv;
  @autoreleasepool {
    HelperLog(@"started pid=%d", getpid());
  }

  // Make stdin / stdout fully line-oriented; no buffering games.
  setvbuf(stdout, NULL, _IOLBF, 0);
  setvbuf(stderr, NULL, _IOLBF, 0);

  while (1) {
    @autoreleasepool {
      NSData *line = ReadLineFromStdin();
      if (!line) {
        HelperLog(@"stdin closed; exiting.");
        break;
      }
      NSError *err = nil;
      id parsed = [NSJSONSerialization JSONObjectWithData:line options:0 error:&err];
      if (![parsed isKindOfClass:[NSDictionary class]]) {
        WriteJsonLine(@{@"ok": @NO, @"error": @"invalid request"});
        continue;
      }
      NSDictionary *req = parsed;
      NSString *cmd = req[@"cmd"];
      if ([cmd isEqualToString:@"ping"]) {
        WriteJsonLine(@{@"ok": @YES});
        continue;
      }
      if ([cmd isEqualToString:@"shutdown"]) {
        WriteJsonLine(@{@"ok": @YES});
        break;
      }
      if (![cmd isEqualToString:@"transcribe"]) {
        WriteJsonLine(@{@"ok": @NO, @"error": @"unknown cmd"});
        continue;
      }

      NSString *runtimeDir = req[@"runtimeDir"] ?: @"";
      NSString *engine = req[@"engine"] ?: @"";
      NSString *modelKey = req[@"modelKey"] ?: @"";
      NSString *modelDir = req[@"modelDir"] ?: @"";
      NSString *language = req[@"language"] ?: @"auto";
      NSString *filePath = req[@"filePath"] ?: @"";

      NSString *loadErr = nil;
      if (!EnsureRuntimeLoaded(runtimeDir, &loadErr)) {
        WriteJsonLine(@{@"ok": @NO, @"error": loadErr ?: @"runtime load failed"});
        continue;
      }

      NSString *recogErr = nil;
      if (!EnsureRecognizer(engine, modelKey, modelDir, language, &recogErr)) {
        WriteJsonLine(@{@"ok": @NO, @"error": recogErr ?: @"recognizer init failed"});
        continue;
      }

      NSString *transErr = nil;
      NSString *text = Transcribe(filePath, engine, language, &transErr);
      if (!text) {
        WriteJsonLine(@{@"ok": @NO, @"error": transErr ?: @"transcribe failed"});
        continue;
      }
      WriteJsonLine(@{@"ok": @YES, @"text": text});
    }
  }

  // Best-effort cleanup. The whole process is about to exit anyway, so the
  // OS will reclaim everything.
  if (g_recognizer && g_api.DestroyOfflineRecognizer) {
    g_api.DestroyOfflineRecognizer(g_recognizer);
    g_recognizer = nullptr;
  }
  HelperLog(@"exiting");
  return 0;
}
