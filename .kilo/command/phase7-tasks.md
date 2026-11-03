# Command: Phase 7 — Social Tasks Marketplace

**Duration:** Weeks 19–23
**Agents:** Backend + Frontend
**Goal:** Build worker-sponsor marketplace for social media tasks (follow, like, share, retweet). Workers earn points; sponsors pay to promote content.

---

## Backend Tasks

### Step 1: User Role Extension
- Extend `User` model with sponsor/worker fields:
  ```
  is_worker BOOLEAN DEFAULT TRUE
  is_sponsor BOOLEAN DEFAULT FALSE
  sponsor_wallet_balance INTEGER (kobo) DEFAULT 0
  sponsor_verified BOOLEAN DEFAULT FALSE
  sponsor_kyc_status VARCHAR(20) DEFAULT 'none'  # none | pending | approved | rejected
  sponsor_kyc_submitted_at DATETIME
  sponsor_kyc_reviewed_at DATETIME
  sponsor_kyc_reviewer_id INTEGER
  business_name VARCHAR(255)
  business_registration_number VARCHAR(100)
  sponsor_auto_approve_ai BOOLEAN DEFAULT FALSE
  ```
- Worker profile fields (already in User model):
  ```
  gender VARCHAR(20), date_of_birth DATE, city VARCHAR(100), 
  country VARCHAR(50) DEFAULT 'Nigeria', languages TEXT (JSON array)
  ```

### Step 2: Task Schema
- New table `social_tasks`:
  ```
  id, sponsor_id (FK User), title, description, platform (instagram|twitter|facebook|youtube|tiktok),
  action_type (follow|like|share|retweet|comment|subscribe),
  target_url TEXT (profile/post URL),
  reward_points INTEGER (what worker earns per completion),
  sponsor_cost_kobo INTEGER (what sponsor pays per completion, points + platform fee),
  total_budget_kobo INTEGER (sponsor's max spend),
  submissions_target INTEGER (how many workers needed),
  submissions_current INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending'  # pending | active | paused | completed | cancelled
  requirements JSONB (min followers, location, age range),
  proof_required BOOLEAN DEFAULT TRUE (screenshot required?),
  auto_approve_ai BOOLEAN DEFAULT FALSE (use AI to verify proof),
  created_at, expires_at, completed_at
  ```

### Step 3: Submission & Verification
- New table `task_submissions`:
  ```
  id, task_id (FK), worker_id (FK User), status (pending|approved|rejected),
  proof_url TEXT (screenshot uploaded to S3/R2/Cloudinary),
  proof_metadata JSONB (AI verification result),
  submitted_at, reviewed_at, reviewer_id (FK User or NULL for AI),
  rejection_reason TEXT, points_awarded INTEGER
  ```
- `POST /api/v1/tasks/{id}/submit`:
  - Worker uploads screenshot proof
  - If `task.auto_approve_ai=true`: send to AI vision model to verify
    - Check: correct platform, visible action (like/follow button), target username matches
  - If AI confident: auto-approve, credit points immediately
  - If AI uncertain or manual review: status='pending', sponsor reviews
  - Create submission record, increment `task.submissions_current`

### Step 4: Sponsor Task Management
- `POST /api/v1/sponsor/tasks/create`:
  - Request: `{title, description, platform, action_type, target_url, reward_points, submissions_target, requirements, expires_at}`
  - Calculate `sponsor_cost_kobo = reward_points + platform_fee(10%)`
  - Total cost: `sponsor_cost_kobo * submissions_target`
  - Debit from `sponsor_wallet_balance`, hold in escrow
  - Create task with `status='pending'`, admin reviews before making active
- `GET /api/v1/sponsor/tasks`:
  - List sponsor's tasks with stats (submissions, approval rate, remaining budget)
- `PATCH /api/v1/sponsor/tasks/{id}/pause`:
  - Pause/resume task
- `GET /api/v1/sponsor/submissions/{task_id}`:
  - View all submissions for a task
- `POST /api/v1/sponsor/submissions/{id}/review`:
  - Request: `{approved: bool, rejection_reason?}`
  - If approved: credit worker points, deduct from escrow
  - If rejected: worker can dispute (Phase 8 feature)

### Step 5: Worker Discovery & Completion
- `GET /api/v1/tasks`:
  - List active tasks matching worker profile (location, age, platform accounts)
  - Sort by: highest reward, newest, expiring soon
  - Filters: platform, action type, reward range
- `POST /api/v1/tasks/{id}/start`:
  - Mark worker as "working on task" (prevent duplicate claims)
  - Return task details + target URL
- `POST /api/v1/tasks/{id}/submit`:
  - Upload proof via `multipart/form-data`
  - Store image on cloud storage (Cloudinary or R2)
  - Create submission record
  - If auto-approve: instant credit
  - If manual: notify sponsor

### Step 6: Sponsor KYC
- `POST /api/v1/sponsor/register`:
  - Request: `{business_name, business_registration_number?, phone, email}`
  - Set `user.is_sponsor=true`, `sponsor_kyc_status='pending'`
- `POST /api/v1/sponsor/kyc/submit`:
  - Upload documents (CAC certificate, ID, proof of address)
  - Admin reviews manually or via AI document extraction
- `GET /api/v1/admin/sponsors/pending`:
  - List pending KYC submissions
- `POST /api/v1/admin/sponsors/{id}/approve`:
  - Set `sponsor_verified=true`, `sponsor_kyc_status='approved'`

### Step 7: Analytics & Leaderboards
- `GET /api/v1/tasks/leaderboard`:
  - Top workers by tasks completed this week/month
  - Returns: `{rank, user_id, username, tasks_completed, points_earned}`
- `GET /api/v1/tasks/stats`:
  - Worker stats: total tasks, approval rate, avg completion time
- Sponsor dashboard stats (via admin routes):
  - Total spend, total submissions, engagement metrics

---

## Frontend Tasks

### Step 1: Worker Task Browser
- New tab: `app/(tabs)/tasks.tsx`
- `FlashList` of task cards:
  - Platform icon + action type badge
  - Reward amount (prominent)
  - Submissions remaining
  - Expiry countdown
- Filters: platform, action type, reward range
- Search by keyword

### Step 2: Task Detail & Completion Flow
- `app/tasks/[id].tsx`:
  - Show full description, requirements, target URL
  - "Open Link" button → opens target in browser (or in-app webview)
  - Instructions: "Follow the account, then upload screenshot proof"
  - Upload button → `expo-image-picker` for screenshot
  - Submit → shows loading spinner
  - If auto-approved: instant success modal with confetti
  - If pending: "Awaiting sponsor review" message
- Track task status in local state (started, submitted, completed)

### Step 3: Worker Profile & Stats
- `app/tasks/profile.tsx`:
  - Display: total tasks completed, points earned from tasks, approval rate
  - Badges/achievements: "First Task", "10 Tasks", "100 Tasks", "Top 10 This Week"
  - Completion history: list of recent tasks with status
- Leaderboard view: rankings with user position highlighted

### Step 4: Sponsor Registration & Dashboard
- `app/sponsor/register.tsx`:
  - Form: business name, registration number, contact info
  - KYC upload: documents picker
  - Submit for review
- `app/sponsor/dashboard.tsx`:
  - Stats cards: total spend, active tasks, submissions pending review
  - Task list with quick actions (pause, view submissions)
  - Create task button → navigate to task creation form

### Step 5: Create Task Flow
- `app/sponsor/tasks/create.tsx`:
  - Multi-step form:
    1. Platform + action type selection (visual buttons)
    2. Target URL input (validate format)
    3. Budget: reward per completion, number of workers, total cost preview
    4. Requirements: location, age range, min followers (optional)
    5. Proof settings: manual review vs AI auto-approve
    6. Review & submit
  - Cost calculator: live preview of total cost including platform fee (10%)
  - Insufficient balance → show "Fund Wallet" CTA

### Step 6: Submission Review Interface
- `app/sponsor/tasks/[id]/submissions.tsx`:
  - Grid view of submission screenshots
  - Tap to expand + approve/reject buttons
  - Bulk actions: approve all, reject all
  - Filters: pending, approved, rejected

### Step 7: Worker Messaging (Basic)
- `app/tasks/[id]/messages.tsx`:
  - Simple chat between worker and sponsor (for disputes/questions)
  - `POST /api/v1/tasks/{id}/messages` sends message
  - `GET /api/v1/tasks/{id}/messages` fetches thread
  - Real-time updates: poll every 5s or use WebSocket (Phase 8)

---

## Acceptance Criteria (Phase 7 Complete)
✅ Worker can browse tasks, start task, submit proof, earn points
✅ Sponsor can create task, fund from wallet, review submissions
✅ AI auto-approval works for Instagram follow tasks (80%+ accuracy)
✅ Manual review flow allows sponsor to approve/reject with reason
✅ KYC verification prevents fraudulent sponsors
✅ Leaderboard shows top workers updated hourly
✅ Task expiry automatically closes submissions
✅ Escrow system prevents sponsor from withdrawing funds mid-task
✅ Worker dispute flow allows appealing rejections (basic)
✅ All Phase 1-6 tests still pass
✅ E2E: Sponsor creates task → worker completes → proof uploaded → AI approves → points credited
✅ No TODO comments, placeholder strings, or mock data in committed code
