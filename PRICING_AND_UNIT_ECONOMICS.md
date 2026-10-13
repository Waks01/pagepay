# PagePay — Pricing, Unit Economics & Ads Plan

> **Status:** proposed, not implemented. Reference document.
> **Purpose:** single source of truth for what features cost, what to charge,
> and how ads fit — so pricing decisions are made against measured numbers
> rather than guesses.
>
> All Cloudflare prices are from
> [developers.cloudflare.com/workers-ai/platform/pricing](https://developers.cloudflare.com/workers-ai/platform/pricing).
> Conversion: **10 SV = ₦1** (`points_per_naira`, `config.py:622`), and points
> and SV are the same unit — `money.kobo_to_points` is what credits both.
> FX: ₦1,332.5/USD (CBN NFEM, 9 Oct 2026).

---

## 1. TL;DR

1. **Only two of six AI features are priced above cost.** Narration and asset
   unlocks are healthy (2.2×). Chat, exams, asset *generation*, uploads and
   OCR are free and cost real money.
2. **The biggest single lever is not price — it is model routing.** We send
   every chat turn to GLM-4.7-Flash at ₦2.43/turn when Cloudflare's
   Granite 4.0 H-Micro would do the same job for **₦0.68/turn**, a 3.6× cut.
3. **Bills/VTU — our only cash margin — roughly breaks even** against the
   credits its cashback issues. ₦10.50 kept on ₦1,000 airtime funds ~₦10.45
   of asset unlocks.
4. **Recommended structure:** one tier at **₦3,000/mo**, hybrid
   (allowance + top-up), with **Granite for simple turns and GLM reserved
   for complex ones**, plus an optional rewarded-ad economy for free users.
5. **Ads are worth adding but only as rewarded video, never interstitial
   during study** — and the payout must be tied to measured eCPM or it
   becomes a loss at low eCPM.

---

## 2. The measured cost base

Every figure below is what Cloudflare bills us per user action.

| Action | Model | Cost to us | Currently charged | Margin |
|---|---|---|---|---|
| Chat turn (typical, 50k material) | GLM-4.7-Flash | **₦2.43** | ₦0 (quota only) | −100% |
| Chat turn (100k budget worst case) | GLM-4.7-Flash | ₦3.38 | ₦0 | −100% |
| Upload text (SOW parse) | GLM-4.7-Flash | ₦2.60 | ₦0 | −100% |
| Upload image (OCR + parse) | Llama-3.2-11B-Vision | ₦3.58 | ₦0 | −100% |
| Take an exam | GLM-4.7-Flash | ₦1.35 | ₦0, **no quota** | −100% |
| Generate an asset | GLM-4.7-Flash | ₦2.13 | ₦0 (paid at unlock) | ok if unlocked |
| Asset unlock | — | ₦2.13 | 50 SV (₦5.00) | **2.35×** ✅ |
| Narration episode (5.4k chars) | GLM + MeloTTS | ₦3.38 | 76 SV (₦7.60) | **2.25×** ✅ |

Per-character narration: **₦0.43/1,000 chars**, of which MeloTTS is ~69%.
Free-tier chat today (50/day) costs **₦3,645/user/month** against ₦0 revenue (₦4,597 at the 100k-char document budget).

### Cloudflare model prices actually in use

| Model | Input /M | Output /M | Used for |
|---|---|---|---|
| `@cf/zai-org/glm-4.7-flash` | $0.060 | $0.400 | all text AI, narration scripts |
| `@cf/meta/llama-3.2-11b-vision-instruct` | $0.049 | $0.676 | image OCR |
| `@cf/myshell-ai/melotts` | — | $0.0002 /audio min | all TTS |
| **`@cf/ibm-granite/granite-4.0-h-micro`** | **$0.017** | **$0.112** | **proposed for simple turns** |

None of these require a paid billing method; 10,000 neurons/day are free
(~58 narration episodes/day at ~170 neurons each).

---

## 3. What the research says

Synthesised from Freemius, aipricinglab, Inworld, RAITHub, Nabeel Hassan,
and the TSE study on LLM pricing.

**Hybrid is the consensus.** *"For most AI apps, the right answer is hybrid
pricing: a base subscription with a defined usage allowance and overage
billing."* And the warning: *"flat subscription pricing is the fastest way to
subsidize your heaviest users with revenue from your lightest ones."*

**Price around the heavy user, not the median.** *"Price around your heaviest
realistic user — not your median customer. Packages that work 'on average'
can still break under power users."*

**The conversion multiplier.** *"Only about 3 percent of consumer AI users
ever pay, so every paying user's margin must carry roughly 33 free users'
AI bills."* At our current 5 free chats/day and ₦2.43/turn, a payer carries
~₦12,375 of free-tier cost against ₦2,000 revenue. Routing to Granite makes
that ₦3,366 — still over, which is why the free quota is part of the fix.

**Limit in units the user understands.** *"'Three lectures a week' is honest
and predictable. '500 credits' makes people do arithmetic and feel
tricked."* Our SV is abstract; messages-per-day is not.

**Tier models by value.** RAITHub routes 70/20/10 across light/mid/premium
models and gets ~25% below all-mid-tier. Inworld notes an ~81× spread between
the cheapest and most expensive stack for the same workload.

**Aven — the closest comparable.** A study app with our exact feature set:

| | Free | Pro | Max |
|---|---|---|---|
| Standard AI Tutor | 5 msgs/day | unlimited | unlimited |
| Premium AI Tutor | — | 10/day | 100/day |
| Price | — | US$10/mo | US$20/mo |

Aven splits AI by *model cost*, gives the cheap tier generously, caps the
expensive tier even for payers, and explicitly avoids pooled credits.

**Price reality check.** Khanmigo is **US$4/mo (₦5,330)** — the reference for
what families already pay for an AI tutor. Our proposed ₦2,000 is roughly a
third of that.

---

## 4. The gap: we run one model for everything

GLM-4.7-Flash is a reasoning-capable model. Most student questions — "what is
osmosis?", "define mitosis" — do not need it.

| Tier | Model | Turn cost | Use for |
|---|---|---|---|
| **Standard** | Granite 4.0 H-Micro | **₦0.68** | definitions, recall, direct lookups, rephrasing |
| **Premium** | GLM-4.7-Flash | ₦2.43 | multi-step reasoning, exam strategy, "why" questions, marking |

Routing target: **70% Standard / 20% Premium / 10% Premium-escalated-on-retry.**

That single change is worth more than any price adjustment:

| | At ₦2.43/turn | At ₦0.68/turn |
|---|---|---|
| 5 free turns/day | ₦365/user/month | **₦102** |
| 30 turns/day (paid allowance) | ₦2,190/month | **₦612** |

**Quality caveat:** Granite is a "micro" model and will be measurably worse
on reasoning. It must be validated on an evaluation set before it answers
students anything — a router that sends hard maths to the light tier saves
money while students quietly get wrong answers.

---

## 5. Proposed pricing

### Metered prices (SV, 10 SV = ₦1)

| Action | Cost | Proposed price | Margin |
|---|---|---|---|
| Chat, Standard tier | ₦0.68 | 15 SV (₦1.50) | 55% |
| Chat, Premium tier | ₦2.43 | 35 SV (₦3.50) | 31% |
| Upload material | ₦2.60 | **free, 2/month** | acquisition |
| Upload image (OCR) | ₦3.58 | **free, 1/month** | acquisition |
| Exam attempt | ₦1.35 | **free, 3/day** | retention |
| Asset unlock | ₦2.13 | 50 SV (₦5.00) | 58% ✅ keep |
| Narration episode | ₦3.38 | 76 SV (₦7.60) | 55% ✅ keep |

Uploads and exams stay free deliberately: upload is the one-time entry point
(charging kills the funnel) and exams are the retention hook whose cost the
bills margin absorbs. **Chat is the only thing metered per-use**, because it
is the recurring unbounded cost.

### Tiers

| | Free | **PagePay+** |
|---|---|---|
| **Price** | ₦0 | **₦3,000/mo or ₦30,000/yr** |
| Chat — Standard | 5/day | 30/day |
| Chat — Premium | not included | 10/day |
| SV allowance | — | **2,500 SV/month** (₦250 of compute) |
| Top-up discount | — | **30% off** (₦0.07/SV) |
| Exams | 3/day | unlimited (≤20/day) |
| Uploads | 2/month | 6/month |
| Ads | **optional rewarded** | **none** |
| Asset unlock / narration | paid | paid, drawn from allowance |

| PagePay+ at full use | |
|---|---|
| Revenue | ₦3,000 |
| Chat, 30 Standard + 10 Premium | ₦306 + ₦250 = ₦556 |
| Allowance draw (2,500 SV) | ₦250 |
| **Net** | **₦2,194 — 73%** |

Plus every top-up SV beyond the allowance is **~64% margin** (₦0.07 paid,
₦0.025 to serve) — that is the engine, and it scales with engagement.

### Why ₦3,000 and not ₦2,000

At ₦2,000 with 15 Standard + 5 Premium turns the margin is ~50% but the quota
is thin. ₦3,000 buys a genuinely generous allowance while sitting between
Khanmigo's ₦5,330 (US benchmark) and what a Nigerian student will pay. It is
also defensible in the market — ₦3,000 is roughly the price of a data bundle.

### What changed versus the earlier proposal

One tier (not two) — with tasks removed, the only remaining differentiator is
a bills multiplier sitting on broken code. Selling two tiers on a broken
premise is worse than one tier priced correctly.

---

## 6. Ads — analysis

The ad economy was **designed and then mostly deleted.** The SSV pipeline is
gone (no `ads.py` router, no AdMob/AppLovin code), but the payout constants,
the revenue split, and the tier-benefits rows advertising ad rewards all
remain. Reading rewards, daily rewards and referrals are currently
**unfunded platform money** — ads were meant to be the offset.

### What exists

| Setting | Value | Where |
|---|---|---|
| `rewarded_ad_payout_points` | **20** pts (₦2.00) | `config.py:127` |
| `platform_ad_revenue_percent` | **0.20** | `config.py:603` |
| `daily_ad_impression_cap` | 200 | `config.py:151` |
| `SV_PER_AD_FREE_TIER` | **16** pts | `services/discount.py:22` |
| `SV_PER_AD_PREMIUM_TIER` | **24** pts | `services/discount.py:23` |

⚠️ **Already inconsistent:** config says pay 20 pts per ad; `discount.py`
pays 16 (free) / 24 (premium). And 24 pts implies ₦3.00 of ad revenue at 80%
share — an eCPM ~50% higher than the 16-pt figure assumes. Pick one.

### Economics

Assuming **$1.50 eCPM** (₦2.00 per 1,000 impressions, a defensible Nigerian
rewarded-video mid-range) and 10 ads/day per active free user:

| | |
|---|---|
| 300 ads/month per user | |
| Ad revenue | 300 × ₦2.00 = **₦600** |
| Paid out at 16 pts | 300 × ₦1.60 = **₦480** |
| **Platform keeps** | **₦120/month** |

That ₦120 is what funds the reading (2 pts/slice), daily (50 pts/day) and
referral (500+200 pts) rewards — currently pure cost. It covers ~80% of the
daily reward alone. **Ads make the reward economy roughly neutral instead of
a straight loss.**

### The risk that decides it

eCPM in West Africa swings hard. At **$0.80 eCPM** (₦1.07/ad):

- Revenue: 300 × ₦1.07 = ₦320
- Payout at 16 pts: ₦480
- **Loss of ₦160/month per active ad-watcher**

**The payout must be config-driven and monitored against measured eCPM**, or
a bad quarter turns the reward economy into a cash drain. Cap the payout
headroom, and re-derive `SV_PER_AD` from the trailing 7-day eCPM rather than
hardcoding it.

### How to structure it (if added)

| | Free | PagePay+ |
|---|---|---|
| Rewarded video | Optional, +16 SV, max **10/day** | **None — ad-free is the upgrade reason** |
| Banner | Study hub only, never mid-session | None |
| Interstitial | **Never during study or exam** | None |

Rules that follow from this:
- **Never interrupt a study session or an exam with an interstitial.** It is
  the single fastest way to destroy retention in an education product.
- **Ad-free becomes the real Study+/Complete+ differentiator** — which solves
  the "tiers differ only on bills" problem created by removing tasks.
- **Rewarded ads are optional and user-initiated** — a student who wants SV
  watches one; one who doesn't, doesn't.
- `react-native-google-mobile-ads` is already a dependency; the ad *code* is
  not. App size and battery cost of the SDK is real and worth measuring
  before committing.

### My recommendation on ads

**Yes, but scoped: rewarded video only, 10/day free tier, ad-free for
PagePay+, no interstitals.** It funds an existing reward economy, it gives
the paid tier a genuine reason to exist, and it is the only revenue that
scales with engagement without charging a price-sensitive user more.

**Do it after model routing**, because routing changes the cost the ads need
to subsidise — and doing ads first means calibrating payouts against costs
that are about to drop 3.6×.

---

## 7. Implementation order

| # | Work | Effort | Why in this position |
|---|---|---|---|
| 1 | **Model routing** (Standard/Premium split) | 2–3 days + eval set | 3.6× cost cut; every later decision depends on it |
| 2 | **Fix the ad payout inconsistency** (20 vs 16/24) | 1 hour | Cheap; blocks any ad work |
| 3 | **Meter chat** at 15/35 SV by tier | 1 day | Closes the ₦3,645/user/month hole |
| 4 | **Cap generation behind unlock** | 0.5 day | Stops paying ₦2.13 for unbought assets |
| 5 | **Quotas**: uploads 2/mo, exams 3/day, chat 5/day | 0.5 day | Bounds free-tier cost |
| 6 | **Add rewarded ads** (optional) | 3–4 days | Funds the reward economy; differentiates paid tier |
| 7 | **Collapse to one tier at ₦3,000** | 1 day | After the multipliers are trustworthy |
| 8 | **Per-user cost logging** (p50/p90/p99 by cohort) | 1 day | Without this, none of the above is measurable |

Step 8 is not optional in spirit — every source emphasises that you cannot
manage this model without cost-per-active-user telemetry split by free and
paid.

---

## 8. Open decisions

1. **Routing eval set** — what's the minimum quality bar Granite must clear on
   student questions before it answers anything? Needs a labelled set of real
   student questions per subject.
2. **Ad eCPM baseline** — do we have any AdMob account history, or start from
   the $1.50 assumption and recalibrate after 30 days?
3. **Tier count** — one tier, or two once ad-free and Premium-AI limits give a
   genuine reason for a higher tier?
4. **Narration pricing** — 76 SV/episode is our healthiest margin. Should
   PagePay+ include a small narration allowance instead of requiring SV?

---

## Appendix — where the numbers came from

- Cloudflare pricing page, verified via WebFetch
- `backend/tests/test_study_audio.py` — marginal-cost floor assertions
- `backend/app/services/money.py` + `config.py:622` — the SV↔₦ rate
- `backend/app/routers/bills.py:107` `_compute_points` — the commission split
- Freemius *AI app pricing models*, aipricinglab *Seats vs Usage vs Credits*,
  Inworld *Unit economics of consumer AI apps*, RAITHub *AI Tutor Cost per
  Student*, Nabeel Hassan *Every Free User Costs You Money*,
  Toulouse School of Economics *How should AI be priced?*, and
  `aven.study/subscription-terms`
