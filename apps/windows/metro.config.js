const path = require('node:path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const exclusionListModule = require('metro-config/private/defaults/exclusionList');
const exclusionList = exclusionListModule.default ?? exclusionListModule;

const appRoot = __dirname;
const repoRoot = path.resolve(appRoot, '../..');
const appNodeModules = path.join(appRoot, 'node_modules');

const escapePath = value => value.replace(/[/\\]/g, '[/\\\\]');

const config = {
  projectRoot: appRoot,
  watchFolders: [repoRoot],
  resolver: {
    blockList: exclusionList([
      new RegExp(`${escapePath(path.join(appRoot, 'windows'))}.*`),
      new RegExp(`${escapePath(path.join(repoRoot, 'macos'))}.*`),
      new RegExp(`${escapePath(path.join(repoRoot, 'ios'))}.*`),
      new RegExp(`${escapePath(path.join(repoRoot, 'android'))}.*`),
      new RegExp(`${escapePath(path.join(repoRoot, 'node_modules', 'react-native-macos'))}.*`),
      /.*\.ProjectImports\.zip/,
    ]),
    nodeModulesPaths: [appNodeModules],
    extraNodeModules: new Proxy(
      {},
      {
        get: (_, name) => path.join(appNodeModules, String(name)),
      },
    ),
  },
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
};

module.exports = mergeConfig(getDefaultConfig(appRoot), config);
