import { PageMark } from './animations';

/**
 * PagePay brand unit: pulsing mint brand mark + PagePay wordmark +
 * Admin pill. Mirrors the brand assembly used in
 * `client/app/(auth)/login.tsx` (PageMark above the headline).
 */
export function PagePayLogo() {
  return (
    <div className="mb-6 flex flex-col items-center gap-3">
      <PageMark width={40} height={3} variant="pulse" />
      <div className="flex items-center gap-2">
        <span
          className="text-xl font-bold text-text-main"
          style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif" }}
        >
          PagePay
        </span>
        <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-white">
          Admin
        </span>
      </div>
    </div>
  );
}
