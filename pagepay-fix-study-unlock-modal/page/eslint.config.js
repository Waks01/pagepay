// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const securityPlugin = require('eslint-plugin-security');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  // ── Security rules ──────────────────────────────────────────────
  // eslint-plugin-security catches:
  //   - child_process usage
  //   - non-literal fs paths (path traversal)
  //   - non-literal regex (ReDoS)
  //   - eval / new Function
  //   - timing attacks on HMAC compare (object-shorthand-crypto-api)
  //   - weak crypto (MD5/SHA1)
  // Reference: https://github.com/eslint-community/eslint-plugin-security
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    plugins: { security: securityPlugin },
    rules: {
      ...securityPlugin.configs.recommended.rules,
      // These specific rules are too noisy for an Expo app. Re-enable
      // individually if you need them.
      'security/detect-object-injection': 'off',   // too many false positives on React state
      'security/detect-non-literal-fs-filename': 'warn',  // warn, don't error
      'security/detect-non-literal-regexp': 'warn',
    },
  },
]);
