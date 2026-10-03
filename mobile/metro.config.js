const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const { createSharedResolver } = require('./shared-resolver');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../src');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), sharedRoot];
config.resolver.resolveRequest = createSharedResolver({
  projectRoot,
  sharedRoot,
  upstream: config.resolver.resolveRequest,
});

module.exports = config;
