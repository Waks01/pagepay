import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '@/lib/api';
import type { AdminLoginRequest, AdminLoginResponse } from '@/lib/types';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/shared/components/Input';
import { PagePayLogo } from '@/shared/components/PagePayLogo';
import { AuthScreenEntrance, AnimatedSubmitButton, ErrorShake } from '@/shared/components/animations';

/**
 * Admin login screen. Visual parity with the client app's auth screens
 * (`client/app/(auth)/login.tsx`): warm cream paper background, rounded
 * card with a soft floating shadow, PagePay brand mark + wordmark,
 * staggered entrance, full-width mint submit button, signal-soft
 * error banner, ErrorShake on validation/network failures.
 */
export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorTrigger, setErrorTrigger] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  const onChangeEmail = useCallback((v: string) => {
    setEmail(v);
    // Clear error when user starts typing
    setFieldErrors((p) => (p.email ? { ...p, email: undefined } : p));
  }, []);
  
  const onChangePassword = useCallback((v: string) => {
    setPassword(v);
    // Clear error when user starts typing
    setFieldErrors((p) => (p.password ? { ...p, password: undefined } : p));
  }, []);

  const validateEmail = useCallback((value: string) => {
    if (!value.trim()) {
      return 'Enter your email.';
    }
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      return 'Enter a valid email address.';
    }
    return undefined;
  }, []);

  const validatePassword = useCallback((value: string) => {
    if (!value) {
      return 'Enter your password.';
    }
    if (value.length < 6) {
      return 'Password must be at least 6 characters.';
    }
    return undefined;
  }, []);

  const handleEmailBlur = useCallback(() => {
    const error = validateEmail(email);
    if (error) {
      setFieldErrors((p) => ({ ...p, email: error }));
    }
  }, [email, validateEmail]);

  const handlePasswordBlur = useCallback(() => {
    const error = validatePassword(password);
    if (error) {
      setFieldErrors((p) => ({ ...p, password: error }));
    }
  }, [password, validatePassword]);

  const validate = useCallback(() => {
    const e: { email?: string; password?: string } = {};
    const emailError = validateEmail(email);
    const passwordError = validatePassword(password);
    if (emailError) e.email = emailError;
    if (passwordError) e.password = passwordError;
    return e;
  }, [email, password, validateEmail, validatePassword]);

  const handleLogin = useCallback(async () => {
    setFormError(null);
    const v = validate();
    setFieldErrors(v);
    if (Object.keys(v).length > 0) {
      setErrorTrigger(true);
      setTimeout(() => setErrorTrigger(false), 600);
      return;
    }

    setLoading(true);
    try {
      // adminApi's 401 interceptor will only fire if a real token
      // is present and rejected — login itself does not have a
      // token, so a 401 here is a normal "wrong creds" response and
      // we map it to a friendly error.
      const { data } = await adminApi.post<AdminLoginResponse>('/admin/auth/login', {
        email,
        password,
      } satisfies AdminLoginRequest);

      // With httpOnly cookies, token is stored in cookie by backend
      // We only store role and permissions in client state
      setAuth(data.role, data.permissions);
      setSuccess(true);
      setTimeout(() => navigate('/dashboard', { replace: true }), 700);
    } catch (err) {
      const axiosError = err as any;
      const status = axiosError?.response?.status;
      const detail = axiosError?.response?.data?.detail;
      const detailStr = typeof detail === 'string' ? detail : '';

      // Surface the server-provided detail when available; fall back
      // to a short human-friendly string for well-known status codes
      // so the user isn't left staring at "500".
      if (detailStr) {
        setFormError(detailStr);
      } else if (status === 401) {
        setFormError("That email and password don't match.");
      } else if (status) {
        setFormError(`Server error (${status}). Check Render logs for details.`);
      } else {
        setFormError("Connection failed. Check the backend is running.");
      }
      setErrorTrigger(true);
      setTimeout(() => setErrorTrigger(false), 600);
    } finally {
      setLoading(false);
    }
  }, [email, password, navigate, setAuth, validate]);

  // Reset the trigger on unmount so it doesn't fire on a fresh mount.
  useEffect(() => () => setErrorTrigger(false), []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-body px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-bg-card p-6 shadow-[0_12px_24px_rgba(0,0,0,0.06)] sm:p-8">
        <ErrorShake trigger={errorTrigger}>
          <PagePayLogo />

          <AuthScreenEntrance
            title="Welcome back."
            subtitle="Sign in to manage the platform."
          />

          {formError && (
            <div className="mb-4 rounded-[10px] border border-error bg-error-50 px-3 py-2.5 text-[13px] leading-[18px] text-error">
              {formError}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleLogin();
            }}
            className="space-y-4"
          >
            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => onChangeEmail(e.target.value)}
              onBlur={handleEmailBlur}
              autoCapitalize="none"
              autoCorrect="off"
              error={fieldErrors.email}
            />
            <Input
              label="Password"
              type="password"
              placeholder="Your password"
              value={password}
              onChange={(e) => onChangePassword(e.target.value)}
              onBlur={handlePasswordBlur}
              autoCapitalize="none"
              autoCorrect="off"
              error={fieldErrors.password}
            />

            <div className="flex justify-end">
              <button
                type="button"
                className="text-sm font-medium text-text-muted transition-colors hover:text-text-main"
                onClick={() =>
                  alert(
                    "Password reset isn't enabled for admin accounts yet. Reach out to a super admin if you're locked out.",
                  )
                }
              >
                Forgot password?
              </button>
            </div>

            <AnimatedSubmitButton
              title="Sign in"
              isLoading={loading}
              isSuccess={success}
              onClick={handleLogin}
            />

            <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 pt-1">
              <span className="text-sm text-text-muted">Need access?</span>
              <button
                type="button"
                className="text-sm font-semibold text-primary transition-opacity hover:opacity-80"
                onClick={() => alert('Ask a super admin to create your account.')}
              >
                Contact a super admin  →
              </button>
            </div>
          </form>
        </ErrorShake>
      </div>
    </div>
  );
}
