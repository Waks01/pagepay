import Constants from "expo-constants";
import {
  getToken,
  saveToken,
  getRefreshToken,
  saveRefreshToken,
  clearToken,
} from "@/src/shared/lib/storage";

// Read API URL from expo-constants (loaded from app.config.js -> .env).
const API_URL =
  Constants.expoConfig?.extra?.apiUrl ||
  process.env.EXPO_PUBLIC_API_URL ||
  "https://pagepay-fff6.onrender.com";
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

export async function publicApiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const isFormData = options.body instanceof FormData;
  const clientDate = new Date().toISOString().split("T")[0];
  const headers: HeadersInit = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    "X-Client-Date": clientDate,
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

export async function apiFetch(
  path: string,
  options: RequestInit = {},
  retries = 2,
): Promise<Response> {
  const token = await getToken();
  const isFormData = options.body instanceof FormData;
  const clientDate = new Date().toISOString().split("T")[0];
  const headers: HeadersInit = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "X-Client-Date": clientDate,
    ...options.headers,
  };

  if (__DEV__) {
    const method = options.method || "GET";
    const bodyKind = isFormData
      ? "FormData"
      : options.body
        ? typeof options.body === "string"
          ? `json(${options.body.length}b)`
          : "body"
        : "none";
    console.log(
      `[apiFetch] → ${method} ${API_URL}${path} auth=${token ? "yes" : "no"} body=${bodyKind}`,
    );
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, {
        ...options,
        headers,
      });
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (__DEV__) {
        console.error(
          `[apiFetch] NETWORK ERROR ${API_URL}${path}`,
          lastError.message,
        );
      }
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw new Error(
        `Can't reach the server at ${API_URL}. Check your connection and try again.`,
      );
    }

    if (__DEV__) {
      console.log(`[apiFetch] ← ${res.status} ${API_URL}${path}`);
    }

    if (res.status === 502 && attempt < retries) {
      if (__DEV__) {
        console.warn(
          `[apiFetch] 502 on ${path}, retrying (${attempt + 1}/${retries})`,
        );
      }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      continue;
    }

    if (res.status === 401 && path !== "/api/v1/auth/refresh") {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        const newToken = await getToken();
        const newHeaders: HeadersInit = {
          ...(isFormData ? {} : { "Content-Type": "application/json" }),
          ...(newToken ? { Authorization: `Bearer ${newToken}` } : {}),
          ...options.headers,
        };
        try {
          res = await fetch(`${API_URL}${path}`, {
            ...options,
            headers: newHeaders,
          });
        } catch {
          _onUnauthenticated?.();
          throw new Error("Network error during token refresh");
        }
      } else {
        _onUnauthenticated?.();
        throw new Error("Unauthorized");
      }
    }

    return res;
  }

  throw lastError || new Error(`Failed to reach ${API_URL}${path} after ${retries + 1} attempts`);
}

/**
 * Multipart upload via XMLHttpRequest.
 *
 * `fetch()` in React Native does not surface upload progress events —
 * only `XMLHttpRequest` does (via `xhr.upload.onprogress`). This helper
 * is the parallel of `apiFetch` for the two SOW upload endpoints
 * (`/api/v1/study/sow/upload-image` and `/study/sow/upload-document`)
 * where we want wire-level progress.
 *
 * 401 auto-retry is intentionally NOT implemented: retrying a multipart
 * XHR after token refresh is fragile in RN (FormData body reuse, in-
 * flight listeners). If the token expires mid-upload, the caller gets
 * the same "Unauthorized" surface as today.
 */
export type ApiUploadOptions = {
  onProgress?: (loaded: number, total: number) => void;
  timeoutMs?: number;
};

export type ApiUploadResult = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<any>;
  text: () => Promise<string>;
};

export async function apiUpload(
  path: string,
  formData: FormData,
  options: ApiUploadOptions = {},
): Promise<ApiUploadResult> {
  const { onProgress, timeoutMs = 120_000 } = options;
  const token = await getToken();
  const clientDate = new Date().toISOString().split("T")[0];

  if (__DEV__) {
    console.log(
      `[apiUpload] → POST ${API_URL}${path} auth=${token ? "yes" : "no"} timeoutMs=${timeoutMs}`,
    );
  }

  return new Promise<ApiUploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}${path}`, true);
    xhr.timeout = timeoutMs;

    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }
    xhr.setRequestHeader("X-Client-Date", clientDate);
    // Do NOT set Content-Type — RN's runtime adds the multipart
    // boundary when the body is FormData.

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) {
          if (__DEV__) {
            const pct = Math.round((e.loaded / e.total) * 100);
            if (pct % 25 === 0) {
              console.log(
                `[apiUpload] progress ${pct}% (${e.loaded}/${e.total}) ${path}`,
              );
            }
          }
          onProgress(e.loaded, e.total);
        }
      };
    }

    xhr.upload.onerror = (e) => {
      if (__DEV__) {
        console.error(`[apiUpload] UPLOAD PHASE ERROR ${path}`, e);
      }
    };

    xhr.onerror = (e) => {
      // xhr.onerror fires for transport-level failures (DNS, TLS, CORS,
      // connection reset) AND for some non-2xx responses on Android where
      // RN's XHR treats them as a network error. Distinguish by status:
      //   - status > 0: we got a response, just not a success one
      //   - status === 0: real network failure
      if (xhr.status > 0) {
        if (__DEV__) {
          console.error(
            `[apiUpload] HTTP ${xhr.status} ${path} responseText=${xhr.responseText?.slice(0, 500)}`,
          );
        }
        const body = xhr.responseText || "";
        const detail = extractErrorDetail(body, xhr.statusText);
        reject(
          new Error(
            detail
              ? `HTTP ${xhr.status} ${path}: ${detail}`
              : `HTTP ${xhr.status} ${path}: ${xhr.statusText || "(no status text)"}`,
          ),
        );
        return;
      }
      if (__DEV__) {
        console.error(
          `[apiUpload] NETWORK ERROR ${API_URL}${path}`,
          "readyState=",
          xhr.readyState,
          "status=",
          xhr.status,
          "responseText=",
          xhr.responseText?.slice(0, 500),
          e,
        );
      }
      reject(
        new Error(
          `Network error reaching ${API_URL}${path} (readyState=${xhr.readyState}, status=0)`,
        ),
      );
    };
    xhr.ontimeout = () => {
      if (__DEV__) {
        console.error(`[apiUpload] TIMEOUT ${path} after ${timeoutMs}ms`);
      }
      reject(new Error("Upload timed out. Try again on a faster connection."));
    };
    xhr.onload = () => {
      if (__DEV__) {
        console.log(
          `[apiUpload] ← ${xhr.status} ${path} responseText(${xhr.responseText?.length ?? 0}b)=${xhr.responseText?.slice(0, 500)}`,
        );
      }
      if (xhr.status === 401) {
        _onUnauthenticated?.();
        reject(new Error("Unauthorized"));
        return;
      }
      const result: ApiUploadResult = {
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        statusText: xhr.statusText || "",
        json: () => Promise.resolve().then(() => JSON.parse(xhr.responseText || "null")),
        text: () => Promise.resolve(xhr.responseText || ""),
      };
      resolve(result);
    };

    try {
      xhr.send(formData);
    } catch (e) {
      if (__DEV__) {
        console.error(`[apiUpload] SEND THREW ${path}`, e);
      }
      reject(
        new Error(
          `xhr.send threw for ${API_URL}${path}: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
  });
}

/**
 * Best-effort extraction of an error detail from a server response body.
 * Returns the raw text if the body is not JSON, so the caller always sees
 * something useful instead of a generic fallback.
 */
function extractErrorDetail(body: string, statusText: string): string {
  if (!body) return statusText || "";
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed === "string") return parsed;
    if (parsed?.detail) {
      if (typeof parsed.detail === "string") return parsed.detail;
      return JSON.stringify(parsed.detail);
    }
    return JSON.stringify(parsed).slice(0, 500);
  } catch {
    return body.slice(0, 500);
  }
}

// ────────────────────────────────────────────────────────────────────
// Phase 4: Premium Tier Benefits API
// ────────────────────────────────────────────────────────────────────

/**
 * Fetch user's current tier and subscription status
 */
export async function getUserTier(): Promise<{
  tier: "free" | "study_plus_monthly" | "study_plus_yearly" | "complete_plus_monthly" | "complete_plus_yearly";
  is_premium: boolean;
  expires_at: string | null;
}> {
  const res = await apiFetch("/api/v1/users/me");
  if (!res.ok) {
    throw new Error("Failed to fetch user tier");
  }
  const data = await res.json();
  return {
    tier: data.tier || "free",
    is_premium: data.tier !== "free",
    expires_at: data.premium_expires_at || null,
  };
}

/**
 * Fetch tier benefits comparison (for premium upsell screens)
 */
export async function getTierBenefits(): Promise<{
  free: any;
  study_plus_monthly: any;
  study_plus_yearly: any;
  complete_plus_monthly: any;
  complete_plus_yearly: any;
  comparison: any;
}> {
  const res = await publicApiFetch("/api/v1/subscription/tier-benefits");
  if (!res.ok) {
    throw new Error("Failed to fetch tier benefits");
  }
  return res.json();
}
