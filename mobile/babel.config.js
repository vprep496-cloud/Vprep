module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        "babel-preset-expo",
        {
          jsxImportSource: "nativewind",
          // Force the hermes-v0 transform profile so that private class
          // fields (#field) and class properties are compiled to
          // prototype-based equivalents.  babel-preset-expo >=56 defaults
          // to "hermes-stable" (hermes-v1) which skips those transforms
          // assuming the runtime supports them natively — but Expo Go's
          // bundled Hermes does not yet support private fields, so we
          // opt back into the safer hermes-v0 transforms.
          unstable_transformProfile: "hermes-v0",
        },
      ],
      "nativewind/babel",
    ],
    plugins: [
      // Reanimated plugin has to be listed last
      "react-native-reanimated/plugin",
    ],
  };
};
