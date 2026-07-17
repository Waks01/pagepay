/**
 * User preferences that need to survive across screens but never
 * leave the device — theme override + language placeholder.
 *
 * Why a Zustand store and not just reading `useColorScheme()`:
 * the user needs to be able to override the OS preference. We layer
 * the override on top in `useEffectiveScheme()` so that toggling to
 * Dark actually sticks after a relaunch.
 *
 * Persistence: preferences are loaded once on app start
 * (`bootstrapPreferences`) and saved on every change. We keep them
 * in expo-secure-store alongside the auth token — they're small,
 * infrequently-written, and don't deserve their own keychain entry.
 * (AsyncStorage would be the wrong tool here per project constraints.)
 */
import { create } from 'zustand';
import { Platform } from 'react-native';

export type ThemePref = 'system' | 'light' | 'dark' | 'sepia';
export type LanguagePref = 'en' | 'pcm' | 'yo' | 'ha' | 'ig';
// v3 §3.4: per-work reader mode. The mode switcher in the reader
// updates this; the choice is then re-sent to the server via
// POST /progress/finish { reader_mode }. 'read' is the default for
// new users.
export type ReaderMode = 'read' | 'study' | 'listen';

type PreferencesState = {
  theme: ThemePref;
  language: LanguagePref;
  onboardingCompleted: boolean;
  hydrated: boolean;
  biometricEnabled: boolean;
  readerMode: ReaderMode;
  setTheme: (t: ThemePref) => void;
  setLanguage: (l: LanguagePref) => void;
  setOnboardingCompleted: (v: boolean) => void;
  setBiometricEnabled: (v: boolean) => void;
  setReaderMode: (m: ReaderMode) => void;
};

const DEFAULTS: Pick<
  PreferencesState,
  'theme' | 'language' | 'onboardingCompleted' | 'biometricEnabled' | 'readerMode'
> = {
  theme: 'system',
  language: 'en',
  onboardingCompleted: false,
  biometricEnabled: false,
  readerMode: 'read',
};

export const usePreferences = create<PreferencesState>((set) => ({
  ...DEFAULTS,
  hydrated: false,
  setTheme: (theme) => set({ theme }),
  setLanguage: (language) => set({ language }),
  setOnboardingCompleted: (onboardingCompleted) =>
    set({ onboardingCompleted }),
  setBiometricEnabled: (biometricEnabled) => set({ biometricEnabled }),
  setReaderMode: (readerMode) => set({ readerMode }),
}));

/**
 * Hydrate the store from expo-secure-store on app start. Safe to call
 * before the token is loaded — preferences live under separate keys.
 */
export async function bootstrapPreferences(): Promise<void> {
  const saved = await loadPreferences();
  usePreferences.setState({ ...DEFAULTS, ...saved, hydrated: true });
}

async function loadPreferences(): Promise<Partial<PreferencesState>> {
  try {
    const raw = await readPref('theme');
    const lang = await readPref('language');
    const onboarded = await readPref('onboarding_completed');
    const biometric = await readPref('biometric_enabled');
    const readerModeRaw = await readPref('reader_mode');
    return {
      theme: isThemePref(raw) ? raw : DEFAULTS.theme,
      language: isLanguagePref(lang) ? lang : DEFAULTS.language,
      onboardingCompleted: onboarded === 'true',
      biometricEnabled: biometric === 'true',
      // Defensive parse: an attacker who can write the secure
      // store could set the mode to something invalid. We
      // silently fall back to 'read' rather than crashing the
      // reader on mount.
      readerMode: isReaderMode(readerModeRaw) ? readerModeRaw : DEFAULTS.readerMode,
    };
  } catch {
    return {};
  }
}

function isThemePref(v: string | null): v is ThemePref {
  return v === 'system' || v === 'light' || v === 'dark' || v === 'sepia';
}

function isLanguagePref(v: string | null): v is LanguagePref {
  return v === 'en' || v === 'pcm' || v === 'yo' || v === 'ha' || v === 'ig';
}

function isReaderMode(v: string | null): v is ReaderMode {
  return v === 'read' || v === 'study' || v === 'listen';
}

/**
 * Persist the current `theme` value to expo-secure-store. Fire and
 * forget — failures are logged but don't block the UI.
 */
export async function persistTheme(theme: ThemePref): Promise<void> {
  await writePref('theme', theme);
}

export async function persistLanguage(language: LanguagePref): Promise<void> {
  await writePref('language', language);
}

/**
 * Persist the onboarding-completed flag. Called once when the user taps
 * "Get started" on the final onboarding screen. We keep this as a
 * separate key (not bundled with the other prefs) so it can be reset
 * independently for QA without nuking the user's theme or language.
 */
export async function persistOnboardingCompleted(
  value: boolean,
): Promise<void> {
  await writePref('onboarding_completed', value ? 'true' : 'false');
}

export async function persistBiometricEnabled(
  value: boolean,
): Promise<void> {
  await writePref('biometric_enabled', value ? 'true' : 'false');
}

/**
 * Persist the active reader mode. Same fire-and-forget shape as the
 * other helpers — failures are non-fatal because the in-memory store
 * already reflects the new value, and a rehydrate on next launch
 * will simply re-read the last good write.
 */
export async function persistReaderMode(mode: ReaderMode): Promise<void> {
  await writePref('reader_mode', mode);
}

// ── Storage helpers ───────────────────────────────────────────────────
// Keep these here (rather than next to `storage.ts`'s token helpers)
// because preferences are conceptually a separate concern with their
// own failure modes — we never want a theme write to nuke the auth
// token. The functions are named generically so future prefs can
// reuse them without renaming.

const isWeb = Platform.OS === 'web';

async function readPref(key: string): Promise<string | null> {
  if (isWeb) {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(`pagepay_pref_${key}`);
  }
  const SecureStore = await import('expo-secure-store');
  return await SecureStore.getItemAsync(`pagepay_pref_${key}`);
}

async function writePref(key: string, value: string): Promise<void> {
  if (isWeb) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`pagepay_pref_${key}`, value);
    }
    return;
  }
  const SecureStore = await import('expo-secure-store');
  await SecureStore.setItemAsync(`pagepay_pref_${key}`, value);
}