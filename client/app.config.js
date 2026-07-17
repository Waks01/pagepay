require("dotenv").config();

// Import base configuration from app.json
const { expo: baseConfig } = require("./app.json");

module.exports = ({ config }) => {
  return {
    ...config,
    expo: {
      ...baseConfig,
      extra: {
        ...baseConfig.extra,
        // Dynamic environment-specific values
        apiUrl: process.env.EXPO_PUBLIC_API_URL || "https://pagepay-2e6i.onrender.com",
        adsEnv: process.env.EXPO_PUBLIC_ADS_ENV || "dev"
      }
    }
  };
};
