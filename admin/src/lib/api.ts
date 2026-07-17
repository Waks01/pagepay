import axios from 'axios';
import type { AxiosInstance, AxiosError, InternalAxiosRequestConfig, AxiosResponse } from 'axios';

// VITE_API_URL lets the dev server point at a local backend (e.g.
// `http://localhost:8000/api/v1`) without rebuilding, and the Vite
// proxy in `vite.config.ts` is used when the value is a relative
// `/api/v1`. If unset, fall back to the production Render URL.
//
// Render free tier cold-starts can take 30–60s; the timeout below
// is generous so the first request after idle doesn't get cut off.
const FALLBACK_API_URL = 'https://pagepay-2e6i.onrender.com/api/v1';
export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) || FALLBACK_API_URL;

export const adminApi: AxiosInstance = axios.create({
  baseURL: API_BASE,
  timeout: 60_000,
  withCredentials: true, // Required for httpOnly cookies
  headers: {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  },
});

// No need to manually add Authorization header - httpOnly cookies are sent automatically
adminApi.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  return config;
});

adminApi.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => {
    // Don't handle 401 here - let components handle auth errors
    return Promise.reject(error);
  }
);
