# PagePay: Product Steering & Memory

This document captures product vision, non-negotiable principles, and key decisions. All agents (human or AI) working on PagePay must read and respect this.

---

## Vision
PagePay is a **read-to-earn + AI study platform** that rewards users for reading and learning, while generating sustainable revenue through advertising and premium subscriptions. We serve two core audiences:
1. **Casual readers** seeking leisure content (public domain books, news, viral articles)
2. **Students** preparing for exams via AI-generated quizzes, flashcards, and chat tutors.

We win by making both groups feel respected: readers get clean, immersive reading with voluntary ad choices. Students get real utility that directly improves their grades. We win on ad revenue and direct payments.

---

## Brand Identity
- **Name:** PagePay
- **Tagline:** Read Stories & AI Exam Prep
- **Primary Color:** #6C5CE7 (trustworthy purple)
- **Secondary Color:** #00B894 (money/growth green)
- **Typography:** SpaceGrotesk (headers); system font (body text)
- **Tone:** Professional yet rewarding. We do not use FOMO tactics or manipulative dark patterns. Users stay because they earn real value, not because they're trapped.

---

## Business Mindset
This is not a prototype, not a side project, not a learning exercise. Every line of code must be production-ready because we are generating real revenue from Day 1. If it cannot run against real providers, real databases, real ad SDKs, and real payment gateways, it does not ship. Placeholders, TODOs, and mock data are forbidden in committed code.

## Non-Negotiable Principles

### 1. Transparency in Monetization
- All ads are explicitly labeled ("Sponsored", "Ad", "Watch to earn bonus")
- Never trick users into clicking ads
- Rewarded ads are opt-in: users choose to watch in exchange for points
- Premium tier pricing is flat and clear (₦500/month), no hidden auto-renewals without consent

### 2. Data Privacy Guardrails
- Student SOW/syllabus content may use Google AI Studio free tier (data used for training opt-in acceptable)
- If user ever uploads sensitive data, route to privacy-compliant provider (Groq/Cerebras keep data private)
- Never store raw payment credentials
- JWT tokens in `expo-secure-store` — never AsyncStorage

### 3. Fair Economics
- User reward < ad revenue per view. We never pay more than we earn.
- SSV (server-side verification) before any point credit. Client callbacks are never trusted.
- Points are server-calculated based on verified reading duration, not client-reported.

### 4. Anti-Cheat Integrity
- AdMob will ban apps for invalid traffic
- Client-side: app-state pause on background; heartbeat every 10s with scroll + app_state
- Server-side fraud checks run on session end
- NOTE: >100px/30s scroll threshold and "Read Check" modal every 5 articles are NOT implemented. Current design: 1-minute read slices with 5k character chunks.

### 5. Phased Shipping Strategy
Every phase is a standalone, monetizing product:
- Phase 1: Reads to Play Store (proves content consumption)
- Phase 2: Ads added (proves revenue)
- Phase 3: Study tab (proves student retention)
- Phase 4: Payments (proves direct revenue)
- Phase 5: Referrals (proves organic growth)
- Phase 6: Licensed content (proves scaling)

**Do not defer shipping.** If Phase 1 passes QA, ship it. Add features via OTA (Expo) or binary updates later.

---

## Key Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Mobile-first (not web) | Higher eCPM, harder to bot, better retention with push |
| Expo SDK 54+ (New Architecture) | Required for modern native modules, EAS Build/Update, managed workflow |
| FastAPI + MySQL 8.0 (local dev) + PostgreSQL 18 (production Render) | Python-native AI support, async scales, Render deployment |
| AdMob primary (AppLovin deferred) | Fill rate (AdMob) + optional alternative provider later |
| Gemini for heavy SOW | 1M context window handles full syllabus in one call |
| Paystack (not Flutterwave) | Better Nigerian market support, simpler API, no OAuth complexity |
| Points-first, cash-payout-later | Regulatory simplicity — no KYC for in-app wallet |
| Peyflex for bills/VTU | Real-time commission API, works with all Nigerian networks/utilities |
| 70% commission to users | Most competitive in market vs OPay (67%), builds loyalty |
| Wallet deposit caps enforced | 1.5% fee logic not yet implemented on webhook; deposit fee note is future work |

---

## Content Acquisition Status

**Free/Licensed (launch-ready):**
- Gutendex (public domain) — commercial reuse allowed
- GNews (free tier) — your AdMob owns monetization
- Hive API — free, but crypto complexity

**Post-launch goals (needs DAU proof first):**
- Taboola/Outbrain — revenue share, requires approval
- NewsBreak/SmartNews — selective, needs distribution proof
- Wattpad/Inkitt — B2B contract only

---

## AI Provider Status & Selection

- **Gemini Flash:** 1,500 req/day free, 1M context. Primary for heavy tasks.
- **Groq:** ~1,000 req/day, fastest inference. Primary for real-time quizzes/chat.
- **OpenRouter:** 50-1,000 req/day. Best failover key.
- **Cerebras:** ~1M tokens/day BUT volatile catalog. Optional.
- **Mistral:** ~1B tokens/month free but uses data for training. Avoid for user data.

Route logic: heavy → Gemini, fast → Groq, fallback → OpenRouter.

---

## Brand Voice & Copy

- **Headlines:** Actionable, benefit-first. "Earn while you read." "Study smarter, earn real rewards."
- **Error messages:** No blame. "Something went wrong. Tap retry." NOT "You broke it."
- **Onboarding:** 3 screens max. (1) Read & earn points. (2) Study with AI. (3) Cash out or go premium.
- **Push notifications:** "Your 3-day streak is waiting 🔥" / "New study material ready" / NOT "CLICK NOW!!"

---

## Hard Constraints (Do Not Violate)
1. Do NOT ship without client-side anti-cheat in reader
2. Do NOT process payments in test mode with real money
3. Do NOT use sync AI clients in async FastAPI routes
4. Do NOT commit `.env` with real secrets to git
5. Do NOT run production backend as root in Docker
6. Do NOT use Expo Go to build with AdMob
7. Do NOT leave TODO comments, placeholder values, or mock data in any committed code — this is not a prototype; it is a revenue-generating product from Day 1
8. Do NOT merge or ship a phase until ALL tests pass: unit tests (backend) + lint/typecheck (frontend) + E2E smoke test (critical user flows)
9. Do NOT accept "we'll add it later" for core paths. If a feature cannot ship complete, it does not ship.
10. Do NOT write code that assumes "test mode" or "later integration" — everything connected to real providers, real DB, real ad SDK credentials.

---

## Future Horizons
- Token withdrawal to bank (after KYC registration)
- University partnerships (bulk premium for students)
- Author revenue share (crowdsourced fiction writers)
- Web3 layer (Hive rewards auto-conversion to local currency)
- Global expansion: India, Kenya, Philippines with localized content
