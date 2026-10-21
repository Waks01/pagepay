# PagePay — Pricing, Unit Economics & Ads Plan

> **Status: mostly implemented.** The model below was proposed in October
> 2026 and the implementation-order list in §7 has been executed. What is
> *not* done is marked ❌. Updated October 20, 2026.
>
> **Purpose:** single source of truth for what features cost, what we charge,
> and how ads fit — so pricing decisions are made against measured numbers
> rather than guesses.
>
> All Cloudflare prices are from
> [developers.cloudflare.com/workers-ai/platform/pricing](https://developers.cloudflare.com/workers-ai/platform/pricing).
> Conversion: **10 SV = ₦1** (`points_per_naira`, `config.py:622`), and points
> and SV are the same unit — `money.kobo_to_points` is what credits both.
> FX: ₦1,332.5/USD (CBN NFEM, 9 Oct 2026).
>
> **Shipped state of each §7 item:**

| # | Work | Status |
|---|---|---|
| 1 | Model routing (Standard/Premium split) | ✅ shipped — `app/ai/routing.py::classify_turn`, `ai_routing_enabled` |
| 2 | Fix the ad payout inconsistency (20 vs 16/24) | ✅ shipped — `rewarded_ad_gross_points` / `rewarded_ad_payout_points` |
| 3 | Meter chat at 15/35 SV by tier | ✅ shipped — `study_chat_sv_standard` / `study_chat_sv_premium` |
| 3b | Rename the payout config, derive it from the revenue share | ✅ shipped — `platform_ad_revenue_percent` |
| 4 | Cap generation behind unlock | ✅ shipped — charged at generation, not at unlock |
| 5 | Quotas: uploads 2/mo, exams 3/day, chat 5/day | ⚠️ **chat only** — uploads and exams are still unmetered |
| 6 | Ad formats: native rewarded + banner + breakpoint interstitials | ❌ **the client pipeline was never built** |
| 7 | Collapse to one tier at ₦3,000 | ✅ shipped — `6ce5d72` |
| 8 | Per-user cost logging (p50/p90/p99 by cohort) | ✅ shipped — `AiUsageLog.cost_usd`, `services/ai_cost.py` |
| 9 | *(new)* SV allowance + top-up discount | ✅ shipped — `services/sv_allowance.py`, `premium_top_up_discount_percent` |
| 10 | *(new)* Routing eval set — the quality bar Granite must clear | ❌ **not started** — no labelled set exists |

---

## 1. TL;DR

1. **Only two of six AI features are priced above cost.** Narration and asset
   unlocks are healthy (2.2x). Chat, exams, asset *generation*, uploads and
   OCR are free and cost real money.
2. **The biggest single lever is not price - it is model routing.** We send
   every chat turn to GLM-4.7-Flash at ₦2.43/turn when Cloudflare's
   Granite 4.0 H-Micro would do the same job for **₦0.68/turn**, a 3.6x cut.
3. **Bills/VTU - our only cash margin - roughly breaks even** against the
   credits its cashback issues. ₦10.50 kept on ₦1,000 airtime funds
   ~₦10.45 of asset unlocks.
4. **Recommended structure (decided):** one tier at **₦3,000/mo or
   ₦30,000/yr**, hybrid (allowance + top-up discount), **Granite for
   standard chat and GLM reserved for Premium chat**, with a **flat 16 SV per
   rewarded ad** for free and paid users alike.
5. **Ads are the leg that makes the free tier affordable** - ~60% net per ad
   at a $1.50 eCPM, because the payout is spendable service (costing
   ~₦0.81) rather than cash. Interstitials only at natural breakpoints.
6. **The one condition:** ad-earned SV must land in `service_credit_balance`,
   never `cashable_balance`. Withdrawable, the 60% margin collapses to 20% and
   a bad eCPM quarter turns it into a loss.

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

> **Shipped.** One paid plan, not two. The four legacy tier keys
> (`study_plus_monthly`, `study_plus_yearly`, `complete_plus_monthly`,
> `complete_plus_yearly`) all resolve to this same plan — renaming the
> `UserTier` enum is a data migration, and an unknown key falls back to the
> *free* tier, so a rename could silently demote paying users.

| | Free | **PagePay+** |
|---|---|---|
| **Price** | ₦0 | **₦3,000/mo or ₦30,000/yr** |
| Chat — Standard | 5/day | 30/day |
| Chat — Premium | not included | 10/day |
| SV allowance | — | **2,500 SV/month** (₦250 of compute) |
| Top-up discount | — | **30% off** (₦0.07/SV) |
| Exams | 3/day | unlimited (≤20/day) |
| Uploads | 2/month | 6/month |
| Ads | **optional rewarded** (16 SV/ad) | **none — ad-free is the upgrade reason** |
| Asset unlock / narration | paid | paid, drawn from allowance |

> **Rows marked in the table above that are NOT yet enforced:** the
> per-tier chat allowances (the shipped caps are 5/day free, 15/day paid
> tier, 50 SV-purchased turns/day), the exam quota (3/day vs unlimited),
> and the upload quota (2/month vs 6/month). Only the 5/15/50 chat quota
> and the 2,500 SV allowance are actually wired today. The allowance and
> the 30% top-up discount **are** shipped (`services/sv_allowance.py`,
> `premium_top_up_discount_percent`); the quotas are not.

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

## 6. Ads — decided structure

**Strategy:** ads run alongside the user, not in their way. *They do their
thing, we do ours.* Users are never blocked from studying.

| Format | Placement | Notes |
|---|---|---|
| **Native advanced rewarded** | User-initiated, opt-in | The primary earner. A student who wants SV watches one; one who doesn't, doesn't. |
| **Small banner** | Persistent, low-profile (tab roots, below content) | Minimal revenue, must not eat reader screen space |
| **Interstitial** | **Natural breakpoints only** — after finishing an exam, leaving the reader, returning to a tab root | Never mid-exam, never mid-lesson, never on app open |

Interstitial placement rules are not negotiable for a study product: a
full-screen ad interrupting an exam or a reading session is the fastest way
to destroy retention, and AdMob policy independently prohibits interstitials
that interfere with app use or appear unexpectedly on app open.

### The payout — no tier multiplier

**Free and paid users both get 16 SV per rewarded ad.** No multiplier, ever.
The tier difference is simply **ad-free vs ads**, not a bigger payout.

Rejecting the earlier SV_PER_AD_PREMIUM_TIER = 24: a higher paid payout
means paying more to the users who can most afford to watch more, and it
makes the unit economics depend on tier mix. Flat is simpler and cheaper.

### The economics — and a correction

> **Correction to an earlier claim:** I first modelled the 16 SV payout as
> ₦1.60 of *cash* and concluded ads lose money below .50 eCPM. That was
> wrong. SV is a **spendable service credit**, not cash, so its cost to us
> is what it costs to *serve* — roughly **₦0.81** for 16 SV.

Cost to serve one SV, from measured action costs (blended, ₦0.0505/SV):

| Action | SV | Our cost | Per SV |
|---|---|---|---|
| Asset unlock | 50 | ₦2.13 | ₦0.043 |
| Narration episode | 76 | ₦3.38 | ₦0.045 |
| Chat, Standard | 15 | ₦0.68 | ₦0.045 |
| Chat, Premium | 35 | ₦2.43 | ₦0.069 |

So at the target .50 eCPM (₦2.00 per impression, and ₦2.00 is exactly
20 SV — the 80/20 split in platform_ad_revenue_percent):

| | ₦ |
|---|---|
| AdMob pays us (₦2.00/ad) | **₦2.00** |
| Cost to serve 16 SV | **₦0.81** |
| **Net per ad** | **₦1.19 — 60%** |

| eCPM | Revenue/ad | Service cost | Net | Margin |
|---|---|---|---|---|
| .80 (Nigerian trough) | ₦1.07 | ₦0.81 | **+₦0.26** | **24%** |
| .50 (target) | ₦2.00 | ₦0.81 | **+₦1.19** | **60%** |
| .00 (good quarter) | ₦4.00 | ₦0.81 | **+₦3.19** | **80%** |

**Break-even is ~.61 eCPM** — below any plausible Nigerian rewarded-video
rate. This is a far more robust model than the 80/20 framing suggests, and it
stays positive through a bad quarter.

### The one condition that makes it work

**Ad-earned SV must land in service_credit_balance, never
cashable_balance.** The 60% margin exists only because the liability is
service, not cash:

- spendable → our cost is ~₦0.81 per 16 SV → **60% margin**
- withdrawable → our cost is the full ₦1.60 of cash → **20% margin**, and at
  .80 eCPM it becomes a **loss**

This is the same guard already applied to bills commission in commit
c5a8011 — fabricate nothing, and never route an estimate to a withdrawable
balance. Worth an explicit test.

### Naming fix needed

config.rewarded_ad_payout_points = 20 is the **gross** ad value, not the
payout — the payout is 16 (80%). The name invites exactly the mistake I made.
Rename to 
ewarded_ad_gross_points and add

ewarded_ad_payout_points = 16, or derive the payout from
platform_ad_revenue_percent so the two can never disagree.

### What funds what

At 10 ads/day per active free user (300/month):

| | ₦/user/month |
|---|---|
| Ad revenue | ₦600 |
| Service cost issued | ₦243 |
| **Net** | **₦357** |

Against current unfunded rewards — daily reward ₦150, referrals ₦70 (capped),
welcome ₦10 — ads do more than cover the reward economy, with ₦120+ left for
infrastructure. **This is the leg that makes the free tier affordable.**

### AdMob compliance (non-negotiable)

- Never incentivise *clicks* — reward the completed view only.
- Rewarded ads must not gate essential functionality.
- No interstitials on app open or mid-activity.
- 
eact-native-google-mobile-ads is already a dependency; no ad code
  exists yet. App size and battery cost is real — measure before committing.

## 7. Implementation order

| # | Work | Effort | Status | Why in this position |
|---|---|---|---|---|
| 1 | **Model routing** (Standard/Premium split) | 2–3 days + eval set | ✅ done (eval set still missing) | 3.6× cost cut; every later decision depends on it |
| 2 | **Fix the ad payout inconsistency** (20 vs 16/24) | 1 hour | ✅ done | Cheap; blocks any ad work |
| 3 | **Meter chat** at 15/35 SV by tier | 1 day | ✅ done | Closes the ₦3,645/user/month hole |
| 3b | **Rename `rewarded_ad_payout_points` to gross; derive payout from `platform_ad_revenue_percent`** | 1 hr | ✅ done | Prevents the 20-vs-16 confusion that misled this analysis |
| 4 | **Cap generation behind unlock** | 0.5 day | ✅ done | Stops paying ₦2.13 for unbought assets |
| 5 | **Quotas**: uploads 2/mo, exams 3/day, chat 5/day | 0.5 day | ⚠️ chat only | Bounds free-tier cost — **uploads and exams are still unbounded** |
| 6 | **Ad formats**: native rewarded + small banner + breakpoint interstitials | 4–5 days | ❌ **not started** | Funds the reward economy (~60% margin); gives the paid tier a real ad-free reason |
| 7 | **Collapse to one tier at ₦3,000** | 1 day | ✅ done | After the multipliers are trustworthy |
| 8 | **Per-user cost logging** (p50/p90/p99 by cohort) | 1 day | ✅ done | Without this, none of the above is measurable |
| 9 | **SV allowance + top-up discount** | 1 day | ✅ done | Makes ₦3,000 defensible against cost |
| 10 | **Routing eval set** | 1–2 days | ❌ **not started** | The quality bar Granite must clear before it answers students anything |

Step 8 is not optional in spirit — every source emphasises that you cannot
manage this model without cost-per-active-user telemetry split by free and
paid.

**The critical path now is #6.** Everything else is in place, but the app
has no ad code at all: no config plugin in `app.config.js` (without the App
IDs the native SDK crashes on launch), no `mobileAds()` init, no ad
components, no call sites. The backend SSV endpoint
(`GET /api/v1/study/ads/complete`) is live and verified. Until the client
ships there are no impressions, and ads are the leg that funds the free
tier. See `admob.md` §9 for the rollout checklist.

---

## 8. Decisions taken and still open

**Taken:**

1. **One tier** at ₦3,000/mo or ₦30,000/yr for now. A second tier can be
   added later, once ad-free and Premium-AI limits give a genuine reason
   for one. *(shipped)*
2. **Ad payout is 16 SV flat**, for free and paid users alike, with no
   multiplier. The tier difference is ad-free vs ads, not payout size.
   *(shipped)*
3. **Ad formats:** native advanced rewarded (user-initiated) plus small
   banners, with interstitials at natural breakpoints only — never
   mid-exam, never mid-lesson, never on app open. *(decided; not built)*
4. **Ad revenue model:** ₦2.00 gross per ad (20 SV) at the $1.50 eCPM
   assumption; 16 SV credited to the user. Net ₦1.19 per ad, because the
   payout is service (costing ~₦0.81) not cash.
5. **SV allowance and top-up discount shipped** — 2,500 SV/month and 30%
   off top-ups, both credited as service credit so the liability stays
   service rather than cash.

**Still open:**

6. **Routing eval set** — what is the minimum quality bar Granite must
   clear on student questions before it answers anything? Needs a labelled
   set of real student questions per subject. *This is the open risk in the
   3.6× cost cut: a router that sends hard maths to the light tier saves
   money while students quietly get wrong answers.*
7. **Upload and exam quotas** — §7 item 5 is only half done. Uploads cost
   ₦2.60–₦3.58 and exams ₦1.35 each, and neither is bounded today.
8. **Narration pricing** — 76 SV/episode is our healthiest margin. Should
   PagePay+ include a small narration allowance instead of requiring SV?
9. **The AdMob client pipeline** — §7 item 6, the critical path.

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
