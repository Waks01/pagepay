# Premium vs Free User Benefits - Implementation Roadmap

**Project:** PagePay Premium Feature Implementation  
**Created:** 2026-08-23  
**Status:** Planning Phase  
**Config Source:** `backend/app/tier_benefits.json`

---

## 🎯 Implementation Goals

1. **Apply premium multipliers** to all point-earning activities
2. **Distinguish content types** (novels vs study materials) for ad logic
3. **Implement ad gating** based on content type and user tier
4. **Premium user flexibility** on novels (skip ads or watch for bonus)
5. **Frontend UI updates** to show premium benefits clearly
6. **Zero hardcoded values** - all config via .env or tier_benefits.json

---

## 📋 Environment Variables Needed

### Backend `.env` Additions

```bash
# ── Premium multipliers ──────────────────────────────────────────────
# Reading slice bonus multiplier for premium users
PREMIUM_READING_MULTIPLIER=2.0

# Ad reward multiplier for premium users (1.5x not 2x)
PREMIUM_AD_MULTIPLIER=1.5

# Task reward multiplier for premium users
PREMIUM_TASK_MULTIPLIER=2.0

# Daily reward multiplier for premium users
PREMIUM_DAILY_MULTIPLIER=2.0

# Bills cashback multiplier for premium users
PREMIUM_BILLS_MULTIPLIER=2.0

# ── Content type detection ──────────────────────────────────────────
# Content sources that are always ad-free (comma-separated)
AD_FREE_CONTENT_SOURCES=openstax,openstax_textbook

# Content sources that are ad-supported (comma-separated)
AD_SUPPORTED_CONTENT_SOURCES=gutenberg,gnews,user_upload

# Default behavior for unknown sources (ad_supported or ad_free)
DEFAULT_CONTENT_AD_BEHAVIOR=ad_supported

# ── Premium ad gating ───────────────────────────────────────────────
# Whether premium users can skip pre-read ads on novels
PREMIUM_CAN_SKIP_PRE_READ_ADS=true

# Whether premium users can skip post-read ads on novels
PREMIUM_CAN_SKIP_POST_READ_ADS=true

# Whether premium users can skip feed ads
PREMIUM_CAN_SKIP_FEED_ADS=true

# ── Tier benefits JSON path ─────────────────────────────────────────
# Path to tier benefits configuration file
TIER_BENEFITS_JSON_PATH=app/tier_benefits.json
```

### Frontend `.env` Additions (page app)

```bash
# Premium feature flags
EXPO_PUBLIC_PREMIUM_FEATURES_ENABLED=true
EXPO_PUBLIC_SHOW_PREMIUM_BADGE=true
EXPO_PUBLIC_PREMIUM_AD_SKIP_ENABLED=true
```

---

## 🗂️ Phase 1: Backend - Core Infrastructure & Config Loader

**Status:** ⏳ Not Started  
**Estimated Time:** 2-3 hours  
**Dependencies:** None

### Tasks

#### 1.1 Create Tier Benefits Loader Service
**File:** `backend/app/services/tier_benefits.py` (NEW)

**Purpose:** Load and cache tier_benefits.json, provide helper functions

**Functions:**
- `load_tier_benefits()` - Load JSON file
- `get_tier_config(tier: UserTier)` - Get config for specific tier
- `get_multiplier(tier: UserTier, multiplier_type: str)` - Get specific multiplier
- `get_feature_config(tier: UserTier, feature: str)` - Get feature settings
- `is_content_ad_free(content_source: str)` - Check if content type is ad-free

**Environment Variables Used:**
- `TIER_BENEFITS_JSON_PATH`
- `AD_FREE_CONTENT_SOURCES`
- `AD_SUPPORTED_CONTENT_SOURCES`
- `DEFAULT_CONTENT_AD_BEHAVIOR`

**Testing:**
- Unit tests for JSON loading
- Test multiplier retrieval
- Test content type detection

---

#### 1.2 Update Config to Load New Environment Variables
**File:** `backend/app/config.py`

**Changes:**
```python
# Add new fields to Settings class
premium_reading_multiplier: float = 2.0
premium_ad_multiplier: float = 1.5
premium_task_multiplier: float = 2.0
premium_daily_multiplier: float = 2.0
premium_bills_multiplier: float = 2.0

ad_free_content_sources: str = "openstax,openstax_textbook"
ad_supported_content_sources: str = "gutenberg,gnews,user_upload"
default_content_ad_behavior: str = "ad_supported"

premium_can_skip_pre_read_ads: bool = True
premium_can_skip_post_read_ads: bool = True
premium_can_skip_feed_ads: bool = True

tier_benefits_json_path: str = "app/tier_benefits.json"

@property
def ad_free_sources_list(self) -> list[str]:
    return [s.strip() for s in self.ad_free_content_sources.split(",") if s.strip()]

@property
def ad_supported_sources_list(self) -> list[str]:
    return [s.strip() for s in self.ad_supported_content_sources.split(",") if s.strip()]
```

**Testing:**
- Verify all env vars load correctly
- Test default values
- Test list parsing

---

#### 1.3 Add Content Source Field to ContentCatalog Model
**File:** `backend/app/models.py`

**Changes:**
```python
class ContentCatalog(Base):
    # ... existing fields ...
    
    # New field to track content source for ad logic
    content_source: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
        index=True,
        comment="Source of content: gutenberg, openstax, gnews, etc. Used for ad gating logic"
    )
```

**Database Migration:**
```bash
# Generate migration
alembic revision --autogenerate -m "add_content_source_to_catalog"

# Migration will add nullable column
# Backfill existing data based on import source
```

**Backfill Script:** `backend/scripts/backfill_content_sources.py` (NEW)
- Detect source from existing data (Gutenberg ID, OpenStax URL, etc.)
- Update all existing ContentCatalog rows

**Testing:**
- Test migration up/down
- Verify backfill script
- Test new imports set content_source correctly

---

#### 1.4 Update Subscription Service with Dynamic Multipliers
**File:** `backend/app/services/subscription.py`

**Changes:**
```python
from app.services.tier_benefits import get_multiplier

def get_points_multiplier(user: User, activity_type: str = "reading") -> float:
    """Get the points earning multiplier for a user based on activity.
    
    Args:
        user: User model instance
        activity_type: Type of activity (reading, ad, task, daily, bills)
        
    Returns:
        Multiplier to apply to base points
    """
    if not is_premium(user):
        return 1.0
    
    # Load multiplier from tier_benefits.json or fall back to config
    return get_multiplier(user.tier, activity_type)
```

**Testing:**
- Test free user returns 1.0 for all activities
- Test premium user returns correct multipliers
- Test fallback to config if JSON fails

---

## 🗂️ Phase 2: Backend - Apply Multipliers to Point Rewards

**Status:** ⏳ Not Started  
**Estimated Time:** 4-5 hours  
**Dependencies:** Phase 1 complete

### Tasks

#### 2.1 Apply Reading Multiplier to Session End
**File:** `backend/app/routers/sessions.py`

**Current Code:**
```python
bonus_credited = settings.reading_slice_bonus_points
current_user.points_balance += bonus_credited
```

**Updated Code:**
```python
from app.services.subscription import get_points_multiplier

base_bonus = settings.reading_slice_bonus_points
multiplier = get_points_multiplier(current_user, "reading")
bonus_credited = int(base_bonus * multiplier)
current_user.points_balance += bonus_credited
session.points_earned = bonus_credited

logger.info(
    "session %d settled: user=%d tier=%s multiplier=%.1fx base=%d bonus=%d new_balance=%d",
    session.id, current_user.id, current_user.tier.value, 
    multiplier, base_bonus, bonus_credited, current_user.points_balance,
)
```

**Testing:**
- Free user: 2 points per slice
- Premium user: 4 points per slice (2 × 2.0)
- Verify database updates
- Verify notification shows correct amount

---

#### 2.2 Apply Ad Multiplier to SSV Callback
**File:** `backend/app/routers/ads.py`

**Current Code (line ~700+):**
```python
# Calculate user's share of the reward
user_share = int(reward_amount * USER_SHARE)
current_user.points_balance += user_share
req.points_credited = user_share
```

**Updated Code:**
```python
from app.services.subscription import get_points_multiplier

# Calculate base user share
base_share = int(reward_amount * USER_SHARE)

# Apply premium multiplier
multiplier = get_points_multiplier(current_user, "ad")
final_share = int(base_share * multiplier)

current_user.points_balance += final_share
req.points_credited = final_share
req.premium_multiplier_applied = multiplier  # Track for audit

logger.info(
    "AdMob SSV: credited user=%s tier=%s base=%d multiplier=%.1fx final=%d balance=%d",
    user_id, current_user.tier.value, base_share, multiplier, 
    final_share, current_user.points_balance
)
```

**Schema Update:** Add `premium_multiplier_applied` field to `AdRequest` model

**Testing:**
- Free user: 20 points (base × 1.0)
- Premium user: 30 points (20 × 1.5)
- Verify SSV logs show multiplier
- Test idempotency (duplicate callbacks)

---

#### 2.3 Apply Task Multiplier to Task Completion
**File:** `backend/app/services/tasks/task_processor.py`

**Location:** `TaskProcessor.process_submission()` method

**Current Code:**
```python
points_earned = submission.task.points_reward
user.points_balance += points_earned
```

**Updated Code:**
```python
from app.services.subscription import get_points_multiplier

base_points = submission.task.points_reward
multiplier = get_points_multiplier(user, "task")
points_earned = int(base_points * multiplier)
user.points_balance += points_earned

submission.points_earned = points_earned
submission.premium_multiplier = multiplier  # Track for audit
```

**Testing:**
- Free user: Base task points
- Premium user: 2x task points
- Verify high-quality bonus also gets multiplied
- Test XP calculation (separate from points)

---

#### 2.4 Apply Daily Reward Multiplier
**File:** `backend/app/routers/rewards.py`

**Location:** `POST /daily/claim` endpoint

**Current Code:**
```python
base_reward = settings.daily_base_reward
final_reward = int(base_reward * streak_multiplier)
user.points_balance += final_reward
```

**Updated Code:**
```python
from app.services.subscription import get_points_multiplier

base_reward = settings.daily_base_reward
streak_multiplier = calculate_streak_multiplier(user.streak_days)
premium_multiplier = get_points_multiplier(user, "daily")

# Apply both streak AND premium multipliers
final_reward = int(base_reward * streak_multiplier * premium_multiplier)
user.points_balance += final_reward

logger.info(
    "Daily reward claimed: user=%d tier=%s base=%d streak_mult=%.2fx premium_mult=%.1fx final=%d",
    user.id, user.tier.value, base_reward, streak_multiplier, 
    premium_multiplier, final_reward
)
```

**Testing:**
- Free user: Base × streak multiplier
- Premium user: Base × streak × 2.0
- Test 30-day streak premium user (base × 1.5 × 2.0)

---

#### 2.5 Apply Bills Cashback Multiplier
**File:** `backend/app/routers/bills.py`

**Location:** Bill purchase completion callback

**Current Code:**
```python
cashback_points = int(commission_naira * settings.points_per_naira * settings.bills_user_share)
user.points_balance += cashback_points
```

**Updated Code:**
```python
from app.services.subscription import get_points_multiplier

base_cashback = int(commission_naira * settings.points_per_naira * settings.bills_user_share)
multiplier = get_points_multiplier(user, "bills")
final_cashback = int(base_cashback * multiplier)

user.points_balance += final_cashback

logger.info(
    "Bills cashback: user=%d tier=%s base=%d multiplier=%.1fx final=%d",
    user.id, user.tier.value, base_cashback, multiplier, final_cashback
)
```

**Testing:**
- Free user: Standard cashback rate
- Premium user: 2x cashback rate
- Verify transaction history shows correct amounts

---

## 🗂️ Phase 3: Backend - Content Type Detection & Ad Gating

**Status:** ⏳ Not Started  
**Estimated Time:** 3-4 hours  
**Dependencies:** Phase 1 complete

### Tasks

#### 3.1 Add Content Type Helper Functions
**File:** `backend/app/services/content_type.py` (NEW)

**Purpose:** Determine if content should show ads

**Functions:**
```python
def is_ad_free_content(content: ContentCatalog) -> bool:
    """Check if content is ad-free (study materials)."""
    
def requires_ads_for_points(content: ContentCatalog, user: User) -> bool:
    """Check if user must watch ads to earn points on this content."""
    
def can_skip_ads(content: ContentCatalog, user: User) -> bool:
    """Check if user can skip ads on this content."""
```

**Logic:**
- Study materials (OpenStax): Always ad-free for everyone
- Novels (Gutenberg): Ads required for free, optional for premium
- Uses `content_source` field and env config

**Testing:**
- Test OpenStax content returns ad_free=True
- Test Gutenberg content for free user returns ads_required=True
- Test Gutenberg content for premium returns ads_optional=True

---

#### 3.2 Create Ad Gating API Endpoint
**File:** `backend/app/routers/content.py`

**New Endpoint:** `GET /api/v1/content/{content_id}/ad-policy`

**Response:**
```json
{
  "content_id": 123,
  "content_source": "gutenberg",
  "is_ad_free": false,
  "user_tier": "premium_monthly",
  "ad_policy": {
    "pre_read_required": false,
    "post_read_required": false,
    "can_skip_pre_read": true,
    "can_skip_post_read": true,
    "feed_ads_shown": false,
    "points_if_skip": 4,
    "points_if_watch": 34
  }
}
```

**Purpose:** Frontend calls this to determine ad behavior

**Testing:**
- Test all combinations (free/premium × novel/study)
- Verify points calculations match tier_benefits.json

---

#### 3.3 Update Content Import Scripts
**Files:**
- `backend/app/services/content/gutenberg_importer.py`
- `backend/app/services/content/openstax_importer.py`
- `backend/app/services/content/gnews_importer.py`

**Changes:**
- Set `content_source` field during import
- Gutenberg → "gutenberg"
- OpenStax → "openstax"
- GNews → "gnews"

**Testing:**
- Import new Gutenberg book, verify source="gutenberg"
- Import new OpenStax chapter, verify source="openstax"
- Run backfill script on old data

---

## 🗂️ Phase 4: Frontend - Ad Skip Logic

**Status:** ⏳ Not Started  
**Estimated Time:** 5-6 hours  
**Dependencies:** Phase 3 complete

### Tasks

#### 4.1 Create Ad Policy Hook
**File:** `page/src/hooks/useAdPolicy.ts` (NEW)

**Purpose:** Fetch and cache ad policy for content

```typescript
export function useAdPolicy(contentId: number) {
  return useQuery({
    queryKey: ['ad-policy', contentId],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/content/${contentId}/ad-policy`);
      return await res.json() as AdPolicy;
    },
  });
}
```

**Testing:**
- Test hook returns correct policy
- Test caching behavior
- Test loading/error states

---

#### 4.2 Update Reader Pre-Read Ad Logic
**File:** `page/src/app/(app)/catalog/reader/[id].tsx`

**Current Code:**
```typescript
// Always opens pre-read modal
useEffect(() => {
  setPreReadOpen(true);
}, []);
```

**Updated Code:**
```typescript
const { data: adPolicy } = useAdPolicy(Number(id));

useEffect(() => {
  if (!adPolicy) return;
  
  // Study materials: skip pre-read entirely
  if (adPolicy.is_ad_free) {
    return;
  }
  
  // Novels - Free users: required
  if (adPolicy.ad_policy.pre_read_required) {
    setPreReadOpen(true);
    return;
  }
  
  // Premium users on novels: show skip option
  if (adPolicy.ad_policy.can_skip_pre_read) {
    setShowSkipOption(true);
    setPreReadOpen(true);
  }
}, [adPolicy]);
```

**Testing:**
- Free user + study material: No pre-read ad
- Free user + novel: Pre-read ad required
- Premium user + study material: No pre-read ad
- Premium user + novel: Pre-read ad with skip button

---

#### 4.3 Add Skip Ad Button Component
**File:** `page/components/reader/SkipAdButton.tsx` (NEW)

**Purpose:** Show skip option for premium users

```typescript
interface SkipAdButtonProps {
  onSkip: () => void;
  pointsIfSkip: number;
  pointsIfWatch: number;
}

export function SkipAdButton({ onSkip, pointsIfSkip, pointsIfWatch }: SkipAdButtonProps) {
  return (
    <View style={styles.skipContainer}>
      <Text style={styles.skipHint}>
        Watch ad: {pointsIfWatch} points | Skip: {pointsIfSkip} points
      </Text>
      <Pressable onPress={onSkip} style={styles.skipButton}>
        <Text style={styles.skipText}>Skip Ad</Text>
      </Pressable>
    </View>
  );
}
```

**Testing:**
- Test button renders correctly
- Test tap behavior
- Test point display

---

#### 4.4 Update Post-Read Ad Logic
**File:** `page/src/app/(app)/catalog/reader/[id].tsx`

**Current Code:**
```typescript
// Always shows post-read ad
setPostReadAdOpen(true);
```

**Updated Code:**
```typescript
const handleFinish = async () => {
  if (!adPolicy) return;
  
  // Study materials: skip post-read ad
  if (adPolicy.is_ad_free) {
    await endSessionAndNavigate();
    return;
  }
  
  // Novels - check policy
  if (adPolicy.ad_policy.can_skip_post_read) {
    // Premium user: show skip option
    setShowPostSkipOption(true);
  }
  
  setPostReadAdOpen(true);
};
```

**Testing:**
- Study materials: Direct to next slice
- Free user novels: Post-read ad required
- Premium user novels: Post-read ad with skip

---

#### 4.5 Update Feed Ads Logic
**File:** `page/src/app/(app)/catalog/index.tsx`

**Purpose:** Hide feed ads for premium users

**Current Code:**
```typescript
// Shows native ads in feed for everyone
{index % 4 === 0 && <NativeAdCard />}
```

**Updated Code:**
```typescript
const { data: user } = useQuery({ queryKey: ['me'] });
const isPremium = user?.is_premium;

// Only show feed ads for free users
{!isPremium && index % 4 === 0 && <NativeAdCard />}
```

**Testing:**
- Free user: Ads every 4 items
- Premium user: No feed ads

---

## 🗂️ Phase 5: Frontend - Premium UI Indicators

**Status:** ⏳ Not Started  
**Estimated Time:** 4-5 hours  
**Dependencies:** Phase 4 complete

### Tasks

#### 5.1 Create Premium Badge Component
**File:** `page/components/premium/PremiumBadge.tsx` (NEW)

**Purpose:** Show gold badge for premium users

```typescript
export function PremiumBadge({ size = 'small' }: { size?: 'small' | 'medium' | 'large' }) {
  return (
    <View style={[styles.badge, styles[size]]}>
      <Text style={styles.badgeText}>👑 PREMIUM</Text>
    </View>
  );
}
```

**Testing:**
- Test different sizes
- Test color schemes
- Test accessibility

---

#### 5.2 Add Points Preview Component
**File:** `page/components/reader/PointsPreview.tsx` (NEW)

**Purpose:** Show how many points user will earn

```typescript
interface PointsPreviewProps {
  adPolicy: AdPolicy;
  showChoice?: boolean;
}

export function PointsPreview({ adPolicy, showChoice }: PointsPreviewProps) {
  if (adPolicy.is_ad_free) {
    return (
      <View style={styles.preview}>
        <Text style={styles.points}>{adPolicy.ad_policy.points_if_skip} points</Text>
        <Text style={styles.label}>For reading (ad-free)</Text>
      </View>
    );
  }
  
  if (showChoice) {
    return (
      <View style={styles.choicePreview}>
        <View style={styles.option}>
          <Text style={styles.points}>{adPolicy.ad_policy.points_if_skip}</Text>
          <Text style={styles.label}>Skip ads</Text>
        </View>
        <View style={styles.option}>
          <Text style={styles.pointsHighlight}>{adPolicy.ad_policy.points_if_watch}</Text>
          <Text style={styles.label}>Watch ads</Text>
        </View>
      </View>
    );
  }
  
  return (
    <View style={styles.preview}>
      <Text style={styles.points}>{adPolicy.ad_policy.points_if_watch} points</Text>
      <Text style={styles.label}>Reading + Ads</Text>
    </View>
  );
}
```

**Testing:**
- Test all content/tier combinations
- Test responsive layouts
- Test color contrast

---

#### 5.3 Update Profile Screen with Premium Info
**File:** `page/src/app/(app)/profile/index.tsx`

**Changes:**
- Show premium badge if active
- Show subscription expiry date
- Show multipliers (2x reading, 1.5x ads, etc.)
- Show "Upgrade to Premium" CTA for free users

**Testing:**
- Free user: Shows upgrade CTA
- Premium user: Shows badge and benefits

---

#### 5.4 Update Premium Screen with New Pricing
**File:** `page/src/app/(app)/premium/index.tsx`

**Changes:**
- Update pricing: ₦1,000/month, ₦10,000/year
- Show benefit list from tier_benefits.json
- Show points comparison (22 vs 34 on novels)
- Add "Try Premium" flow

**Testing:**
- Verify pricing displays correctly
- Test benefit list rendering
- Test payment flow

---

#### 5.5 Add Premium Feature Tooltips
**File:** `page/components/premium/FeatureTooltip.tsx` (NEW)

**Purpose:** Explain premium benefits in-app

**Locations:**
- Reader screen (ad skip explanation)
- Catalog screen (points preview)
- Tasks screen (2x rewards)
- Bills screen (2x cashback)

**Testing:**
- Test tooltip positioning
- Test tap/dismiss behavior
- Test multiple tooltips

---

## 🗂️ Phase 6: Testing & Verification

**Status:** ⏳ Not Started  
**Estimated Time:** 6-8 hours  
**Dependencies:** All previous phases

### Tasks

#### 6.1 Backend Unit Tests
**Files:** Create test files for each modified service

**Coverage:**
- Multiplier application (reading, ads, tasks, daily, bills)
- Content type detection
- Ad policy generation
- Tier benefits loader

**Command:**
```bash
cd backend
pytest tests/test_premium_multipliers.py -v
pytest tests/test_content_types.py -v
pytest tests/test_ad_policies.py -v
```

---

#### 6.2 Backend Integration Tests
**File:** `backend/tests/integration/test_premium_flow.py` (NEW)

**Scenarios:**
1. Free user reads novel → earns 22 points
2. Premium user reads novel with ads → earns 34 points
3. Premium user reads novel skip ads → earns 4 points
4. Free user reads study material → earns 2 points
5. Premium user reads study material → earns 4 points
6. Premium user completes task → earns 2x points
7. Premium user claims daily reward → earns 2x points
8. Premium user pays bill → earns 2x cashback

---

#### 6.3 Frontend Component Tests
**Files:** Create test files for new components

**Coverage:**
- PremiumBadge renders correctly
- PointsPreview shows correct amounts
- SkipAdButton behavior
- useAdPolicy hook

**Command:**
```bash
cd page
npm test -- --coverage
```

---

#### 6.4 End-to-End Testing
**Manual Test Plan:** `docs/PREMIUM_E2E_TESTS.md` (NEW)

**Test Cases:**
1. **Free User Journey**
   - Sign up as free user
   - Read novel with pre-read and post-read ads
   - Verify 22 points earned
   - Read study material without ads
   - Verify 2 points earned

2. **Premium User Journey**
   - Upgrade to premium
   - Read novel and skip both ads
   - Verify 4 points earned
   - Read novel and watch both ads
   - Verify 34 points earned
   - Read study material
   - Verify 4 points earned
   - Complete task
   - Verify 2x points
   - Claim daily reward
   - Verify 2x points with streak
   - Buy airtime
   - Verify 2x cashback

3. **Premium Expiry**
   - Let premium expire
   - Verify reverts to free behavior
   - Verify multipliers stop applying

---

#### 6.5 Load Testing
**File:** `backend/tests/load/test_premium_scale.py` (NEW)

**Purpose:** Ensure premium logic doesn't degrade performance

**Tests:**
- 1000 concurrent reading sessions (mix of free/premium)
- 500 concurrent ad SSV callbacks
- Database query performance with multiplier lookups

---

## 🗂️ Phase 7: Documentation & Deployment

**Status:** ⏳ Not Started  
**Estimated Time:** 3-4 hours  
**Dependencies:** All previous phases

### Tasks

#### 7.1 Update API Documentation
**File:** `docs/API.md`

**Add:**
- New endpoint: `GET /api/v1/content/{id}/ad-policy`
- Updated responses for endpoints that now include multipliers
- Premium tier field in user responses

---

#### 7.2 Create Premium Admin Guide
**File:** `docs/PREMIUM_ADMIN_GUIDE.md` (NEW)

**Content:**
- How to adjust multipliers via .env
- How to modify tier_benefits.json
- How to add new content sources
- How to handle premium support tickets
- Premium metrics to monitor

---

#### 7.3 Update User Documentation
**File:** `docs/USER_GUIDE_PREMIUM.md` (NEW)

**Content:**
- What is premium?
- How points work (free vs premium)
- Novel vs study material differences
- How to skip ads (premium users)
- How to maximize earnings

---

#### 7.4 Create Deployment Checklist
**File:** `docs/PREMIUM_DEPLOYMENT.md` (NEW)

**Steps:**
1. Update .env on Render with new variables
2. Run database migration for content_source field
3. Run backfill script for existing content
4. Deploy backend changes
5. Deploy frontend changes
6. Verify premium subscriptions still work
7. Test free and premium user flows
8. Monitor error logs for 24 hours

---

#### 7.5 Environment Variables for Render

**Render Backend Service - Add These:**
```bash
PREMIUM_READING_MULTIPLIER=2.0
PREMIUM_AD_MULTIPLIER=1.5
PREMIUM_TASK_MULTIPLIER=2.0
PREMIUM_DAILY_MULTIPLIER=2.0
PREMIUM_BILLS_MULTIPLIER=2.0
AD_FREE_CONTENT_SOURCES=openstax,openstax_textbook
AD_SUPPORTED_CONTENT_SOURCES=gutenberg,gnews,user_upload
DEFAULT_CONTENT_AD_BEHAVIOR=ad_supported
PREMIUM_CAN_SKIP_PRE_READ_ADS=true
PREMIUM_CAN_SKIP_POST_READ_ADS=true
PREMIUM_CAN_SKIP_FEED_ADS=true
TIER_BENEFITS_JSON_PATH=app/tier_benefits.json
```

---

## 📊 Success Metrics

**Track these after deployment:**

1. **Premium Conversion Rate**
   - % of free users who upgrade
   - Target: >5% conversion within 30 days

2. **Premium Retention**
   - % of premium users who renew
   - Target: >70% monthly renewal

3. **Point Earnings**
   - Avg points/day for free users
   - Avg points/day for premium users
   - Premium should earn ~2x free

4. **Ad Revenue**
   - Total ad impressions (should decrease slightly)
   - Revenue per user (should increase due to premium subscriptions)

5. **User Engagement**
   - Reading time for free vs premium
   - Premium users should read MORE (better experience)

---

## 🚨 Rollback Plan

**If critical issues arise:**

1. **Backend Rollback**
   - Revert to previous commit
   - Database migration rollback
   - Restart services

2. **Feature Toggle**
   - Set `TIER_BENEFITS_JSON_PATH=""` to disable premium features
   - Multipliers default to 1.0 for all users
   - Ad gating reverts to "all ads for all users"

3. **Communication**
   - Notify premium users via email
   - Extend premium subscriptions by rollback duration
   - Issue refunds if necessary

---

## 📁 File Checklist

### New Files to Create
- [ ] `backend/app/services/tier_benefits.py`
- [ ] `backend/app/services/content_type.py`
- [ ] `backend/scripts/backfill_content_sources.py`
- [ ] `page/src/hooks/useAdPolicy.ts`
- [ ] `page/components/reader/SkipAdButton.tsx`
- [ ] `page/components/reader/PointsPreview.tsx`
- [ ] `page/components/premium/PremiumBadge.tsx`
- [ ] `page/components/premium/FeatureTooltip.tsx`
- [ ] `backend/tests/test_premium_multipliers.py`
- [ ] `backend/tests/test_content_types.py`
- [ ] `backend/tests/test_ad_policies.py`
- [ ] `backend/tests/integration/test_premium_flow.py`
- [ ] `backend/tests/load/test_premium_scale.py`
- [ ] `docs/PREMIUM_ADMIN_GUIDE.md`
- [ ] `docs/USER_GUIDE_PREMIUM.md`
- [ ] `docs/PREMIUM_DEPLOYMENT.md`
- [ ] `docs/PREMIUM_E2E_TESTS.md`

### Files to Modify
- [ ] `backend/app/config.py`
- [ ] `backend/app/models.py`
- [ ] `backend/app/services/subscription.py`
- [ ] `backend/app/routers/sessions.py`
- [ ] `backend/app/routers/ads.py`
- [ ] `backend/app/routers/content.py`
- [ ] `backend/app/routers/rewards.py`
- [ ] `backend/app/routers/bills.py`
- [ ] `backend/app/routers/payments.py`
- [ ] `backend/app/services/tasks/task_processor.py`
- [ ] `backend/app/services/content/gutenberg_importer.py`
- [ ] `backend/app/services/content/openstax_importer.py`
- [ ] `backend/app/services/content/gnews_importer.py`
- [ ] `page/src/app/(app)/catalog/reader/[id].tsx`
- [ ] `page/src/app/(app)/catalog/index.tsx`
- [ ] `page/src/app/(app)/profile/index.tsx`
- [ ] `page/src/app/(app)/premium/index.tsx`
- [ ] `backend/.env`
- [ ] `page/.env`

---

## 🎯 Next Steps

1. **Review this roadmap** with the team
2. **Approve environment variables** for Render
3. **Start Phase 1** - Backend infrastructure
4. **Daily standups** to track progress
5. **Weekly demo** of completed phases

---

**Questions? Issues? Updates?**
Document all changes to this roadmap as we progress.
