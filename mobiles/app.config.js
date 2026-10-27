const { expo: baseConfig } = require("./app.json");

const plugins = baseConfig.plugins || [];

module.exports = ({ config }) => {
  return {
    ...config,
    expo: {
      ...baseConfig,
      plugins,
      extra: {
        ...baseConfig.extra,
      },
    },
  };
};
