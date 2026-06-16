#!/usr/bin/env node
/**
 * postinstall.js
 *
 * Applies two package.json patches that are required for the app to work
 * correctly on Android / iOS (Expo Go).
 *
 * ── Patch 1: react-native-worklets ──────────────────────────────────────────
 * react-native-worklets@0.5.1 ships with
 *   "react-native": "./src/index"
 * in its package.json.  Metro prefers the "react-native" field over "main",
 * which means it would try to bundle raw TypeScript instead of the compiled
 * lib/module output.  We override it to point at the compiled output so
 * Babel only ever receives plain JavaScript.
 *
 * ── Patch 2: @firebase/app ──────────────────────────────────────────────────
 * @firebase/app ships without a "react-native" field.  On native (Android/iOS)
 * Metro falls back to the "browser" field which points at the ESM2017 build
 * (dist/esm/index.esm2017.js).  BUT @firebase/auth's React Native build
 * (dist/rn/index.js) uses plain CJS require() which Metro resolves to the
 * "main" CJS build (dist/index.cjs.js) instead.
 *
 * This gives two separate @firebase/app module instances with separate
 * component registries.  registerAuth("ReactNative") registers the "auth"
 * component on the CJS registry; initializeApp() creates the app in the ESM
 * registry — they never share state, so initializeAuth() throws
 * "Component auth has not been registered yet".
 *
 * Fix: add "react-native": "dist/index.cjs.js" to @firebase/app/package.json.
 * Metro then uses the CJS build for ALL resolutions of @firebase/app on
 * native, whether the caller is a CJS or ESM file, giving a single shared
 * registry where both registerAuth and initializeApp operate.
 */

const fs = require('fs');
const path = require('path');
const NM = path.join(__dirname, '..', 'node_modules');

function patchPackage(pkgPath, field, value, label) {
  if (!fs.existsSync(pkgPath)) {
    console.log(`postinstall: ${label} not found, skipping`);
    return;
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkg[field] === value) {
    console.log(`postinstall: ${label} already patched ✓`);
    return;
  }
  const original = pkg[field];
  pkg[field] = value;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  console.log(
    `postinstall: patched ${label} "${field}": ${JSON.stringify(original)} → ${JSON.stringify(value)} ✓`
  );
}

// Patch 1 — react-native-worklets
patchPackage(
  path.join(NM, 'react-native-worklets', 'package.json'),
  'react-native',
  './lib/module/index',
  'react-native-worklets'
);

// Patch 2 — @firebase/app: force CJS build on native so all Firebase modules
// share one component registry.
patchPackage(
  path.join(NM, '@firebase', 'app', 'package.json'),
  'react-native',
  'dist/index.cjs.js',
  '@firebase/app'
);
