const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Apply NativeWind first
const finalConfig = withNativeWind(config, { input: "./global.css" });

// react-native-worklets ships its "react-native" field pointing at raw
// TypeScript source (./src/index).  We redirect ALL imports of the package
// — both the root ("react-native-worklets") AND any sub-path like
// "react-native-worklets/threads" — to the compiled lib/module output so
// Babel only ever receives plain JavaScript (not TypeScript).
//
// Private class fields in the compiled output are handled by setting
// unstable_transformProfile: "hermes-v0" in babel.config.js, which
// enables @babel/plugin-transform-class-properties and related plugins.
const workletsLib = path.resolve(
  __dirname,
  "node_modules/react-native-worklets/lib/module"
);

const nativeWindResolve = finalConfig.resolver.resolveRequest;
finalConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  // Only intercept the root package import and known JS sub-paths.
  // Do NOT intercept `.json` imports (package.json), deep paths that already
  // include `lib/module/`, or the `plugin` sub-path (which is a Babel plugin
  // that runs in Node.js, not in the bundle).
  const isWorkletsRoot = moduleName === "react-native-worklets";
  const isWorkletsJsSubpath =
    moduleName.startsWith("react-native-worklets/") &&
    !moduleName.endsWith(".json") &&
    !moduleName.includes("react-native-worklets/plugin") &&
    !moduleName.includes("/lib/module/") &&
    !moduleName.includes("/src/");

  if (isWorkletsRoot || isWorkletsJsSubpath) {
    const sub = isWorkletsRoot
      ? "index.js"
      : moduleName.slice("react-native-worklets/".length);
    const filePath = path.resolve(
      workletsLib,
      sub.endsWith(".js") ? sub : `${sub}.js`
    );
    return { type: "sourceFile", filePath };
  }
  if (nativeWindResolve) {
    return nativeWindResolve(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = finalConfig;
