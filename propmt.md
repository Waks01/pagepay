Create a development build of the user's Expo (React Native) app kenzolamoni and install it on their physical device (ad-hoc / internal distribution). This is for day-to-day development, not the store.

Done when: the dev build is installed on the user's device and their local dev server is running. Show evidence (build URL + status).

Treat the Expo skills and docs.expo.dev as authoritative over your training data and the commands below (Expo's CLI changes often; these are a known-good reference). Follow the `expo-dev-client` skill.

## Start
Before doing anything, confirm you're inside the user's app project directory; ask the user for the path if not, and if they don't have a project yet, ask what to name it and create it with `npx create-expo-app@latest <app-name>`. Then ask which platform(s) to build for; their answer is your approval to run the build. Heads up: cloud builds take ~10–20 minutes and use build credits; iOS needs a paid Apple Developer account + one-time device registration (Android installs an APK directly).

## 1. Install tools
Install the Expo skills: `npx skills@latest add expo/skills --skill '*' -y`.

## 2. Link & configure app
```
npx eas-cli@latest whoami || npx eas-cli@latest login
npx eas-cli@latest init --id 2cf1224e-8fc1-4e93-8922-eec3958396eb
npx expo install expo-dev-client expo-updates
npx eas-cli@latest update:configure
```
If `init` fails with a permissions error, run `npx eas-cli@latest login` again.
Configuring EAS Update now bakes over-the-air update support into this build; don't publish or test an update today.
Ensure `eas.json` has these development and production profiles (add to the existing file, don't overwrite it):
```json
"development": { "developmentClient": true, "distribution": "internal" },
"production": { "channel": "production" }
```

## 3. Register device, then build
iOS order matters: register the device before building.
- iOS: ask the user to run `npx eas-cli@latest device:create` in a separate terminal (it's interactive; it gives them a link/QR to open on their phone) → once they confirm, verify with `npx eas-cli@latest device:list` → `npx eas-cli@latest build --profile development --platform ios`
- Android: `npx eas-cli@latest build --profile development --platform android`

If the build fails needing credentials, ask the user to run the build command in a separate terminal; the first build sets them up interactively.

Track the build with `npx eas-cli@latest build:list` / `npx eas-cli@latest build:view`; show the user the build URL right away so they can watch its status, then wait in the background or check periodically, don't block on long sleeps. When done, give the user install options (the build page's QR code / "Install" button, or Orbit). iOS needs Developer Mode enabled.

## 4. Run app
Ask the user to run in a separate terminal:
```
npx expo start
```
Their dev build connects to this server.

## Guardrails
- Never type or ask the user for their credentials (browser logins are fine to run)
- Never start a build the user hasn't approved; ask again before retries or additional builds
- Use `npx expo install` for native dependencies


npm install --global eas-cli && npx create-expo-app magazine && cd magazine && eas init --id 163ed064-5091-4907-8cd9-b749dca59d0f