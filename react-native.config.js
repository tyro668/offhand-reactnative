module.exports = {
  dependencies: {
    // react-native-macos 0.81.x ships an older FBReactNativeSpec shape.
    // With react-native 0.85.x the generated core spec is already bundled in
    // react-native, so skipping rediscovery avoids codegen parsing the stale
    // macOS spec during local builds.
    FBReactNativeSpec: {
      platforms: {
        ios: null,
        macos: null,
      },
    },
  },
};
