#import "SpeechTranscriber.h"
#import <Foundation/Foundation.h>
#import <Speech/Speech.h>

@interface SpeechTranscriber ()
@property (nonatomic, strong) SFSpeechRecognitionTask *recognitionTask;
@end

@implementation SpeechTranscriber

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

RCT_EXPORT_METHOD(transcribeFile:(NSString *)filePath
                  language:(NSString *)language
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  if (filePath.length == 0) {
    reject(@"speech_file_missing", @"Audio file path is empty.", nil);
    return;
  }

  NSURL *fileURL = [NSURL fileURLWithPath:filePath];
  if (![[NSFileManager defaultManager] fileExistsAtPath:fileURL.path]) {
    reject(@"speech_file_not_found", [NSString stringWithFormat:@"Audio file not found: %@", filePath], nil);
    return;
  }

  [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
    dispatch_async(dispatch_get_main_queue(), ^{
      if (status != SFSpeechRecognizerAuthorizationStatusAuthorized) {
        reject(@"speech_permission_denied", @"Speech recognition permission is not authorized.", nil);
        return;
      }

      NSArray<NSLocale *> *locales = [self localesForLanguage:language];
      [self transcribeFileURL:fileURL locales:locales index:0 resolver:resolve rejecter:reject];
    });
  }];
}

- (void)transcribeFileURL:(NSURL *)fileURL
                  locales:(NSArray<NSLocale *> *)locales
                    index:(NSUInteger)index
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject {
  if (index >= locales.count) {
    reject(@"speech_recognizer_unavailable", @"No supported speech recognizer locale is available.", nil);
    return;
  }

  NSLocale *locale = locales[index];
  NSDictionary<NSFileAttributeKey, id> *attributes = [[NSFileManager defaultManager] attributesOfItemAtPath:fileURL.path error:nil];
  unsigned long long fileSize = [[attributes objectForKey:NSFileSize] unsignedLongLongValue];
  SFSpeechRecognizer *recognizer = [[SFSpeechRecognizer alloc] initWithLocale:locale];
  if (!recognizer || !recognizer.available) {
    if (index + 1 < locales.count) {
      [self transcribeFileURL:fileURL locales:locales index:index + 1 resolver:resolve rejecter:reject];
      return;
    }
    reject(@"speech_recognizer_unavailable",
           [NSString stringWithFormat:@"Speech recognizer is unavailable for locale %@.", locale.localeIdentifier],
           nil);
    return;
  }

  SFSpeechURLRecognitionRequest *request = [[SFSpeechURLRecognitionRequest alloc] initWithURL:fileURL];
  request.shouldReportPartialResults = YES;
  request.taskHint = SFSpeechRecognitionTaskHintDictation;
  if ([request respondsToSelector:@selector(setAddsPunctuation:)]) {
    request.addsPunctuation = YES;
  }

  [self.recognitionTask cancel];
  __block BOOL didFinish = NO;
  __block NSString *lastText = @"";
  self.recognitionTask = [recognizer recognitionTaskWithRequest:request
                                                  resultHandler:^(SFSpeechRecognitionResult * _Nullable result, NSError * _Nullable error) {
    if (didFinish) {
      return;
    }

    if (result) {
      NSString *text = result.bestTranscription.formattedString ?: @"";
      if (text.length > 0) {
        lastText = text;
      }

      if (result.isFinal) {
        didFinish = YES;
        self.recognitionTask = nil;
        resolve(lastText ?: @"");
        return;
      }
    }

    if (error) {
      didFinish = YES;
      self.recognitionTask = nil;
      if (lastText.length > 0) {
        resolve(lastText);
        return;
      }

      if (index + 1 < locales.count) {
        [self transcribeFileURL:fileURL locales:locales index:index + 1 resolver:resolve rejecter:reject];
        return;
      }

      NSString *message = [NSString stringWithFormat:@"%@ (locale=%@, file=%@, bytes=%llu, domain=%@, code=%ld)",
                           error.localizedDescription ?: @"Speech transcription failed.",
                           locale.localeIdentifier ?: @"unknown",
                           fileURL.path ?: @"",
                           fileSize,
                           error.domain ?: @"unknown",
                           (long)error.code];
      reject(@"speech_transcription_failed", message, error);
      return;
    }
  }];
}

- (NSArray<NSLocale *> *)localesForLanguage:(NSString *)language {
  NSString *normalized = (language ?: @"auto").lowercaseString;
  NSMutableArray<NSLocale *> *locales = [NSMutableArray array];

  if ([normalized isEqualToString:@"asrlanguagezh"] ||
      [normalized isEqualToString:@"zh"] ||
      [normalized hasPrefix:@"zh-"]) {
    [self addSupportedLocaleIdentifier:@"zh-CN" toLocales:locales];
  } else if ([normalized isEqualToString:@"asrlanguageen"] ||
             [normalized isEqualToString:@"en"] ||
             [normalized hasPrefix:@"en-"]) {
    [self addSupportedLocaleIdentifier:@"en-US" toLocales:locales];
  } else if (![normalized isEqualToString:@"auto"] &&
             ![normalized isEqualToString:@"asrlanguageauto"]) {
    [self addSupportedLocaleIdentifier:language toLocales:locales];
    [self addSupportedLocaleIdentifier:@"zh-CN" toLocales:locales];
    [self addSupportedLocaleIdentifier:@"en-US" toLocales:locales];
  } else {
    [self addSupportedLocaleIdentifier:@"zh-CN" toLocales:locales];
    [self addSupportedLocaleIdentifier:@"en-US" toLocales:locales];
  }

  if (locales.count == 0) {
    [locales addObject:[NSLocale localeWithLocaleIdentifier:@"zh-CN"]];
  }

  return locales;
}

- (void)addSupportedLocaleIdentifier:(NSString *)identifier toLocales:(NSMutableArray<NSLocale *> *)locales {
  if (identifier.length == 0) {
    return;
  }

  NSLocale *locale = [NSLocale localeWithLocaleIdentifier:identifier];
  if (![SFSpeechRecognizer.supportedLocales containsObject:locale]) {
    return;
  }

  for (NSLocale *existing in locales) {
    if ([existing.localeIdentifier isEqualToString:locale.localeIdentifier]) {
      return;
    }
  }

  [locales addObject:locale];
}

@end
