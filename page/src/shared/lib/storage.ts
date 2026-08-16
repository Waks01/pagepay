import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'pagepay_access_token';
const REFRESH_TOKEN_KEY = 'pagepay_refresh_token';

const isWeb = Platform.OS === 'web';

// Module-level in-memory cache. The auth token never changes without an
// explicit save/clear, so reading it once per app launch (then keeping
// it in memory) is correct and saves a secure-store bridge roundtrip
// on every apiFetch call. Tab switches mount screens that fire several
// useQuery hooks; each used to await getToken() before its request
// could go out. With this cache, getToken() is a synchronous memory
// read after the first call, and the first call is the only bridge hit.
//
// State:
//   undefined → not loaded yet (first read goes to secure store)
//   null      → confirmed no token (logged out / cleared)
//   string    → cached token
let _tokenCache: string | null | undefined = undefined;
let _refreshTokenCache: string | null | undefined = undefined;
let _tokenLoadPromise: Promise<string | null> | null = null;
let _refreshLoadPromise: Promise<string | null> | null = null;

async function loadTokenCache(): Promise<string | null> {
  if (_tokenCache !== undefined) return _tokenCache;
  if (_tokenLoadPromise) return _tokenLoadPromise;
  _tokenLoadPromise = (async () => {
    if (isWeb) {
      _tokenCache = localStorage.getItem(TOKEN_KEY);
    } else {
      _tokenCache = await SecureStore.getItemAsync(TOKEN_KEY);
    }
    return _tokenCache;
  })();
  return _tokenLoadPromise;
}

async function loadRefreshTokenCache(): Promise<string | null> {
  if (_refreshTokenCache !== undefined) return _refreshTokenCache;
  if (_refreshLoadPromise) return _refreshLoadPromise;
  _refreshLoadPromise = (async () => {
    if (isWeb) {
      _refreshTokenCache = localStorage.getItem(REFRESH_TOKEN_KEY);
    } else {
      _refreshTokenCache = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    }
    return _refreshTokenCache;
  })();
  return _refreshLoadPromise;
}

/**
 * Kick off the token cache load eagerly at app start. Safe to call
 * multiple times — the underlying promise is memoized. After this
 * resolves, getToken() returns a memory value with zero bridge cost.
 */
export function warmTokenCache(): void {
  void loadTokenCache();
  void loadRefreshTokenCache();
}

export async function saveToken(token: string): Promise<void> {
  _tokenCache = token;
  if (isWeb) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  }
}

export async function getToken(): Promise<string | null> {
  return loadTokenCache();
}

export async function saveRefreshToken(token: string): Promise<void> {
  _refreshTokenCache = token;
  if (isWeb) {
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
  } else {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
  }
}

export async function getRefreshToken(): Promise<string | null> {
  return loadRefreshTokenCache();
}

export async function clearToken(clearRefresh = true): Promise<void> {
  _tokenCache = null;
  if (isWeb) {
    localStorage.removeItem(TOKEN_KEY);
    if (clearRefresh) {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      _refreshTokenCache = null;
    }
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    if (clearRefresh) {
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
      _refreshTokenCache = null;
    }
  }
}

export async function clearRefreshToken(): Promise<void> {
  _refreshTokenCache = null;
  if (isWeb) {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } else {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  }
}
