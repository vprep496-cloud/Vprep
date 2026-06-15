#!/usr/bin/env node
/**
 * postinstall.js
 *
 * react-native-worklets@0.5.1 ships with
 *   "react-native": "./src/index"
 * in its package.json.  Metro prefers the "react-native" field over "main",
 * which means it would try to bundle raw TypeScript instead of the compiled
 * lib/module output.  We override it here to point at the compiled output so
 * Babel only ever receives plain JavaScript.
 *
 * Note: private class fields in the compiled output are handled separately by
 * setting unstable_transformProfile: "hermes-v0" in babel.config.js.
 */

const fs = require('fs');
const path = require('path');

const pkgPath = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-worklets',
  'package.json'
);

if (!fs.existsSync(pkgPath)) {
  console.log('postinstall: react-native-worklets not found, skipping patch');
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

if (pkg['react-native'] === './lib/module/index') {
  console.log('postinstall: react-native-worklets already patched ✓');
  process.exit(0);
}

const original = pkg['react-native'];
pkg['react-native'] = './lib/module/index';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
console.log(
  `postinstall: patched react-native-worklets react-native field: "${original}" → "./lib/module/index" ✓`
);
