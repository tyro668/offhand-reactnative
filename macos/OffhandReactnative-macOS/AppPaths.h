#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

@interface AppPaths : NSObject <RCTBridgeModule>

+ (NSString *)appDataDirectory;
+ (NSString *)logsDirectory;
+ (NSString *)recordingsDirectory;
+ (NSString *)databaseDirectory;
+ (NSString *)logFilePath;
+ (NSString *)databasePathForName:(NSString *)databaseName;
+ (NSString *)databaseLibraryRelativePathForName:(NSString *)databaseName;
+ (void)prepareApplicationStorage;
+ (void)migrateLegacyLogIfNeeded;
+ (void)migrateLegacyRecordingsIfNeeded;
+ (void)migrateLegacyDatabaseIfNeeded:(NSString *)databaseName;

@end
