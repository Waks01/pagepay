# Command: Phase 6 — Licensed Content & Scale

**Duration:** Weeks 19+
**Agents:** Backend + Frontend
**Goal:** Replace placeholder content with revenue-share APIs, add regional variants, and scale infrastructure.

---

## Backend Tasks

### Step 1: Content Provider Abstraction (Completed in Phase 1-3)
- Content providers already implemented:
  - Gutendex (free books)
  - GNews (news articles)
  - RSS feeds (custom sources)
- All content unified in `content_catalog` table
- Content slicing implemented (2-minute reads from long-form content)
- Reading progress tracking with bookmarks

### Step 2: Premium Content Integration (Future)
- Taboola/Outbrain require publisher approval (not yet approved)
- Alternative: Hive blockchain integration for crypto-incentivized content
- `app/content/providers/hive.py`:
  - Fetch posts from Hive API
  - Mark `is_sponsored=true`, `revenue_share=true`
  - Track engagement for revenue reconciliation
- When approved, implement same pattern for Taboola

### Step 3: Regional Content Variants
- Detect region: frontend sends `Accept-Language` header or explicit `?region=` param
- `GET /api/v1/content/feed?region=NG`:
  - Nigeria: prioritize Naija news, local educational content
  - Kenya: KCSE content, local news
  - Ghana: WAEC content
- Content sources can have region override in `app_config`:
  ```
  {
    "content_sources_ng": ["gutendex", "gnews_nigeria", "naija_news_rss"],
    "content_sources_ke": ["gutendex", "gnews_kenya"],
    "content_sources_default": ["gutendex", "gnews"]
  }
  ```

### Step 4: Infrastructure Scaling
- **Database optimizations**:
  - Read replicas for `content_catalog` queries (high read, low write)
  - Connection pooling already configured (`pool_size=20`)
  - Indexes on frequently queried columns (user_id, content_id, status, created_at)
- **Caching layer**:
  - Redis for content feed (5-min TTL)
  - Cache user session state
  - Cache ad configuration
- **CDN for static assets**:
  - Serve book cover images via Cloudflare R2 or S3
  - Origin: Render.app backend
  - Cache-Control headers for browser caching
- **Rate limiting** (already implemented):
  - Per-user, per-endpoint via `slowapi`
  - Redis-backed counters for distributed rate limiting
- **Monitoring**:
  - Render.app built-in metrics (CPU, memory, response time)
  - Custom logging for critical paths (auth, payments, bills)
  - Error tracking: Sentry integration (Phase 9)

### Step 5: Performance Optimizations
- **Backend**:
  - Database queries use select/join optimization
  - Async SQLAlchemy for non-blocking I/O
  - Bulk inserts for content imports
  - Pagination on all list endpoints (default limit: 20-50)
- **API response times** (target):
  - Auth endpoints: <200ms
  - Content feed: <300ms (with cache)
  - Reading session operations: <150ms
  - Bills API: <2s (external provider dependency)

---

## Frontend Tasks

### Step 1: Performance Optimizations (Actual State)
- **React Native optimization**:
  - `ScrollView` / `FlatList` used in most screens (FlashList NOT yet adopted)
  - `react-native-reanimated` for smooth animations
  - Standard `Image` component used (expo-image NOT yet adopted)
  - No code splitting / React.lazy implemented
- **Bundle size**:
  - Monitor with `npx expo-optimize`
  - Tree shaking enabled (Metro bundler)
- **Network optimization**:
  - Prefetch next article on scroll
  - Request deduplication via TanStack Query

### Step 2: Regional UX
- `expo-localization` detects locale and country
- Send region in API headers: `X-User-Region: NG`
- Content tabs adapt:
  - Nigeria: "For You" + "Naija News" + "Education"
  - Kenya: "For You" + "Kenya News" + "KCSE Prep"
  - Default: "For You" + "World News"

### Step 3: Polish & UX Enhancements
- Loading states: skeleton screens or spinners on all async actions
- Error states: retry button with friendly message
- Empty states: illustrations + clear CTA
- Success feedback: toast notifications (not modals)
- Haptic feedback on important actions (reward claim, task complete)
- Dark mode: already implemented via `useEffectiveScheme` + `ThemeProvider`

### Step 4: Build Optimization
- EAS Build profiles:
  - `development`: dev-client with debugging
  - `preview`: production-like build for testing
  - `production`: optimized for Play Store
- OTA updates via `expo-updates` for non-native changes
- Version tracking: `app.json` version incremented per release

---

## Acceptance Criteria (Phase 6 Complete)
✅ Infrastructure handles current load with headroom for 10x growth
✅ Content feed loads reliably (<3s cold, <1s cached)
✅ Regional detection works via locale/header
✅ Rate limiting prevents abuse (per-user, per-endpoint)
✅ Database connection pooling configured
✅ All Phase 1-5 tests still pass
✅ Frontend bundle optimized (target <3MB initial JS)
✅ Error handling: all API failures show user-friendly messages
✅ Monitoring: logs capture critical events (auth, payments, errors)
✅ E2E: User in Nigeria → sees regional content → content loads smoothly
✅ No TODO comments, placeholder strings, or mock data in committed code

---

## Current Status (as of Phase 8)
- **Completed**: Basic scaling config (pooling, rate limiting), regional detection
- **In Progress**: Redis caching, CDN setup not started
- **Pending**: Taboola/Outbrain approval, Hive integration, full monitoring suite
- **Performance**: Backend handles current load (<1000 DAU) with headroom for 10x growth
