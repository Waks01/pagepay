# PagePay: Product Steering & Memory

This document captures product vision, non-negotiable principles, and key decisions. All agents (human or AI) working on PagePay must read and respect this.

**Last updated: October 20, 2026.** Phases 1–8 are shipped; the project is in
**Phase 9 — Monetization Hardening**. The authoritative current-state
documents are this file, `PRICING_AND_UNIT_ECONOMICS.md`, `admob.md` and
`.kilo/agent/*.md`. Where any other document disagrees with those, they
disagree with the code and should be corrected.

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
- Premium pricing is flat and clear — **one plan, ₦3,000/month or ₦30,000/year** — no hidden auto-renewals without consent. (The old Study+ ₦1,000 / Complete+ ₦2,000 two-tier structure is gone; the legacy tier keys remain in the enum but all resolve to this one plan.)
- Free and paid users get the **same** 16 SV per rewarded ad. The tier difference is ad-free vs ads, not payout size.

### 2. Data Privacy Guardrails
- All AI processing happens on Cloudflare Workers AI. Student SOW/syllabus content is sent there — route genuinely sensitive uploads to a private provider only if one is ever added.
- Never store raw payment credentials
- JWT tokens in `expo-secure-store` — never AsyncStorage

### 3. Fair Economics
- User reward < ad revenue per view. We never pay more than we earn.
- SSV (server-side verification) before any point credit. Client callbacks are never trusted.
- Points are server-calculated based on verified reading duration, not client-reported.
- **Ad-earned credit goes to `service_credit_balance`, never `cashable_balance`.** The 60% ad margin exists only because the liability is service, not cash; withdrawable, it collapses to 20%.
- Bills commission is credited the same way — never as cash. (See commit `c5a8011` for the cash drain this fixed.)

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
- Phase 7: Task marketplace (proves two-sided marketplace)
- Phase 8: Bills & VTU (proves cash margin)
- Phase 9: Monetization hardening (proves the unit economics hold)

**Do not defer shipping.** If Phase 1 passes QA, ship it. Add features via OTA (Expo) or binary updates later.

---

## Key Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Mobile-first (not web) | Higher eCPM, harder to bot, better retention with push |
| Expo SDK 57 (New Architecture) | Required for modern native modules, EAS Build/Update, managed workflow |
| FastAPI + PostgreSQL 18 (asyncpg), Neon in production, API on Render | Python-native AI support, async scales, Render deployment. There is no MySQL anywhere in the project. |
| AdMob only (AppLovin deferred) | Fill rate, and it is the only network with a live SSV endpoint. The `applovin_sdk_key` config field is inert. |
| Cloudflare Workers AI for all AI | One endpoint, one bill, one set of credentials. Two models on it (Granite for cheap turns, GLM for reasoning) rather than two providers. |
| Paystack (not Flutterwave) | Better Nigerian market support, simpler API, no OAuth complexity. The Flutterwave config fields are inert — no router references them. |
| Points-first, cash-payout-later | Regulatory simplicity — no KYC for in-app wallet |
| Peyflex **or** BigiSub for bills/VTU | Real-time commission API, works with all Nigerian networks/utilities. `settings.bills_provider` selects; default `peyflex`. |
| 70% commission to users | Most competitive in market vs OPay (67%), builds loyalty |
| One paid tier at ₦3,000/mo or ₦30,000/yr | The two old tiers differed only in multipliers on broken code paths, so there was nothing to justify a 2x price gap. The four legacy `UserTier` keys stay (renaming the enum is a data migration and an unknown key falls back to free — a rename could silently demote paying users). |
| Ad payout is a flat 16 SV, no tier multiplier | A bigger paid payout means paying more to the users who can most afford to watch more. The tier difference is ad-free vs ads. |
| Ad-earned credit goes to `service_credit_balance`, never cashable | The 60% ad margin exists only because the liability is service, not cash. Withdrawable, it collapses to 20% and a bad eCPM quarter turns it into a loss. |
| Wallet deposit caps enforced | 1.5% fee logic not yet implemented on webhook; deposit fee note is future work |

---

## Content Acquisition Status

**Shipped:**
- Gutendex (public domain) — commercial reuse allowed — `services/content/gutendex.py`
- GNews (free tier) — your AdMob owns monetization — `services/content/gnews.py`
- OpenStax (OER textbooks, CC-licensed) — `services/content/openstax.py`

**Not integrated (the plan called for these):**
- Hive API — free, but crypto complexity
- RSS feeds

**Post-launch goals (needs DAU proof first):**
- Taboola/Outbrain — revenue share, requires approval
- NewsBreak/SmartNews — selective, needs distribution proof
- Wattpad/Inkitt — B2B contract only

---

## AI Provider Status & Selection

**Current (Oct 2026):** single paid provider — Cloudflare Workers AI, four models:

| Model | Role | Price (USD/M) |
|---|---|---|
| `@cf/ibm-granite/granite-4.0-h-micro` | **Standard** — definitions, recall, lookups | $0.017 in / $0.112 out |
| `@cf/zai-org/glm-4.7-flash` | **Premium** — reasoning, marking, all generation | $0.060 in / $0.400 out |
| `@cf/meta/llama-3.2-11b-vision-instruct` | OCR of images and rendered PDF pages | $0.049 in / $0.676 out |
| `@cf/myshell-ai/melotts` | Narration TTS | $0.0002 / audio-min |

The earlier free multi-provider pool (Gemini/Groq/OpenRouter/Kilo Gateway) was
removed in commit `cd01eff`; only the Cloudflare client remains in
`backend/app/ai/router.py`.

Consequences we work within:
- **No free tier** → `/study/chat` enforces a per-user daily quota
  (`study_chat_daily_limit` = 5, premium `study_chat_premium_daily_limit` = 15)
  and the task type sets temperature. Reasoning is disabled per call via
  `chat_template_kwargs` — leaving it on triples billed output tokens.
- **No failover** → a Cloudflare outage is a 503 on every AI feature. When
  revenue justifies it, add a second provider.
- **Cost control is model routing, not provider failover.** `app/ai/routing.py::classify_turn()`
  sends simple questions to Granite (~₦0.68/turn) and escalates reasoning to
  GLM (~₦2.43/turn) — a 3.6x cut on any turn the cheap model can answer
  correctly. It errs toward premium: a cheap wrong answer costs a student
  more than a saved fraction.
- **Everything is metered or logged.** Free chat 5/day, paid tier 15/day,
  then SV-purchased turns (15 SV standard, 35 SV premium) capped at 50
  billable/day. `AiUsageLog.cost_usd` + `services/ai_cost.py` make per-user
  cost measurable. **Uploads and exams are still unmetered** — that is an
  open gap.
- **Response shape:** Cloudflare returns text in `result.response`, not the
  OpenAI-style `result.choices[0].message.content`. Reading the wrong key
  silently produces an empty response and a 503.

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
