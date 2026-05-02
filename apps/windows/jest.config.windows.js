module.exports = {
  preset: '@rnx-kit/jest-preset',
  testEnvironment: 'node',
  moduleFileExtensions: ['windows.ts', 'windows.tsx', 'ts', 'tsx', 'js', 'jsx', 'json'],
  rootDir: '../..',
  testMatch: ['<rootDir>/__tests__/**/*.test.(ts|tsx|js)'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native|@react-native-windows|react-native-windows|react-native-svg|react-native-marked)/)',
  ],
};
