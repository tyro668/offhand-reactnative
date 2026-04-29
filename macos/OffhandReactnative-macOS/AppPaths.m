#import "AppPaths.h"

static NSString * const AppPathsAppDirectoryName = @"offhand-native";
static NSString * const AppPathsLocalizedLegacyAppDirectoryName = @"释手语音输入法";
static NSString * const AppPathsLogsDirectoryName = @"Logs";
static NSString * const AppPathsRecordingsDirectoryName = @"Recordings";
static NSString * const AppPathsDatabaseDirectoryName = @"Database";
static NSString * const AppPathsLogFileName = @"OffhandReactnative.log";
static NSString * const AppPathsDefaultDatabaseName = @"offhand.db";
static NSString * const AppPathsSQLiteLibraryLocation = @"Library";

@implementation AppPaths

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

+ (NSString *)libraryDirectory {
  NSArray *paths = NSSearchPathForDirectoriesInDomains(NSLibraryDirectory, NSUserDomainMask, YES);
  NSString *libraryDir = paths.firstObject;
  if (libraryDir.length == 0) {
    libraryDir = [NSHomeDirectory() stringByAppendingPathComponent:@"Library"];
  }
  return libraryDir;
}

+ (NSString *)applicationSupportDirectory {
  NSArray *paths = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES);
  NSString *supportDir = paths.firstObject;
  if (supportDir.length == 0) {
    supportDir = [[self libraryDirectory] stringByAppendingPathComponent:@"Application Support"];
  }
  return supportDir;
}

+ (NSString *)localizedLegacyAppDataDirectory {
  return [[self applicationSupportDirectory] stringByAppendingPathComponent:AppPathsLocalizedLegacyAppDirectoryName];
}

+ (BOOL)ensureDirectoryAtPath:(NSString *)path error:(NSError **)error {
  if (path.length == 0) {
    return NO;
  }
  NSFileManager *fm = NSFileManager.defaultManager;
  BOOL isDirectory = NO;
  if ([fm fileExistsAtPath:path isDirectory:&isDirectory]) {
    return isDirectory;
  }
  return [fm createDirectoryAtPath:path withIntermediateDirectories:YES attributes:nil error:error];
}

+ (NSString *)safeDatabaseName:(NSString *)databaseName {
  if (databaseName.length == 0) {
    return AppPathsDefaultDatabaseName;
  }
  return databaseName.lastPathComponent.length > 0 ? databaseName.lastPathComponent : AppPathsDefaultDatabaseName;
}

+ (NSString *)appDataDirectory {
  NSString *path = [[self applicationSupportDirectory] stringByAppendingPathComponent:AppPathsAppDirectoryName];
  NSError *error = nil;
  if (![self ensureDirectoryAtPath:path error:&error]) {
    NSLog(@"[AppPaths] failed to create app data directory %@: %@", path, error.localizedDescription);
  }
  return path;
}

+ (NSString *)logsDirectory {
  NSString *path = [[self appDataDirectory] stringByAppendingPathComponent:AppPathsLogsDirectoryName];
  NSError *error = nil;
  if (![self ensureDirectoryAtPath:path error:&error]) {
    NSLog(@"[AppPaths] failed to create logs directory %@: %@", path, error.localizedDescription);
  }
  return path;
}

+ (NSString *)recordingsDirectory {
  NSString *path = [[self appDataDirectory] stringByAppendingPathComponent:AppPathsRecordingsDirectoryName];
  NSError *error = nil;
  if (![self ensureDirectoryAtPath:path error:&error]) {
    NSLog(@"[AppPaths] failed to create recordings directory %@: %@", path, error.localizedDescription);
  }
  return path;
}

+ (NSString *)databaseDirectory {
  NSString *path = [[self appDataDirectory] stringByAppendingPathComponent:AppPathsDatabaseDirectoryName];
  NSError *error = nil;
  if (![self ensureDirectoryAtPath:path error:&error]) {
    NSLog(@"[AppPaths] failed to create database directory %@: %@", path, error.localizedDescription);
  }
  return path;
}

+ (NSString *)logFilePathWithoutMigration {
  return [[self logsDirectory] stringByAppendingPathComponent:AppPathsLogFileName];
}

+ (NSString *)logFilePath {
  [self prepareApplicationStorage];
  NSString *path = [self logFilePathWithoutMigration];
  if (![NSFileManager.defaultManager fileExistsAtPath:path]) {
    [NSFileManager.defaultManager createFileAtPath:path contents:nil attributes:nil];
  }
  return path;
}

+ (NSString *)databasePathWithoutMigrationForName:(NSString *)databaseName {
  NSString *safeName = [self safeDatabaseName:databaseName];
  return [[self databaseDirectory] stringByAppendingPathComponent:safeName];
}

+ (NSString *)databasePathForName:(NSString *)databaseName {
  [self migrateLegacyDatabaseIfNeeded:databaseName];
  return [self databasePathWithoutMigrationForName:databaseName];
}

+ (NSString *)databaseLibraryRelativePathForName:(NSString *)databaseName {
  NSString *path = [self databasePathForName:databaseName];
  NSString *libraryDir = [self libraryDirectory];
  NSString *prefix = [libraryDir stringByAppendingString:@"/"];
  if ([path hasPrefix:prefix]) {
    return [path substringFromIndex:prefix.length];
  }
  return path;
}

+ (void)prepareApplicationStorage {
  [self logsDirectory];
  [self recordingsDirectory];
  [self databaseDirectory];
  [self migrateLegacyLogIfNeeded];
  [self migrateLegacyRecordingsIfNeeded];
  [self migrateLegacyDatabaseIfNeeded:AppPathsDefaultDatabaseName];
}

+ (void)migrateFileIfNeededFromPath:(NSString *)sourcePath toPath:(NSString *)targetPath {
  NSFileManager *fm = NSFileManager.defaultManager;
  if (sourcePath.length == 0 || targetPath.length == 0) {
    return;
  }
  if (![fm fileExistsAtPath:sourcePath] || [fm fileExistsAtPath:targetPath]) {
    return;
  }

  NSString *targetDir = targetPath.stringByDeletingLastPathComponent;
  NSError *dirError = nil;
  if (![self ensureDirectoryAtPath:targetDir error:&dirError]) {
    NSLog(@"[AppPaths] failed to prepare migration target %@: %@", targetDir, dirError.localizedDescription);
    return;
  }

  NSError *copyError = nil;
  if ([fm copyItemAtPath:sourcePath toPath:targetPath error:&copyError]) {
    NSLog(@"[AppPaths] migrated %@ -> %@", sourcePath, targetPath);
  } else {
    NSLog(@"[AppPaths] failed to migrate %@ -> %@: %@", sourcePath, targetPath, copyError.localizedDescription);
  }
}

+ (void)migrateLegacyLogIfNeeded {
  NSString *localizedLegacyPath = [[[self localizedLegacyAppDataDirectory] stringByAppendingPathComponent:AppPathsLogsDirectoryName]
                                   stringByAppendingPathComponent:AppPathsLogFileName];
  NSString *oldLegacyPath = [[[self libraryDirectory] stringByAppendingPathComponent:@"Logs/OffhandReactnative"]
                             stringByAppendingPathComponent:AppPathsLogFileName];
  NSString *targetPath = [self logFilePathWithoutMigration];
  [self migrateFileIfNeededFromPath:localizedLegacyPath toPath:targetPath];
  [self migrateFileIfNeededFromPath:oldLegacyPath toPath:targetPath];
}

+ (void)migrateRecordingsFromDirectory:(NSString *)legacyDir toDirectory:(NSString *)targetDir {
  NSFileManager *fm = NSFileManager.defaultManager;
  BOOL isDirectory = NO;
  if (![fm fileExistsAtPath:legacyDir isDirectory:&isDirectory] || !isDirectory) {
    return;
  }

  NSError *error = nil;
  NSArray<NSString *> *files = [fm contentsOfDirectoryAtPath:legacyDir error:&error];
  if (!files) {
    NSLog(@"[AppPaths] failed to read legacy recordings directory %@: %@", legacyDir, error.localizedDescription);
    return;
  }

  for (NSString *fileName in files) {
    BOOL isRecordingFile = [fileName hasPrefix:@"recording_"] || [fileName.pathExtension.lowercaseString isEqualToString:@"wav"];
    if (!isRecordingFile) {
      continue;
    }
    NSString *sourcePath = [legacyDir stringByAppendingPathComponent:fileName];
    NSString *targetPath = [targetDir stringByAppendingPathComponent:fileName];
    [self migrateFileIfNeededFromPath:sourcePath toPath:targetPath];
  }
}

+ (void)migrateLegacyRecordingsIfNeeded {
  NSString *targetDir = [self recordingsDirectory];
  NSArray<NSString *> *legacyDirs = @[
    [[self localizedLegacyAppDataDirectory] stringByAppendingPathComponent:AppPathsRecordingsDirectoryName],
    [[self applicationSupportDirectory] stringByAppendingPathComponent:@"Offhand"],
  ];

  for (NSString *legacyDir in legacyDirs) {
    [self migrateRecordingsFromDirectory:legacyDir toDirectory:targetDir];
  }
}

+ (BOOL)migrateDatabaseFromDirectory:(NSString *)legacyDir
                        databaseName:(NSString *)safeName
                          targetPath:(NSString *)targetPath {
  NSFileManager *fm = NSFileManager.defaultManager;
  if ([fm fileExistsAtPath:targetPath]) {
    return YES;
  }

  NSString *sourceMainPath = [legacyDir stringByAppendingPathComponent:safeName];
  if (![fm fileExistsAtPath:sourceMainPath]) {
    return NO;
  }

  NSArray<NSString *> *suffixes = @[@"", @"-wal", @"-shm", @"-journal"];
  for (NSString *suffix in suffixes) {
    NSString *sourcePath = [legacyDir stringByAppendingPathComponent:[safeName stringByAppendingString:suffix]];
    NSString *destinationPath = [targetPath stringByAppendingString:suffix];
    [self migrateFileIfNeededFromPath:sourcePath toPath:destinationPath];
  }

  return [fm fileExistsAtPath:targetPath];
}

+ (void)migrateLegacyDatabaseIfNeeded:(NSString *)databaseName {
  NSString *safeName = [self safeDatabaseName:databaseName];
  NSString *targetPath = [self databasePathWithoutMigrationForName:safeName];
  NSFileManager *fm = NSFileManager.defaultManager;
  if ([fm fileExistsAtPath:targetPath]) {
    return;
  }

  NSArray<NSString *> *legacyDirs = @[
    [[self localizedLegacyAppDataDirectory] stringByAppendingPathComponent:AppPathsDatabaseDirectoryName],
    [[self libraryDirectory] stringByAppendingPathComponent:@"LocalDatabase"],
  ];

  for (NSString *legacyDir in legacyDirs) {
    if ([self migrateDatabaseFromDirectory:legacyDir databaseName:safeName targetPath:targetPath]) {
      return;
    }
  }
}

RCT_EXPORT_METHOD(getAppDir:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [AppPaths prepareApplicationStorage];
  resolve([AppPaths appDataDirectory]);
}

RCT_EXPORT_METHOD(getPaths:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [AppPaths prepareApplicationStorage];
  NSString *databasePath = [AppPaths databasePathForName:AppPathsDefaultDatabaseName];
  resolve(@{
    @"appDataDir": [AppPaths appDataDirectory],
    @"logsDir": [AppPaths logsDirectory],
    @"logFilePath": [AppPaths logFilePath],
    @"recordingsDir": [AppPaths recordingsDirectory],
    @"databaseDir": [AppPaths databaseDirectory],
    @"databasePath": databasePath,
    @"databaseName": [AppPaths databaseLibraryRelativePathForName:AppPathsDefaultDatabaseName],
    @"databaseLocation": AppPathsSQLiteLibraryLocation,
  });
}

RCT_EXPORT_METHOD(getDatabaseOpenOptions:(NSString *)databaseName
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  NSString *safeName = [AppPaths safeDatabaseName:databaseName];
  NSString *databasePath = [AppPaths databasePathForName:safeName];
  resolve(@{
    @"name": [AppPaths databaseLibraryRelativePathForName:safeName],
    @"location": AppPathsSQLiteLibraryLocation,
    @"path": databasePath,
  });
}

@end
