# Premium Content & Author System — Feature Spec

**Status:** Feature design complete. **Not part of migration 038.**
**Target migration:** 040 (post-launch, separate PR).
**Owner:** Backend + frontend + author onboarding team.

This document captures the design for two related features:

1. **Premium books** — authors/aggregators upload paid content; users
   unlock slices via ads, earned sv, or purchased sv.
2. **Author task system** — authors post tasks (read + feedback) on
   their books; users complete them and earn real cash.

Both features build on the **two-ledger wallet** delivered by
migration 038 (`service_credit_balance` for sv, `cashable_balance` for
cashable naira).

---

## 1. The big picture

```
USER SIDE                                AUTHOR/AGGREGATOR SIDE
─────────                                ──────────────────────
Earn sv by:                              Earn naira by:
  - watching ads                           - users reading premium
  - reading free books                       slices (PagePay pays
  - daily streaks                            per-unlock, monthly)
  - completing author tasks                - users completing author
                                            tasks (PagePay passes
Spend sv on:                                through user earnings)
  - premium book slices
  - study assets                           Pay PagePay via:
  - all other sinks (see migration 039)     - per-book prepay
                                            - per-task prepay
Buy sv with cash:
  - Reader Pack (premium books only)
  - Universal Pack (anywhere)
```

PagePay's revenue:
- Per-slice margin (slice price minus author payout)
- Per-task platform fee (task budget minus user payout)
- sv package sales (cash in, sv is non-cashable so we keep 100% of cash)

---

## 2. Premium books

### 2.1 Slicing rules (locked)

**Every paid slice is exactly ~5,000 characters.** Period.

Chapter boundaries don't change slicing — they only affect how the
content is *rendered* inside the slice (visual separator).

### What gets sliced vs. what stays whole

| Content | Slice size | Free/paid |
|---------|-----------|-----------|
| Front matter (title, copyright, TOC, intro, preface, dedication, foreword, index) | All in 1 slice | Always free |
| Sample slices (author picks 2 or 3) | 5,000 chars each | Always free |
| Main body content | Exactly 5,000 chars per slice | Paid (30 sv each) |
| End matter (epilogue, afterword, appendices) | 5,000 chars per slice | Paid |
| Final slice of book | Whatever remains (may be <5,000) | Paid |

### How chapter crossings are handled

A slice that crosses a chapter boundary gets a **visual separator** at
the chapter break — the user sees the chapter end and the next chapter
begin inside the same slice. No awkward "200 chars of chapter 1 then a
new slice" problem.

```
...end of Chapter 1's last paragraph.

━━━━━━━━━━━━━━━━━━━━━━━━━━━

CHAPTER 2

Chapter 2 opens with...
```

The separator is rendering-only. The next slice starts at character
position 5,001 — wherever that lands in the source text — and contains
the next 5,000 chars.

### Concrete examples

**Example 1 — chapter ends mid-slice:**

Chapter 1 has 8,200 chars. Chapter 2 has 4,300 chars.

```
Paid slice 1: chars 1-5,000      → Chapter 1, chars 1-5,000
Paid slice 2: chars 5,001-10,000 → rest of Chapter 1 (3,200 chars)
                                   + visual separator + start of Chapter 2
                                   (1,800 chars of Chapter 2)
Paid slice 3: chars 10,001-12,500 → rest of Chapter 2 (2,500 chars)
                                   [this is the LAST slice of the book,
                                    may be <5,000 chars — allowed]
```

Total: 3 paid slices for 12,500 chars across two chapters.

**Example 2 — long chapter:**

Chapter 1 has 50,000 chars.

```
Paid slice 1:  chars 1-5,000      → Chapter 1, part 1
Paid slice 2:  chars 5,001-10,000 → Chapter 1, part 2
Paid slice 3:  chars 10,001-15,000
...
Paid slice 10: chars 45,001-50,000 → Chapter 1, part 10
```

Total: 10 paid slices for one chapter.

### Slicing pipeline

```
1. Author uploads PDF/DOCX/EPUB
   ↓
2. Server extracts text (preserves structure for DOCX/EPUB)
   ↓
3. AI/parser identifies front matter vs. main body vs. end matter
   (rules: first X% of book OR explicit markers like "Chapter 1")
   ↓
4. Server chunks main body into 5,000-char slices
   ↓
5. Server detects chapter headings within each slice (for separators)
   ↓
6. Author reviews proposed slicing in dashboard:
   - Sees slice list with character counts
   - Sees where chapter boundaries fall within slices
   - Can adjust: mark additional free slices, change chapter headings
   ↓
7. Author approves → book goes live
```

### Why this rule

- **User always gets full value.** A 30 sv purchase = 5,000 chars of content.
- **Pricing is uniform.** No "this slice is 200 chars, that one is 6,000."
- **Chapter detection is just for rendering** — the underlying slice
  size is mechanical.
- **The author's review step** lets them catch edge cases (a chapter
  that starts with a prologue, a chapter that has no heading, etc.)
  before the book goes live.

### What we DON'T slice

- **Front matter** (intro, indexing, TOC, foreword, etc.) is **always
  one slice, always free**. Authors cannot mark these as paid.
- **Sample slices** (2 or 3) are always free.
- **The very last slice** of the book may be <5,000 chars if the book
  doesn't end on a clean boundary.

---

### 2.2 Unlock ladder

For every premium book:

```
[Front matter slice]   → FREE (always)
[Sample slice 1]       → FREE (author picks 2 or 3 sample slices)
[Sample slice 2]       → FREE
[Sample slice 3?]      → FREE
[Paid slice 1]         → 30 sv OR 1 ad
[Paid slice 2]         → 30 sv OR 1 ad
[Paid slice 3]         → 30 sv OR 1 ad
...
```

Each paid slice is 30 sv OR 1 ad watched. NO sv credited for watching
the ad in this flow (spending-only — same as ad-to-unlock regular
premium content, different from the regular ad-to-earn-sv flow).

**Why 30 sv per slice:**
- Lower than the 50 sv text-study unlock (premium books are longer-form)
- Achievable: 2 ads watched = 32 sv → one full unlock + buffer
- Round number, easy to communicate in UI

**Author/aggregators do NOT set per-slice price.** PagePay sets the
rate. Authors/aggregators can be "wicked" — PagePay decides pricing.

### 2.3 What happens when user watches an ad for a premium slice

**Important: watching an ad does NOT credit sv in this flow.** It
unlocks the slice directly. The ad-revenue sv-credit pathway (§3.1
of the wallet migration) and the premium-slice-unlock pathway are
separate.

```python
# /app/routers/premium_books.py — unlock_slice
@router.post("/premium-books/{book_id}/unlock-slice")
async def unlock_premium_slice(
    book_id: int,
    slice_number: int,
    method: Literal["ad", "sv"],
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    book = await get_premium_book(db, book_id)
    if slice_number < book.free_slice_count:
        raise HTTPException(400, "This slice is free; no unlock needed.")

    if method == "ad":
        # Token-issuance pattern, same as regular ads (§3.1 of migration).
        # The client first calls /ads/request-token with use_case=
        # 'premium_book_unlock' and the target slice in metadata.
        # The SSV callback marks the slice as unlocked via use_case=
        # 'premium_book_unlock' and credits the PremiumSliceUnlock audit
        # row. NO sv is credited or debited.
        ...

    elif method == "sv":
        spend_sv_for_premium_slice(
            db, current_user, book, slice_number,
            cost_sv=settings.premium_slice_cost_sv,  # 30
        )
        ...
```

### 2.4 What happens when user spends sv for a premium slice

Server checks **per-credit ledger** to ensure the user has Reader
Pack sv available (or sufficient Universal Pack sv, with priority on
Reader Pack FIFO):

```python
# /app/services/premium_books.py
def spend_sv_for_premium_slice(
    db, user, book, slice_number, cost_sv,
):
    """Debits sv from the user's service_credit_balance, preferring
    Reader Pack credits (more restricted) over Universal (less restricted).
    Reader Pack credits can ONLY be used on premium book slices.
    Universal Pack credits can be used anywhere — they're the fallback."""

    # Walk the ledger, FIFO by created_at. Debit Reader Pack first.
    # For each Reader Pack credit with remaining_sv > 0, debit up to
    # remaining_sv (or until cost_sv is fully paid).
    # If still short after Reader Pack credits exhausted, fall back
    # to Universal Pack credits.

    remaining_to_pay = cost_sv

    # Pass 1: Reader Pack credits
    reader_credits = await db.execute(
        select(PurchasedSvLedger)
        .where(PurchasedSvLedger.user_id == user.id)
        .where(PurchasedSvLedger.allowed_use == "premium_books")
        .where(PurchasedSvLedger.remaining_sv > 0)
        .order_by(PurchasedSvLedger.created_at.asc())  # FIFO
        .with_for_update()
    )
    for credit in reader_credits.scalars():
        if remaining_to_pay <= 0:
            break
        debit = min(credit.remaining_sv, remaining_to_pay)
        credit.remaining_sv -= debit
        remaining_to_pay -= debit

    # Pass 2: Universal Pack credits
    if remaining_to_pay > 0:
        universal_credits = await db.execute(
            select(PurchasedSvLedger)
            .where(PurchasedSvLedger.user_id == user.id)
            .where(PurchasedSvLedger.allowed_use == "anywhere")
            .where(PurchasedSvLedger.remaining_sv > 0)
            .order_by(PurchasedSvLedger.created_at.asc())
            .with_for_update()
        )
        for credit in universal_credits.scalars():
            if remaining_to_pay <= 0:
                break
            debit = min(credit.remaining_sv, remaining_to_pay)
            credit.remaining_sv -= debit
            remaining_to_pay -= debit

    # Pass 3: Earned sv (from ads/reading/streaks) — only if Reader+
    # Universal exhausted AND user has earned sv to spend.
    if remaining_to_pay > 0:
        earned_available = user.service_credit_balance - sum(
            c.remaining_sv for c in all_active_credits
        )
        if earned_available >= remaining_to_pay:
            # Just decrement user.service_credit_balance directly;
            # earned sv has no per-credit tracking.
            user.service_credit_balance -= remaining_to_pay
            remaining_to_pay = 0

    if remaining_to_pay > 0:
        raise InsufficientSvError(...)  # routes to ads via §12.4 pattern

    # Audit row
    db.add(PremiumSliceUnlock(
        user_id=user.id, book_id=book.id, slice_number=slice_number,
        cost_sv=cost_sv,
        spent_via={
            "reader_pack_sv": cost_sv - remaining_after_reader,
            "universal_pack_sv": ...,
            "earned_sv": ...,
        },
    ))
```

### 2.5 Schema

```python
# Migration 040

op.create_table(
    "premium_books",
    sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
    sa.Column("author_id", sa.BigInteger(), sa.ForeignKey("users.id"),
              nullable=False, index=True),
    sa.Column("title", sa.String(500), nullable=False),
    sa.Column("description", sa.Text(), nullable=True),
    sa.Column("cover_url", sa.String(1000), nullable=True),
    sa.Column("total_slices", sa.Integer(), nullable=False),
    sa.Column("free_slice_count", sa.Integer(), nullable=False,
              server_default="3"),  # author picks 2 or 3
    sa.Column("per_unlock_author_payout_kobo", sa.BigInteger(),
              nullable=False),  # author-set; PagePay pays this per unlock
    sa.Column("status", sa.String(20), nullable=False,
              server_default="active"),  # active | completed | paused | removed
    sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()"),
              nullable=False),
    sa.Column("updated_at", sa.DateTime(), server_default=sa.text("NOW()"),
              nullable=False),
)

op.create_table(
    "premium_slice_unlocks",
    sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
    sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id"),
              nullable=False, index=True),
    sa.Column("book_id", sa.BigInteger(), sa.ForeignKey("premium_books.id"),
              nullable=False, index=True),
    sa.Column("slice_number", sa.Integer(), nullable=False),
    sa.Column("unlock_method", sa.String(20), nullable=False),
    # Values: 'free', 'ad', 'sv_reader_pack', 'sv_universal_pack', 'sv_earned'
    sa.Column("cost_sv", sa.Integer(), nullable=False, server_default="0"),
    sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()"),
              nullable=False),
    sa.UniqueConstraint("user_id", "book_id", "slice_number",
                         name="uq_premium_unlock_per_user_slice"),
)

# Extend content_catalog
op.add_column("content_catalog",
    sa.Column("is_premium", sa.Boolean(), nullable=False, server_default="false"))
op.add_column("content_catalog",
    sa.Column("premium_book_id", sa.BigInteger(),
              sa.ForeignKey("premium_books.id"), nullable=True))
```

### 2.6 Author payment flow

- Each unlock increments an internal counter (`premium_books` doesn't
  need a counter column — query `premium_slice_unlocks` count).
- Monthly batch job calculates unlocks × `per_unlock_author_payout_kobo`
  per author.
- PagePay initiates a Paystack Transfer to the author's registered
  bank account.
- Author sees earnings in their dashboard (`GET /author/dashboard`).

---

## 3. sv packages

### 3.1 Package catalog

Two families, three sizes each:

| Package | Price | sv granted | Where it can be spent | Effective rate |
|---------|-------|-----------|----------------------|----------------|
| Reader Pack S | ₦100 | 1,000 sv | Premium book slices ONLY | 10 sv/₦ |
| Reader Pack M | ₦500 | 5,500 sv | Premium book slices ONLY | 11 sv/₦ |
| Reader Pack L | ₦1,000 | 12,000 sv | Premium book slices ONLY | 12 sv/₦ |
| Universal Pack S | ₦100 | 800 sv | Anywhere (premium books, study unlocks, streaks, bill discounts) | 8 sv/₦ |
| Universal Pack M | ₦500 | 4,500 sv | Anywhere | 9 sv/₦ |
| Universal Pack L | ₦1,000 | 10,000 sv | Anywhere | 10 sv/₦ |

**Why Reader Packs give more sv:** they have restricted usage. User
commits to spending on premium books. We reward that commitment.

**Why Universal Packs exist:** some users want flexibility. They pay
a premium (lower effective rate) for that flexibility.

### 3.2 Cash → sv conversion

When user buys any package, the **conversion rate is package-defined**
(above). No global "kobo_to_points" multiplier. Each package has its
own effective rate as a bulk-discount incentive.

### 3.3 Per-credit ledger (Option α)

Every package purchase creates a `PurchasedSvLedger` row:

```python
op.create_table(
    "purchased_sv_ledger",
    sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
    sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id"),
              nullable=False, index=True),
    sa.Column("package_id", sa.BigInteger(), sa.ForeignKey("sv_packages.id"),
              nullable=False, index=True),
    sa.Column("sv_amount", sa.Integer(), nullable=False),    # original
    sa.Column("remaining_sv", sa.Integer(), nullable=False), # current
    sa.Column("allowed_use", sa.String(20), nullable=False),
    # Values: 'premium_books' (Reader Pack) or 'anywhere' (Universal Pack)
    sa.Column("payment_id", sa.BigInteger(), sa.ForeignKey("payments.id"),
              nullable=False, index=True),
    sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()"),
              nullable=False),
    sa.Column("expires_at", sa.DateTime(), nullable=True),  # ALWAYS NULL (no expiration)
)
```

**No expiration.** Purchased sv never expires. Users own what they buy.

### 3.4 Spending priority at premium slice unlock

When user spends sv on a premium slice, server walks the ledger:

1. **Reader Pack credits** (FIFO) — most restricted, use first
2. **Universal Pack credits** (FIFO) — fallback
3. **Earned sv** (no per-credit tracking) — last resort

This ensures Reader Pack sv always gets used for premium books (the
intended purpose), and Universal Pack sv is reserved for flexibility.

### 3.5 Spending on non-premium sinks

When user spends sv on study unlocks, streaks, or bill discounts,
only Universal Pack and earned sv can be used. Reader Pack sv is
**blocked** from these sinks at the API layer:

```python
# /app/services/spending.py
def spend_sv_for_general_sink(db, user, amount_sv, purpose):
    """Spend sv on non-premium sinks (study, streak, discount).
    Reader Pack sv is BLOCKED — only Universal + earned sv qualify."""
    available = user_universal_and_earned_sv(db, user)
    if available < amount_sv:
        raise InsufficientSvError(...)  # routes to ads
    ...
```

### 3.6 Schema

```python
op.create_table(
    "sv_packages",
    sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
    sa.Column("name", sa.String(100), nullable=False),
    # 'reader_pack_s', 'reader_pack_m', 'reader_pack_l',
    # 'universal_pack_s', 'universal_pack_m', 'universal_pack_l'
    sa.Column("display_name", sa.String(200), nullable=False),
    sa.Column("description", sa.Text(), nullable=True),
    sa.Column("price_kobo", sa.BigInteger(), nullable=False),
    sa.Column("sv_granted", sa.Integer(), nullable=False),
    sa.Column("allowed_use", sa.String(20), nullable=False),
    # Values: 'premium_books' | 'anywhere'
    sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    sa.Column("status", sa.String(20), nullable=False, server_default="active"),
    sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()"),
              nullable=False),
)

op.create_table(
    "purchased_sv_ledger",
    sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
    sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id"),
              nullable=False, index=True),
    sa.Column("package_id", sa.BigInteger(), sa.ForeignKey("sv_packages.id"),
              nullable=False, index=True),
    sa.Column("sv_amount", sa.Integer(), nullable=False),
    sa.Column("remaining_sv", sa.Integer(), nullable=False),
    sa.Column("allowed_use", sa.String(20), nullable=False),
    sa.Column("payment_id", sa.BigInteger(), sa.ForeignKey("payments.id"),
              nullable=False, index=True),
    sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()"),
              nullable=False),
    sa.Column("expires_at", sa.DateTime(), nullable=True),
)
```

### 3.7 Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /sv/packages` | List active packages (anonymous-friendly) |
| `POST /sv/purchase` | Initiate Paystack checkout, returns `authorization_url` |
| `POST /sv/purchase/webhook` | Paystack `charge.success` → credit `purchased_sv_ledger` |
| `GET /sv/balance` | User's purchased sv breakdown: `{reader_pack_sv, universal_pack_sv, earned_sv, total}` |

### 3.8 User-me schema extension

```python
class UserMe(BaseModel):
    # ... existing fields from migration 038 ...
    service_credit_balance: int
    cashable_balance: int
    purchased_sv_breakdown: PurchasedSvBreakdown | None = None
    # Returned only if user has any purchased sv; null otherwise.


class PurchasedSvBreakdown(BaseModel):
    reader_pack_sv: int       # sum of remaining_sv from 'premium_books' credits
    universal_pack_sv: int    # sum of remaining_sv from 'anywhere' credits
    earned_sv: int            # service_credit_balance minus the above two
    total: int                # matches service_credit_balance
```

---

## 4. Author task system

### 4.1 Reuses the existing sponsor task infra

Authors register as sponsors, post book-feedback tasks, fund the
budget, review submissions. **No new task infrastructure needed** —
the existing `routers/tasks.py` + `sponsor.py` covers it.

### 4.2 User earns CASH (real money) for completing

**Author task user reward:** credited to `cashable_balance` (withdrawable).

This is identical to existing social-boost tasks:
- Author prepays via Paystack into a task budget
- User completes task
- PagePay passes cash to user (`cashable_balance += kobo_to_points(reward)`)
- PagePay takes platform fee

### 4.3 Author task lifecycle

1. Author uploads draft book (or references existing book)
2. Author creates task: "Read chapter 5, write 200-word feedback, reward ₦50"
3. Author prepays via Paystack: ₦500 = 10 completions
4. Users see task in `GET /tasks/available`
5. User accepts task → reads book → writes feedback → submits
6. Author reviews submissions, approves/rejects
7. On approval, user's `cashable_balance += 500 sv` (₦50)
8. PagePay takes 20% platform fee: ₦10 of the ₦50 stays with PagePay

### 4.4 Schema additions (none new — reuse)

The existing `tasks` + `task_submissions` + `task_payments` tables
are sufficient. The author-role distinction is in `users.role` (new
enum) and `sponsor` linking (existing).

### 4.5 New role on users

```python
# Migration 040 — add role column
op.add_column("users", sa.Column("role",
    sa.String(20), nullable=False, server_default="user"))
# Values: 'user' | 'author' | 'sponsor' | 'admin'
```

Or use a separate `user_roles` table for many-to-many flexibility.
**My recommendation:** simple `role` column for v1. Add `user_roles`
later if we need multi-role users (e.g., author + sponsor).

---

## 5. Migration 040 plan (post-launch)

### 5.1 Migrations to add

| Migration | Purpose |
|-----------|---------|
| `040_premium_books.py` | `premium_books`, `premium_slice_unlocks`, extend `content_catalog` |
| `041_sv_packages.py` | `sv_packages`, `purchased_sv_ledger` |
| `042_author_role.py` | `users.role` column + index |

### 5.2 Endpoints to add (high-level)

| Router | Endpoints |
|--------|-----------|
| `routers/premium_books.py` (NEW) | `GET /premium-books`, `GET /premium-books/{id}`, `POST /premium-books/{id}/unlock-slice` |
| `routers/sv_packages.py` (NEW) | `GET /sv/packages`, `POST /sv/purchase`, `POST /sv/purchase/webhook`, `GET /sv/balance` |
| `routers/author.py` (NEW) | `POST /author/books`, `GET /author/dashboard`, `POST /author/payout-account` |
| `routers/payments.py` (EXTEND) | Add `tier='sv_package_purchase'` for webhook tagging |
| `routers/auth.py` (EXTEND) | `UserMe` includes `purchased_sv_breakdown` |
| `routers/tasks.py` (NO CHANGE) | Existing — author uses as-is |

### 5.3 Frontend (mobile) requirements

- Premium books section in catalog
- Slice unlock modal (3 paths: ad / spend sv / buy sv)
- Wallet screen upgrade: show purchased sv breakdown + earned sv separately
- sv package storefront (₦100/500/1000 packages)
- Author onboarding flow (KYC + bank account)
- Author dashboard (earnings, book analytics, task management)

### 5.4 Compliance posture

- **Premium content uses the 25% cap exemption** by being sv-priced,
  not cash-discounted. No cash price exists for premium slices — sv is
  the only native price.
- **sv purchased with cash is non-cashable.** Goes into
  `service_credit_balance` mixed with earned sv. The whole balance is
  non-cashable per migration 038.
- **Author task payouts are cash-funded by authors.** No ad-derived
  cash flow. This is the "social boost" use case Google explicitly
  allows (brand sponsors paying for engagement).
- **No P2P transfer of purchased sv.** Migration 038 §12.7 enforces
  non-transferability across all `service_credit_balance` flows.

---

## 6. Decisions log

| # | Decision | Value |
|---|----------|-------|
| 1 | Premium slice price | PagePay sets, ~30 sv/slice (locked) |
| 2 | Author payment | Per slice-unlock, monthly payout via Paystack Transfer |
| 3 | Cash → sv rate | Package-defined (10/11/12 sv per ₦1 for Reader, 8/9/10 for Universal) |
| 4 | Author task user reward | Cash to `cashable_balance` |
| 5 | Premium reading = spending only | No sv earned from premium reads |
| 6 | Free slices per premium book | Author picks 2 or 3 |
| 7 | sv packages structure | Tiered with restrictions (Y) |
| 8 | Purchased sv + earned sv | Same `service_credit_balance` pool |
| 9 | Per-credit ledger | Option α: `purchased_sv_ledger` tracks each credit with `remaining_sv` and `allowed_use` |
| 10 | Spending priority at premium slice | Reader Pack FIFO → Universal Pack FIFO → earned sv |
| 11 | Reader Pack restriction | Premium book slices ONLY (blocked from study/streak/discount) |
| 12 | Universal Pack | Anywhere |
| 13 | Purchased sv expiration | None |
| 14 | Author role | New `users.role` column, simple enum for v1 |
| 15 | Premium content = migration target | 040 (post-launch), NOT 038 |

---

## 7. Out of scope (deferred)

- **Author royalty reports** (PDFs for tax purposes)
- **Author analytics deep-dive** (heatmap of which slices get read most)
- **Royalty tier system** (gold/silver/bronze authors with different rates)
- **Multi-author collaboration** on one book
- **Book pre-orders** (user pays sv upfront for unreleased book)
- **Author-to-author payments** (one author paying another)
- **Subscription model** (user pays monthly for unlimited premium book access)
- **Premium book DRM** (offline reading, copy protection)
- **Author disputes** (when author disagrees with reader feedback)

Each is a future feature. None blocks 040.
