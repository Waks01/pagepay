#!/bin/bash
# EAS Build hook to create google-services.json from environment variable
# This runs before the build starts

set -e

if [ -z "$GOOGLE_SERVICES_JSON_BASE64" ]; then
  echo "Error: GOOGLE_SERVICES_JSON_BASE64 environment variable is not set"
  exit 1
fi

echo "Creating google-services.json from environment variable..."
echo "$GOOGLE_SERVICES_JSON_BASE64" | base64 -d > google-services.json

if [ ! -f google-services.json ]; then
  echo "Error: Failed to create google-services.json"
  exit 1
fi

echo "✓ google-services.json created successfully"
