# Phase 4: Payments & Premium Tier

## Goal
Diversify revenue beyond ads with direct user payments for premium subscriptions.

## Backend Tasks

### 1. Payment Service (`app/services/subscription.py`)
- ✅ Paystack initialization helper
- ✅ Premium tier check helper: `is_premium(user)`
- ✅ Subscription expiry checker
- ✅ Tier benefit calculator (2x points, ad-free)

### 2. Payment Router (`app/routers/payments.py`)
- ✅ `POST /api/v1/payments/initiate` → Start Paystack checkout
- ✅ `POST /api/v1/payments/paystack/webhook` → Handle payment confirmation (subscriptions)
- [ ] `GET /api/v1/payments/history` → User's payment history
- [ ] `GET /api/v1/payments/subscription` → Current subscription status

### 3. Subscription Management
- [ ] Cron job to expire subscriptions (daily loop in docker-compose exists but logic not verified)
- [ ] Auto-revert to FREE tier when expired
- [ ] Grace period logic (3 days)

### 4. Premium Benefits Integration
- [ ] Study unlock: skip ads for premium users
- [ ] Reading points: 2x multiplier for premium
- [ ] Ad-free indicator in wallet

## Frontend Tasks

### 1. Paywall Screen (`app/(tabs)/wallet.tsx` → premium upsell modal)
- ✅ Two-column comparison (Free vs Premium)
- [ ] Feature list with checkmarks
- [ ] Price display with monthly/yearly toggle
- [ ] "Upgrade Now" CTA

### 2. Checkout Flow
- ✅ Paystack Web SDK integration (hosted checkout)
- ✅ `expo-web-browser` for hosted checkout
- ✅ Success callback handler
- ✅ Error handling + retry

### 3. Premium UI Indicators
- [ ] Gold badge in profile
- [ ] "Premium" pill in wallet
- [ ] Billing history screen
- [ ] Subscription management screen

### 4. Benefit Application
- [ ] Skip UnlockModal for premium users
- [ ] Show 2x multiplier in reading rewards
- [ ] Hide ad CTAs for premium users

## Database Changes
✅ Already exists:
- `payments` table with Paystack tx_ref
- `User.tier` enum (FREE | PREMIUM_MONTHLY | PREMIUM_YEARLY)
- `User.subscription_expires_at` datetime

## Configuration
Add to `.env`:
```
PAYSTACK_SECRET_KEY=sk_test_...
PAYSTACK_PUBLIC_KEY=pk_test_...
```
There is no `PAYSTACK_WEBHOOK_SECRET` — Paystack signs webhooks with the **secret key**.

## Pricing (Nigeria) — as shipped
- **Premium Monthly**: ₦3,000
- **Premium Yearly**: ₦30,000

> **One plan, not two.** The June 2026 plan had Study+ (₦1,000/₦10,000) and
> Complete+ (₦2,000/₦20,000). They shipped as one **₦3,000/mo or ₦30,000/yr**
> plan (commit `6ce5d72`) — the two tiers differed only in multipliers on
> broken code paths, so there was nothing to justify a 2x price gap. The four
> legacy `UserTier` keys still exist and all resolve to this same plan,
> because renaming the enum is a data migration and an unknown key falls
> back to the *free* tier.
>
> What ₦3,000 buys: free asset unlocks, free audio narration, 15 chat
> turns/day, 1.5x reading/task/bills/daily multipliers, a **2,500 SV monthly
> allowance** and a **30% top-up discount** (both service credit, never
> cashable). Ad rewards stay 1.0x — free and paid both get a flat 16 SV.

## Premium Benefits
1. **Free study material unlocks** (no points cost)
2. **Full audio narration** (all units)
3. **Skip education unit progression**
4. **1.5x point multipliers** on reading, tasks, daily rewards, bills cashback
5. **Ad-free** — this is the upgrade reason; rewarded ads are optional for free users
6. **Priority task verification**
7. **Gold badge**
8. **Billing history** access
9. **2,500 SV monthly allowance** + 30% top-up discount

## Test Mode
Use Paystack test cards:
- Success: `4084084084084081`
- Decline: `5060666666666666666`

## Acceptance Criteria
- [ ] Free user sees paywall in study unlock flow
- [ ] Premium user bypasses unlock modals automatically
- [ ] Reading points 2x for premium (verified in wallet)
- [ ] Paystack webhook confirms payment + updates tier
- [ ] Subscription expires → auto-revert to FREE (cron exists but logic needs verification)
- [ ] Billing history shows all transactions
- [ ] Play Store update: "PagePay: Read, Study, Learn & Earn (Premium)"
