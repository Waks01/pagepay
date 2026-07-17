import Constants from 'expo-constants';
import { getToken, saveToken, getRefreshToken, saveRefreshToken, clearToken } from '@/src/shared/lib/storage';

// Read API URL from expo-constants (loaded from app.config.js -> .env).
const API_URL =
  Constants.expoConfig?.extra?.apiUrl ||
  process.env.EXPO_PUBLIC_API_URL ||
  'https://pagepay-2e6i.onrender.com';
export { API_URL };

/** Global callback the layout registers so apiFetch can redirect
 *  to the login screen when the server rejects a token (401).
 *  Set from _layout.tsx via setOnUnauthenticated. */
let _onUnauthenticated: (() => void) | null = null;
export function setOnUnauthenticated(cb: () => void) {
  _onUnauthenticated = cb;
}

let _isRefreshing = false;
let _refreshPromise: Promise<void> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken || _isRefreshing) {
    return false;
  }

  _isRefreshing = true;
  _refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!res.ok) {
        await clearToken();
        return;
      }

      const data = await res.json();
      if (data.access_token) {
        await saveToken(data.access_token);
        if (data.refresh_token) {
          await saveRefreshToken(data.refresh_token);
        }
      }
    } catch {
      await clearToken();
    } finally {
      _isRefreshing = false;
      _refreshPromise = null;
    }
  })();

  return _refreshPromise.then(() => true).catch(() => false);
}

export async function publicApiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const isFormData = options.body instanceof FormData;
  const headers: HeadersInit = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...options.headers,
  };

  try {
    return await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
    });
  } catch (e) {
    if (__DEV__) {
      console.error(`[publicApiFetch] network error: ${API_URL}${path}`, e);
    }
    throw new Error(
      `Can't reach the server at ${API_URL}. Check your connection and try again.`,
    );
  }
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const isFormData = options.body instanceof FormData;
  const headers: HeadersInit = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
    });
  } catch (e) {
    if (__DEV__) {
      console.error(`[apiFetch] network error: ${API_URL}${path}`, e);
    }
    throw new Error(
      `Can't reach the server at ${API_URL}. Check your connection and try again.`,
    );
  }

  if (res.status === 401 && path !== '/api/v1/auth/refresh') {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const newToken = await getToken();
      const newHeaders: HeadersInit = {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(newToken ? { Authorization: `Bearer ${newToken}` } : {}),
        ...options.headers,
      };
      try {
        res = await fetch(`${API_URL}${path}`, {
          ...options,
          headers: newHeaders,
        });
      } catch {
        await clearToken();
        _onUnauthenticated?.();
        throw new Error('Network error during token refresh');
      }
    } else {
      await clearToken();
      _onUnauthenticated?.();
    }
  }

  return res;
}

