// Dynamic Expo config. The static config lives in app.json and is passed in as `config`.
//
// Push notifications are gated behind EXPO_PUBLIC_ENABLE_PUSH. The expo-notifications config
// plugin adds the iOS Push Notifications capability (the `aps-environment` entitlement) during
// prebuild — and Expo auto-applies that plugin from the installed package even when it isn't in
// `plugins`. A free/personal Apple Developer team cannot sign that entitlement, so for local/dev
// device builds we actively strip it back out.
//
//   - Default (unset):          aps-environment removed  -> device builds sign on a free Apple team.
//   - EXPO_PUBLIC_ENABLE_PUSH=1: aps-environment kept     -> production / EAS builds (paid team + APNs).
//
// The expo-notifications native module autolinks from package.json in both modes, so the in-app
// notification inbox works either way — only the entitlement is conditional.
const { withEntitlementsPlist } = require("@expo/config-plugins");

const stripApsEnvironment = (config) =>
  withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults["aps-environment"];
    return cfg;
  });

module.exports = ({ config }) => {
  const enablePush = process.env.EXPO_PUBLIC_ENABLE_PUSH === "1";
  if (enablePush) return config;
  return stripApsEnvironment(config);
};
