#import "AudioRecorder.h"
#import "AppPaths.h"
#import <AVFoundation/AVFoundation.h>
#import <TargetConditionals.h>

@interface AudioRecorder () <AVAudioRecorderDelegate>
@property (nonatomic, strong) AVAudioRecorder *recorder;
@property (nonatomic, copy) NSString *outputPath;
@property (nonatomic, strong) NSTimer *levelTimer;
@end

@implementation AudioRecorder

RCT_EXPORT_MODULE();

- (NSArray<NSString *> *)supportedEvents {
  return @[@"onAudioLevel", @"onRecordComplete"];
}

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

RCT_EXPORT_METHOD(startRecording) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [AppPaths migrateLegacyRecordingsIfNeeded];
    NSString *recordingsDir = [AppPaths recordingsDirectory];

    NSDateFormatter *fmt = [[NSDateFormatter alloc] init];
    fmt.dateFormat = @"yyyyMMdd_HHmmss";
    NSString *ts = [fmt stringFromDate:[NSDate date]];
    self.outputPath = [recordingsDir stringByAppendingPathComponent:[NSString stringWithFormat:@"recording_%@.wav", ts]];

    // Ask for permission
    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL granted) {
      dispatch_async(dispatch_get_main_queue(), ^{
        if (!granted) {
          [self sendEventWithName:@"onRecordComplete"
                             body:@{@"success": @NO,
                                    @"filePath": self.outputPath ?: @"",
                                    @"error": @"Microphone permission denied"}];
          return;
        }

        NSError *error = nil;
#if !TARGET_OS_OSX
        AVAudioSession *session = [AVAudioSession sharedInstance];
        [session setCategory:AVAudioSessionCategoryRecord error:&error];
        [session setActive:YES error:&error];
#endif

        NSDictionary *settings = @{
          AVFormatIDKey: @(kAudioFormatLinearPCM),
          AVSampleRateKey: @16000.0,
          AVNumberOfChannelsKey: @1,
          AVLinearPCMBitDepthKey: @16,
          AVLinearPCMIsFloatKey: @NO,
          AVLinearPCMIsBigEndianKey: @NO,
        };

        NSURL *url = [NSURL fileURLWithPath:self.outputPath];
        self.recorder = [[AVAudioRecorder alloc] initWithURL:url settings:settings error:&error];
        if (error) {
          [self sendEventWithName:@"onRecordComplete"
                             body:@{@"success": @NO,
                                    @"filePath": self.outputPath ?: @"",
                                    @"error": error.localizedDescription ?: @"Failed to create audio recorder"}];
          return;
        }

        self.recorder.delegate = self;
        self.recorder.meteringEnabled = YES;

        if ([self.recorder record]) {
          // Level timer
          __weak typeof(self) weakSelf = self;
          self.levelTimer = [NSTimer scheduledTimerWithTimeInterval:0.1 repeats:YES block:^(NSTimer *timer) {
            __strong typeof(weakSelf) strongSelf = weakSelf;
            if (!strongSelf || !strongSelf.recorder) return;
            [strongSelf.recorder updateMeters];
            float level = [strongSelf.recorder averagePowerForChannel:0];
            // Normalize: -60dB = 0, 0dB = 1
            float normalized = MAX(0.0, MIN(1.0, (level + 60.0) / 60.0));
            [strongSelf sendEventWithName:@"onAudioLevel" body:@{@"level": @(normalized)}];
          }];
        } else {
          [self sendEventWithName:@"onRecordComplete"
                             body:@{@"success": @NO,
                                    @"filePath": self.outputPath ?: @"",
                                    @"error": @"Failed to start recording"}];
        }
      });
    }];
  });
}

RCT_EXPORT_METHOD(stopRecording) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.levelTimer invalidate];
    self.levelTimer = nil;
    if (self.recorder) {
      [self.recorder stop];
    }
  });
}

RCT_EXPORT_METHOD(cancelRecording) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.levelTimer invalidate];
    self.levelTimer = nil;
    [self.recorder stop];
    // Delete partial file
    if (self.outputPath) {
      [[NSFileManager defaultManager] removeItemAtPath:self.outputPath error:nil];
    }
  });
}

- (void)audioRecorderDidFinishRecording:(AVAudioRecorder *)recorder successfully:(BOOL)flag {
  [self sendEventWithName:@"onRecordComplete"
                     body:@{@"success": @(flag),
                            @"filePath": self.outputPath ?: @""}];
}

@end
