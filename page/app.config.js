require("dotenv").config();

// Import base configuration from app.json
const { expo: baseConfig } = require("./app.json");

const plugins = baseConfig.plugins || [];

// Ensure expo-asset is registered as a plugin. expo-audio requires it,
// and it must appear explicitly in the plugins array for native module
// resolution on bare/development builds.
if (
  !plugins.some(
    (p) => p === "expo-asset" || (Array.isArray(p) && p[0] === "expo-asset"),
  )
) {
  plugins.push("expo-asset");
}

// AdMob (Google Mobile Ads). The plugin writes the app id into
// AndroidManifest.xml and Info.plist during prebuild - the SDK crashes
// on launch without it, so this is not optional. The app id is the
// same for both platforms (one shared publisher account).
//
// The App ID is not a secret, but it is still environment-specific, so
// it comes from the environment with the published value as a default.
const ADMOB_APP_ID =
  process.env.EXPO_PUBLIC_ADMOB_APP_ID || "ca-app-pub-3898064484524772~6521009021";

if (
  !plugins.some(
    (p) =>
      p === "react-native-google-mobile-ads" ||
      (Array.isArray(p) && p[0] === "react-native-google-mobile-ads"),
  )
) {
  plugins.push([
    "react-native-google-mobile-ads",
    {
      androidAppId: ADMOB_APP_ID,
      iosAppId: ADMOB_APP_ID,
      // Measurement init is deferred until after first consent so the
      // install is not attributed before the user can opt out.
      delayAppMeasurementInit: false,
      optimizeInitialization: false,
      optimizeAdLoading: false,
      userTrackingUsageDescription:
        "This identifier will be used to deliver personalized ads to you.",
      // Google's own SKAdNetwork id plus the AppLovin adapter's, so
      // attribution survives the AppLovin mediation work.
      skAdNetworkItems: [
        "cstr6suwn9.skadnetwork",
        "5lqr1luk2.appsflyer.com",
        "d458n6t649.cloudfront.net",
        "wv4l6k4y3.rs6.net",
        "98i0fp3t.1o1.net",
        "taps.apple.com",
        "pkheln.app-measurement.com",
      ],
    },
  ]);
}

// Writes the IAB app-ads.txt into the Android assets during prebuild.
// The android/ directory is generated and gitignored, so this cannot be
// a committed file.
if (!plugins.some((p) => p === "./plugins/withAdMobAssets")) {
  plugins.push("./plugins/withAdMobAssets");
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
        apiUrl:
          process.env.EXPO_PUBLIC_API_URL ||
          "https://pagepay-fff6.onrender.com",
        paystackPublicKey: process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY || "",
      },
    },
  };
};