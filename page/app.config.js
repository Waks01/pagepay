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
