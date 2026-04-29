#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// Bridge file that exposes the Swift `OverlayManager` class to React Native.
// The actual implementation lives in OverlayManager.swift.
@interface RCT_EXTERN_MODULE(OverlayManager, RCTEventEmitter)

RCT_EXTERN_METHOD(startMonitoring)
RCT_EXTERN_METHOD(stopMonitoring)
RCT_EXTERN_METHOD(toggleRecording)
RCT_EXTERN_METHOD(setOverlayState:(NSDictionary *)payload)
RCT_EXTERN_METHOD(getLogFilePath:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(openLogFolder:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(appendLog:(NSString *)message)

RCT_EXTERN_METHOD(checkPermissions:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(requestAccessibilityPermission:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(requestInputMonitoringPermission:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(requestMicrophonePermission:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

@end
