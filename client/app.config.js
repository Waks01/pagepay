require("dotenv").config();

// Import base configuration from app.json
const { expo: baseConfig } = require("./app.json");

// ── AdMob App ID per environment ────────────────────────────────────────
// MUST match the unit IDs the backend returns for the same `adsEnv`.
// Google's test App ID pairs with the test unit IDs (env=dev); the real
// PagePay App ID pairs with the real unit IDs (env=prod). Mixing a test
// unit ID with a prod App ID is a classic "no-fill / failed to load"
// cause, because AdMob requires the App ID and unit IDs to share an
// account. The `react-native-google-mobile-ads` plugin writes the App ID
// into AndroidManifest / Info.plist, so this value (not the one in
// app.json) is what the SDK actually initializes with.
const TEST_ADMOB_APP_ID_ANDROID = "ca-app-pub-3940256099942544~3347511713";
const TEST_ADMOB_APP_ID_IOS = "ca-app-pub-3940256099942544~1712483245";
const PROD_ADMOB_APP_ID_ANDROID = "ca-app-pub-3898064484524772~6521009021";
const PROD_ADMOB_APP_ID_IOS = "ca-app-pub-3898064484524772~4871553842";

const adsEnv = process.env.EXPO_PUBLIC_ADS_ENV || "dev";
const isProdAds = adsEnv === "prod";

// Re-map the AdMob plugin entry so the App ID follows the same env switch
// as the unit IDs the backend serves.
const plugins = (baseConfig.plugins || []).map((plugin) => {
  if (Array.isArray(plugin) && plugin[0] === "react-native-google-mobile-ads") {
    return [
      "react-native-google-mobile-ads",
      {
        androidAppId: isProdAds ? PROD_ADMOB_APP_ID_ANDROID : TEST_ADMOB_APP_ID_ANDROID,
        iosAppId: isProdAds ? PROD_ADMOB_APP_ID_IOS : TEST_ADMOB_APP_ID_IOS,
      },
    ];
  }
  return plugin;
});

// Ensure expo-asset is registered as a plugin. expo-audio requires it,
// and it must appear explicitly in the plugins array for native module
// resolution on bare/development builds.
if (!plugins.some((p) => p === "expo-asset" || (Array.isArray(p) && p[0] === "expo-asset"))) {
  plugins.push("expo-asset");
}

module.exports = ({ config }) => {
  return {
    ...config,
    expo: {
      ...baseConfig,
      plugins,
      extra: {
        ...baseConfig.extra,
        // Dynamic environment-specific values
        apiUrl: process.env.EXPO_PUBLIC_API_URL || "https://pagepay-fff6.onrender.com",
        adsEnv,
        paystackPublicKey: process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY || "",
      },
    },
  };
};
