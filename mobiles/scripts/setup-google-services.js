#!/usr/bin/env node
// EAS Build hook: create google-services.json from GOOGLE_SERVICES_JSON_BASE64.
// Wired into the `eas-build-pre-install` npm script in package.json so it runs
// after `npm install` and before `expo prebuild`. Safe to run locally — if the
// env var is absent (e.g. plain `npm install` on a dev machine), it's a no-op.

const fs = require('fs');
const path = require('path');

// Only run on EAS. Detected via EAS_PROJECT_DIR (set by eas-cli on builds).
if (!process.env.EAS_PROJECT_DIR && !process.env.GOOGLE_SERVICES_JSON_BASE64) {
  console.log('setup-google-services: skipped (not on EAS)');
  process.exit(0);
}

const base64Content = process.env.GOOGLE_SERVICES_JSON_BASE64;

if (!base64Content) {
  console.error('Error: GOOGLE_SERVICES_JSON_BASE64 environment variable is not set');
  process.exit(1);
}

try {
  console.log('Creating google-services.json from environment variable...');
  
  const jsonContent = Buffer.from(base64Content, 'base64').toString('utf-8');
  const outputPath = path.join(process.cwd(), 'google-services.json');
  
  fs.writeFileSync(outputPath, jsonContent);
  
  if (!fs.existsSync(outputPath)) {
    console.error('Error: Failed to create google-services.json');
    process.exit(1);
  }
  
  console.log('✓ google-services.json created successfully');
  process.exit(0);
} catch (error) {
  console.error('Error creating google-services.json:', error.message);
  process.exit(1);
}
