# Command: Phase 5 — Referrals & Community

**Duration:** Weeks 14–18
**Agents:** Backend + Frontend
**Goal:** Build referral program and community study notes feed. Drive organic growth and retention.

---

## Backend Tasks

### Step 1: Referral System Implementation
- Referral code generation (already in Phase 1 auth):
  - Every user gets unique 6-char alphanumeric code on registration
  - Stored in `user.referral_code`
  - New user can provide `referral_code` param during registration
  - Stored in `user.referred_by`
- `GET /api/v1/referral/code`:
  - Returns current user's referral code
  - Generate if doesn't exist (legacy users)
- `GET /api/v1/referral/stats`:
  - Returns: `{code, total_referrals, active_referrals, pending_rewards, claimed_rewards, total_earned}`
  - Query `referrals` table joined with `users`
- Referral validation on registration:
  - Check referral code exists in database
  - Prevent self-referral (referee.id != referrer.id)
  - Daily limit: max 10 referrals per day per user (stored in `user.referrals_today_count`)
- `POST /api/v1/referral/validate`:
  - Triggered automatically when referee completes first verified reading session (≥2 minutes)
  - Awards: referrer gets 500 pts, referee gets 200 pts
  - Updates `referrals` table: `referee_completed_first_session=true`, `reward_granted=true`
  - Creates wallet transaction records for both users
- Table `referrals` (already exists):
  ```
  id, referrer_id (FK User), referee_id (FK User), code,
  referee_completed_first_session BOOLEAN DEFAULT FALSE,
  reward_granted BOOLEAN DEFAULT FALSE,
  created_at
  ```

### Step 2: Cron Jobs (Add to docker-compose or separate worker)
- Hive sync: every hour, fetch new posts from Hive API, insert into `content_catalog`
- Subscription expiry: daily cleanup of expired premium users (as in Phase 4)
- Referral daily cap: reset `referrals_today_count` if date changed

### Step 3: Community Notes Feed Implementation
- `POST /api/v1/community/notes`:
  - Auth required
  - Request: `{title, content, course_code?, university?}`
  - Save to `community_notes` table with `status='pending'` (moderation queue)
  - Returns: created note ID
- `GET /api/v1/community/notes`:
  - Paginated list of approved notes only (`status='approved'`)
  - Query params: `?course_code=CSC201&university=UNILAG&sort=popular|recent&page=1&limit=20`
  - Returns: `[{id, title, content_preview, author_name, course_code, university, likes_count, created_at}]`
- `GET /api/v1/community/notes/{id}`:
  - Full note details with complete content
- `POST /api/v1/community/notes/{id}/like`:
  - Toggle like (store in `community_likes` table)
  - Update `community_notes.likes_count` counter
  - Returns: new like status and count
- `GET /api/v1/community/notes/my`:
  - User's own notes (all statuses: pending, approved, rejected)
- Admin moderation endpoints:
  - `GET /api/v1/admin/community/notes/pending`: List notes awaiting approval
  - `POST /api/v1/admin/community/notes/{id}/approve`: Approve note
  - `POST /api/v1/admin/community/notes/{id}/reject`: Reject note with reason
- Table `community_notes` (already exists):
  ```
  id, user_id, title, content TEXT, course_code, university,
  status (pending|approved|rejected), likes_count INTEGER DEFAULT 0,
  created_at, updated_at
  ```
- Table `community_likes`:
  ```
  id, user_id, note_id, created_at
  UNIQUE(user_id, note_id)
  ```

### Step 4: Analytics Endpoints (Basic)
- `GET /api/v1/admin/analytics/dau`:
  - Daily active users count
- `GET /api/v1/admin/analytics/retention`:
  - Cohort data (Day 1, Day 7 signups returning)
- `GET /api/v1/admin/analytics/content-performance`:
  - Top 20 articles by `reading_sessions` count
- Protect these with admin-only JWT (new `role` column or separate admin auth)

---

## Frontend Tasks

### Step 1: Referral Share Sheet
- `app/(tabs)/profile.tsx` → Referral section
- `expo-sharing` share sheet:
  - Pre-filled WhatsApp message: "Join PagePay and earn by reading! My code: ABC123"
  - Copy link button
- Progress tracker: "3/5 referrals to unlock bonus"
- Stats display: clicks, signups, earnings from referrals

### Step 2: Community Feed
- New tab or section: `app/(tabs)/community.tsx`
- `ScrollView` of note cards with:
  - Title, author, course code, likes count
  - Timestamp: "2 days ago"
- Filter chips at top: All | MY_COURSES | POPULAR | RECENT
- Note detail: expands to full text
- Like button: `useMutation` calls `POST /api/v1/community/:id/like`

### Step 3: Continue Reading Carousel
- Home tab: horizontal `FlashList` of "Continue Reading" items
- Pull from backend: `GET /api/v1/reading/continue` (last 5 unfinished sessions)
- Show progress ring: "Page 3 of 12, 50 pts remaining"
- Tap resumes reader at saved scroll position (store `scroll_y` in session)

### Step 4: Streak Counter
- Home tab header: "🔥 7 day streak"
- Logic: consecutive days with ≥1 verified reading session
- Backend endpoint: `GET /api/v1/users/me/streak`
- Streak bonus: 7 days = +20% pts, 30 days = +50% pts (configure in `app_config`)

---

## Acceptance Criteria (Phase 5 Complete)
✅ Referral code generation + share sheet works
✅ Referee completes first session → both users credited
✅ Daily referral cap enforced (max 10/day)
✅ Community notes feed loads + filters
✅ Like toggle works without page refresh
✅ Continue reading carousel displays last 5 books
✅ Streak counter updates on daily reading
✅ Admin analytics endpoints return real data
✅ All Phase 1-4 tests still pass
✅ E2E: refer friend → friend registers → both read → both get bonus points
✅ No TODO comments, placeholder strings, or mock data in committed code
