const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const root = path.resolve(__dirname, '..');
const config = getDefaultConfig(__dirname);
config.watchFolders = [...new Set([...config.watchFolders, root])];
config.resolver.nodeModulesPaths = [path.join(root, 'node_modules')];

module.exports = config;
