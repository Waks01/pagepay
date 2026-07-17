# PagePay Admin Management System: Complete Architecture

**Version:** 1.0  
**Last Updated:** January 2025  
**Status:** Design Phase

---

## Table of Contents

1. [Overview](#overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Feature Modules](#feature-modules)
5. [Backend API Specification](#backend-api-specification)
6. [Frontend Architecture](#frontend-architecture)
7. [UI/UX Design System](#uiux-design-system)
8. [Security & Authentication](#security--authentication)
9. [State Management Strategy](#state-management-strategy)
10. [Data Flow Architecture](#data-flow-architecture)
11. [Implementation Roadmap](#implementation-roadmap)

---

## Overview

### Purpose
The PagePay Admin Management System is a comprehensive web-based dashboard for platform operators to:
- Manage users, content, and financial operations
- Monitor system health and detect fraud
- Configure platform settings and AI providers
- Moderate community content and handle disputes

### Core Principles
1. **Platform Consistency** - Mirror PagePay mobile app design language
2. **Real-time Monitoring** - Live dashboards with React Query polling
3. **Role-Based Access** - Granular permissions (super_admin, finance, moderator, support)
4. **Audit Everything** - Log all admin actions for compliance
5. **Production-Ready** - No placeholders, mock data, or TODOs


---

## Technology Stack

### Frontend
```json
{
  "framework": "React 19",
  "buildTool": "Vite 6",
  "routing": "react-router-dom v7",
  "stateManagement": {
    "server": "TanStack Query v5",
    "client": "Zustand v5",
    "persistence": "localStorage"
  },
  "styling": "Tailwind CSS 4",
  "icons": "lucide-react",
  "http": "axios",
  "charts": "recharts",
  "tables": "tanstack/react-table v8",
  "forms": "react-hook-form + zod",
  "toast": "sonner",
  "language": "TypeScript 5.9"
}
```

### Backend (Existing)
- FastAPI 0.115+
- MySQL 8.0 (async via asyncmy + SQLAlchemy 2.0)
- JWT authentication (admin tokens)
- Docker deployment

### Design System
- **Colors:** PagePay brand palette (#6C5CE7 purple, #00B894 mint)
- **Typography:** Inter (web) / Space Grotesk (headings)
- **Layout:** Sidebar + Main Content (desktop), Drawer (mobile)
- **Theme:** Light mode default, dark mode optional


---

## Project Structure

```
pagepay/
├── backend/                    # Existing FastAPI backend
│   └── app/
│       └── routers/
│           └── admin.py        # Existing admin routes (expand)
├── client/                     # Existing React Native app
└── admin/                      # NEW: Admin Dashboard (React Web)
    ├── public/
    │   ├── favicon.ico
    │   └── logo.svg
    ├── src/
    │   ├── main.tsx           # Entry point
    │   ├── App.tsx            # Root component
    │   ├── routes/            # React Router v7 routes
    │   │   ├── _layout.tsx    # Root layout (sidebar + header)
    │   │   ├── login.tsx      # Admin login
    │   │   ├── dashboard.tsx  # Main dashboard
    │   │   ├── users/         # User management
    │   │   │   ├── index.tsx
    │   │   │   └── [id].tsx
    │   │   ├── finance/       # Financial management
    │   │   │   ├── revenue.tsx
    │   │   │   ├── payouts.tsx
    │   │   │   └── subscriptions.tsx
    │   │   ├── content/       # Content management
    │   │   │   ├── catalog.tsx
    │   │   │   ├── import.tsx
    │   │   │   └── moderation.tsx
    │   │   ├── community/     # Community moderation
    │   │   │   └── notes.tsx
    │   │   ├── fraud/         # Fraud detection
    │   │   │   └── dashboard.tsx
    │   │   ├── ai/            # AI provider monitoring
    │   │   │   └── dashboard.tsx
    │   │   ├── config/        # System configuration
    │   │   │   └── settings.tsx
    │   │   └── logs/          # Audit logs
    │   │       └── index.tsx
    │   ├── features/          # Feature-based modules
    │   │   ├── auth/
    │   │   │   ├── hooks/
    │   │   │   │   ├── use-login.ts
    │   │   │   │   └── use-logout.ts
    │   │   │   ├── store/
    │   │   │   │   └── auth-store.ts  # Zustand
    │   │   │   └── components/
    │   │   │       └── LoginForm.tsx
    │   │   ├── users/
    │   │   │   ├── hooks/
    │   │   │   │   ├── use-users.ts
    │   │   │   │   ├── use-user-detail.ts
    │   │   │   │   └── use-ban-user.ts
    │   │   │   ├── components/
    │   │   │   │   ├── UserTable.tsx
    │   │   │   │   ├── UserDetail.tsx
    │   │   │   │   ├── BanUserModal.tsx
    │   │   │   │   └── AdjustBalanceModal.tsx
    │   │   │   └── types.ts
    │   │   ├── finance/
    │   │   │   ├── hooks/
    │   │   │   │   ├── use-revenue.ts
    │   │   │   │   ├── use-payouts.ts
    │   │   │   │   └── use-approve-payout.ts
    │   │   │   ├── components/
    │   │   │   │   ├── RevenueChart.tsx
    │   │   │   │   ├── PayoutTable.tsx
    │   │   │   │   └── SubscriptionTable.tsx
    │   │   │   └── types.ts
    │   │   ├── content/
    │   │   ├── community/
    │   │   ├── fraud/
    │   │   ├── ai/
    │   │   └── config/
    │   ├── shared/            # Shared utilities
    │   │   ├── api/
    │   │   │   ├── client.ts       # Axios instance
    │   │   │   ├── endpoints.ts    # API endpoint constants
    │   │   │   └── types.ts        # Shared API types
    │   │   ├── components/
    │   │   │   ├── Sidebar.tsx
    │   │   │   ├── Header.tsx
    │   │   │   ├── PageHeader.tsx
    │   │   │   ├── StatCard.tsx
    │   │   │   ├── DataTable.tsx   # Generic table
    │   │   │   ├── Modal.tsx
    │   │   │   ├── Badge.tsx
    │   │   │   └── EmptyState.tsx
    │   │   ├── hooks/
    │   │   │   ├── use-auth.ts
    │   │   │   ├── use-toast.ts
    │   │   │   └── use-permissions.ts
    │   │   ├── lib/
    │   │   │   ├── format.ts       # Money, date formatting
    │   │   │   ├── validation.ts   # Zod schemas
    │   │   │   └── constants.ts
    │   │   └── types/
    │   │       └── index.ts
    │   └── styles/
    │       ├── globals.css
    │       └── variables.css       # CSS custom properties
    ├── .env.example
    ├── .env.local
    ├── vite.config.ts
    ├── tailwind.config.ts
    ├── tsconfig.json
    └── package.json
```

---

## Feature Modules

### 1. Dashboard (Landing Page)

**Route:** `/dashboard`  
**Purpose:** High-level platform health at a glance

#### Metrics Cards (Top Row)
- Total Users (with 7-day growth %)
- Active Users Today (DAU)
- Total Revenue This Month (ads + premium)
- Pending Payouts Count

#### Charts (Middle Section)
- **Revenue Chart** (recharts line chart)
  - Last 30 days
  - Ad revenue vs Premium revenue
  - Hover shows breakdown
- **User Growth Chart** (recharts area chart)
  - Daily signups last 30 days
  - Moving average line

#### Quick Actions (Bottom)
- Import Content (button → `/content/import`)
- Approve Pending Notes (badge count → `/community/notes`)
- Review Fraud Flags (badge count → `/fraud/dashboard`)

#### Data Sources
- `GET /api/v1/admin/dashboard/stats` (new endpoint)
- `GET /api/v1/admin/revenue/chart?days=30` (new)
- `GET /api/v1/admin/users/growth?days=30` (new)
- Polls every 60 seconds via React Query


---

### 2. User Management

**Routes:**
- `/users` - List all users
- `/users/:id` - User detail page

#### Users List Page (`/users`)

**Features:**
- **Search:** Email, phone, referral code (debounced 300ms)
- **Filters:**
  - Tier: All | Free | Premium Monthly | Premium Yearly
  - Status: All | Active | Banned | Flagged
  - Date range: Last 7d | 30d | 90d | Custom
- **Sort:** Created (newest/oldest), Balance (high/low), Last active
- **Actions per row:**
  - View detail (eye icon → `/users/:id`)
  - Ban/Unban (shield icon)
  - Adjust balance (wallet icon)
- **Bulk actions:** Ban selected, Export CSV

**Table Columns:**
- ID (link)
- Email/Phone (masked if not super_admin)
- Tier (badge: free=gray, premium=gold)
- Balance (formatted ₦)
- Referrals count
- Last active (relative time)
- Status (active/banned badge)
- Actions dropdown

**Data Source:** `GET /api/v1/admin/users?page=1&limit=50&tier=&status=&search=`

#### User Detail Page (`/users/:id`)

**Layout:** Split screen

**Left Panel: User Info Card**
- Avatar placeholder (first letter of email)
- Email, phone, ID
- Tier badge
- Created date, last active
- Referral code (copyable)
- Referred by (link if exists)
- Quick actions:
  - Ban/Unban
  - Upgrade to premium
  - Adjust balance
  - View audit log

**Right Panel: Tabs**

**Tab 1: Overview**
- Points balance (large number)
- Lifetime earned
- Lifetime spent (study unlocks, withdrawals)
- Total reading time
- Current streak
- Fraud flags (if any, red alert)

**Tab 2: Reading Sessions**
- Table: Start time | Content | Duration | Points | Status
- Pagination

**Tab 3: Transactions**
- Table: Date | Type (read, ad, withdrawal, unlock) | Amount | Balance after
- Filter by type

**Tab 4: Referrals**
- List of referred users
- Reward status

**Tab 5: Fraud Flags**
- List of flags (if any)
- Severity, date, reviewed status

**Data Sources:**
- `GET /api/v1/admin/users/:id`
- `GET /api/v1/admin/users/:id/sessions`
- `GET /api/v1/admin/users/:id/transactions`
- `GET /api/v1/admin/users/:id/referrals`
- `GET /api/v1/admin/fraud/user/:id`

---

### 3. Financial Management

**Routes:**
- `/finance/revenue` - Revenue dashboard
- `/finance/payouts` - Payout management
- `/finance/subscriptions` - Premium subscription tracking

#### Revenue Dashboard (`/finance/revenue`)

**Top Metrics Cards:**
- Total Revenue (MTD) - ads + premium
- Ad Revenue (MTD) - breakdown by AdMob/AppLovin
- Premium Revenue (MTD) - breakdown by tier
- Gross Profit Margin % (revenue - payouts - costs)

**Charts:**
- **Revenue Breakdown** (recharts stacked bar)
  - Daily bars: Ad revenue (green) + Premium (purple)
  - Last 30 days
- **Ad Provider Comparison** (recharts pie)
  - AdMob vs AppLovin split
- **Premium Tier Distribution** (recharts bar)
  - Free vs Monthly vs Yearly user counts

**Export:**
- Download CSV report (date range selector)

**Data:** `GET /api/v1/admin/revenue/summary?start_date=&end_date=`

#### Payouts Management (`/finance/payouts`)

**Filters:**
- Status: All | Pending | Success | Failed
- Date range
- Amount range

**Table Columns:**
- Reference (link)
- User (link to user detail)
- Bank (name + last 4 digits)
- Amount (₦)
- Fee (₦)
- Status badge
- Created date
- Settled date (if completed)
- Actions:
  - Approve (if pending + Paystack balance check failed)
  - Reject (if fraud suspected)
  - View details

**Pending Payouts Alert:**
- Banner at top if any pending > 1 hour
- "X payouts require manual review"

**Platform Balance Widget:**
- Shows current Paystack balance
- Warning if < ₦50,000
- Refreshes every 5 minutes

**Data:**
- `GET /api/v1/admin/payouts?status=&page=&limit=`
- `GET /api/v1/admin/platform-balance` (existing endpoint)
- `POST /api/v1/admin/payouts/:id/approve`
- `POST /api/v1/admin/payouts/:id/reject`

#### Subscriptions (`/finance/subscriptions`)

**Metrics Cards:**
- Active subscribers
- MRR (Monthly Recurring Revenue)
- Churn rate (last 30 days)
- Average subscription lifetime

**Table Columns:**
- User (link)
- Tier (badge)
- Amount (₦)
- Start date
- Expires date
- Status (active/expired/canceled badge)
- Actions:
  - Refund
  - Extend expiration
  - Cancel

**Filters:**
- Status: All | Active | Expired | Canceled
- Tier: Monthly | Yearly

**Data:**
- `GET /api/v1/admin/subscriptions?status=&tier=&page=`
- `POST /api/v1/admin/subscriptions/:id/refund`
- `PATCH /api/v1/admin/subscriptions/:id/extend`

---

### 4. Content Management

**Routes:**
- `/content/catalog` - Browse/edit all content
- `/content/import` - Import from Gutendex/GNews
- `/content/moderation` - Community notes moderation

#### Catalog (`/content/catalog`)

**Filters:**
- Content type: All | Book | Article | News
- Category: Fiction | Non-Fiction | News | Classics | etc.
- Sponsored: All | Organic | Sponsored
- Search by title/author

**Table:**
- ID (link)
- Title (truncated, hover shows full)
- Type badge
- Category
- Author
- Read time (minutes)
- Views count
- Slices count (if parent work)
- Created date
- Actions:
  - Edit metadata
  - Delete
  - Re-slice (if book)

**Bulk Actions:**
- Delete selected
- Change category

**Data:**
- `GET /api/v1/admin/content?type=&category=&search=&page=`
- `DELETE /api/v1/admin/content/:id`
- `PATCH /api/v1/admin/content/:id`

#### Import (`/content/import`)

**Form:**
- Source dropdown: Gutenberg | GNews
- Limit slider (1-500)
- Start page number
- Category override (optional)
- "Import Now" button

**Recent Imports Table:**
- Timestamp
- Source
- Count imported
- Status (success/partial/failed)
- Admin who triggered
- View logs link

**Data:**
- `POST /api/v1/admin/content/import` (existing endpoint)
- `GET /api/v1/admin/content/import-history`

#### Moderation (`/content/moderation`)

**Tabs:**
- Pending approval (default)
- Approved
- Rejected

**Pending Table:**
- ID
- User (link)
- Title
- Course code
- University
- Preview (first 200 chars)
- Submitted date
- Actions:
  - Approve (check icon)
  - Reject (X icon)
  - View full

**Data:**
- `GET /api/v1/admin/community/notes?status=pending`
- `POST /api/v1/admin/community/notes/:id/approve`
- `POST /api/v1/admin/community/notes/:id/reject`

---

### 5. Fraud Detection

**Route:** `/fraud/dashboard`

**Alert Banner:**
- "X high-severity flags require review" (red)
- "Y medium-severity flags" (yellow)

**Tabs:**
- Suspicious sessions
- Duplicate accounts
- Referral abuse
- Ad fraud
- All flags

#### Suspicious Sessions Tab

**Indicators:**
- Scroll velocity too consistent (bot)
- No scroll events but long duration
- Multiple sessions from same IP in short time
- Impossible reading speed

**Table:**
- User (link)
- Session ID
- Content
- Duration
- Scroll events
- Flag reason
- Severity badge
- Created date
- Status (pending/reviewed)
- Actions:
  - Mark legitimate
  - Ban user
  - Reverse points

**Data:**
- `GET /api/v1/admin/fraud/sessions?severity=&status=`
- `POST /api/v1/admin/fraud/sessions/:id/review`

#### Duplicate Accounts Tab

**Detection Logic:**
- Same device ID
- Same IP address (multiple accounts)
- Similar email patterns (user+1@, user+2@)

**Table:**
- Cluster ID
- Accounts count
- Users list (links)
- Detection reason
- Total earnings across cluster
- Actions:
  - Merge accounts
  - Ban all
  - Mark false positive

**Data:**
- `GET /api/v1/admin/fraud/duplicates`
- `POST /api/v1/admin/fraud/duplicates/:cluster_id/action`

#### Referral Abuse Tab

**Patterns:**
- Self-referrals (same IP)
- Farm patterns (1 referrer → 100 new users in 1 day)
- Referee never reads (signup → abandon)

**Table:**
- Referrer (link)
- Referee count
- Pattern detected
- Total rewards earned
- Actions:
  - Reverse rewards
  - Ban referrer

**Data:**
- `GET /api/v1/admin/fraud/referrals`
- `POST /api/v1/admin/fraud/referrals/:referrer_id/reverse`

---

### 6. AI Provider Monitoring

**Route:** `/ai/dashboard`

**Provider Health Cards (Top Row):**
- Gemini 2.5 Flash
- Groq Llama 3.3 70B
- OpenRouter
- Cerebras

Each card shows:
- Status indicator (green=healthy, yellow=degraded, red=circuit open)
- Success rate (last 100 calls)
- Average latency (ms)
- Circuit status (open/closed)
- Last failure time
- Quick action: "Reset circuit"

**Usage Chart:**
- Stacked area chart (recharts)
- Last 7 days
- Requests per day by provider
- Hover shows token count

**Error Log Table:**
- Timestamp
- Provider
- Task type (SOW parse, quiz gen, chat)
- Error message (truncated)
- User affected (link if available)
- Retry count

**Data:**
- `GET /api/v1/admin/ai/health`
- `GET /api/v1/admin/ai/usage?days=7`
- `GET /api/v1/admin/ai/errors?page=&limit=`
- `POST /api/v1/admin/ai/:provider/reset-circuit`

---

### 7. System Configuration

**Route:** `/config/settings`

**Tabs:**
- App config (OTA settings)
- Ad network settings
- Point rates
- Withdrawal fees

#### App Config Tab

**Table:**
- Key (e.g., `admob.app_id.android`)
- Value (text input, inline edit)
- Environment (prod/dev badge)
- Description
- Last updated
- Updated by
- Actions:
  - Edit
  - Delete
  - View history

**Add new config:**
- Modal form
- Key, value, environment, description

**Data:**
- `GET /api/v1/admin/config`
- `PUT /api/v1/admin/config/:key`
- `POST /api/v1/admin/config`
- `DELETE /api/v1/admin/config/:key`

#### Point Rates Tab

**Editable Values:**
- Base reading rate (pts per 10 min)
- Quiz bonus (pts for 80%+ score)
- Referral reward (pts for referrer)
- Referee bonus (pts for new user)
- Streak multipliers (day 3, 7, 30)

**Data:**
- Stored in app_config table
- Keys like `points.reading_rate`, `points.quiz_bonus`

---

### 8. Audit Logs

**Route:** `/logs`

**Filters:**
- Admin user dropdown (who did it)
- Action type: All | User ban | Balance adjust | Config change | Payout approve | etc.
- Target type: All | User | Content | Payment | Config
- Date range

**Table:**
- Timestamp
- Admin (email or token hash if service account)
- Action (badge colored by severity)
- Target type
- Target ID (link if applicable)
- Changes (before → after, JSON diff viewer)
- IP address
- Result (success/failed)

**Export:** Download CSV

**Data:**
- `GET /api/v1/admin/logs?admin_id=&action=&target_type=&start_date=&end_date=&page=`

**Use cases:**
- Compliance audits
- Debug "who changed this config?"
- Trace unauthorized actions
- Review admin activity before granting more permissions

---

## Backend API Specification

### New Admin Router Structure

```python
# backend/app/routers/admin.py (expand existing)

router = APIRouter(prefix="/admin", tags=["admin"])

# Existing
POST   /admin/content/import
POST   /admin/content/slice
POST   /admin/content/reslice
GET    /admin/content/platform-balance
```

# NEW ENDPOINTS TO IMPLEMENT

# ── Dashboard ──────────────────────────────────────────
GET    /admin/dashboard/stats
GET    /admin/revenue/chart
GET    /admin/users/growth

# ── User Management ────────────────────────────────────
GET    /admin/users
GET    /admin/users/:id
PATCH  /admin/users/:id
DELETE /admin/users/:id
POST   /admin/users/:id/adjust-balance
POST   /admin/users/:id/ban
POST   /admin/users/:id/unban
GET    /admin/users/:id/sessions
GET    /admin/users/:id/transactions
GET    /admin/users/:id/referrals

# ── Financial Management ───────────────────────────────
GET    /admin/revenue/summary
GET    /admin/payouts
POST   /admin/payouts/:id/approve
POST   /admin/payouts/:id/reject
GET    /admin/subscriptions
POST   /admin/subscriptions/:id/refund
PATCH  /admin/subscriptions/:id/extend

# ── Content Management ─────────────────────────────────
GET    /admin/content
DELETE /admin/content/:id
PATCH  /admin/content/:id
GET    /admin/content/import-history
GET    /admin/community/notes
POST   /admin/community/notes/:id/approve
POST   /admin/community/notes/:id/reject
```

# ── Fraud Detection ────────────────────────────────────
GET    /admin/fraud/sessions
POST   /admin/fraud/sessions/:id/review
GET    /admin/fraud/duplicates
POST   /admin/fraud/duplicates/:cluster_id/action
GET    /admin/fraud/referrals
POST   /admin/fraud/referrals/:referrer_id/reverse
POST   /admin/fraud/flag-user

# ── AI Provider Monitoring ─────────────────────────────
GET    /admin/ai/health
GET    /admin/ai/usage
GET    /admin/ai/errors
POST   /admin/ai/:provider/reset-circuit

# ── System Configuration ───────────────────────────────
GET    /admin/config
POST   /admin/config
PUT    /admin/config/:key
DELETE /admin/config/:key
GET    /admin/config/:key/history

# ── Audit Logs ─────────────────────────────────────────
GET    /admin/logs
POST   /admin/logs  # Internal: log admin actions
```

### Authentication Flow

**Admin Login:**
```
POST /api/v1/auth/admin/login
{
  "email": "admin@pagepay.com",
  "password": "secure_password"
}

Response:
{
  "access_token": "eyJ...",
  "token_type": "bearer",
  "role": "super_admin",
  "permissions": ["*"]
}
```

**Store token:**
- localStorage: `admin_token`
- Axios interceptor adds `Authorization: Bearer <token>`

**Permission Check (Backend Middleware):**
```python
async def require_permission(permission: str):
    # Extract JWT from Authorization header
    # Verify role + permissions
    # Log action to admin_audit_log
    pass

# Usage
@router.post("/admin/users/{user_id}/ban", dependencies=[Depends(require_permission("users.ban"))])
async def ban_user(user_id: int): ...
```

---

## Frontend Architecture

### Routing (React Router v7)

```tsx
// src/main.tsx
import { RouterProvider, createBrowserRouter } from 'react-router-dom';

const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: <RootLayout />,  // Sidebar + Header wrapper
    children: [
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'users', element: <UsersPage /> },
      { path: 'users/:id', element: <UserDetailPage /> },
      { path: 'finance/revenue', element: <RevenuePage /> },
      { path: 'finance/payouts', element: <PayoutsPage /> },
      // ... etc
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>
);
```

### State Management

**Zustand (Client State):**
```tsx
// src/features/auth/store/auth-store.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  role: 'super_admin' | 'finance' | 'moderator' | 'support' | null;
  permissions: string[];
  setAuth: (token: string, role: string, permissions: string[]) => void;
  logout: () => void;
  hasPermission: (perm: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      role: null,
      permissions: [],
      setAuth: (token, role, permissions) => set({ token, role, permissions }),
      logout: () => {
        set({ token: null, role: null, permissions: [] });
        localStorage.removeItem('admin_token');
      },
      hasPermission: (perm) => {
        const { permissions, role } = get();
        if (role === 'super_admin') return true;
        return permissions.includes(perm) || permissions.includes('*');
      },
    }),
    { name: 'admin_auth' }
  )
);
```

**TanStack Query (Server State):**
```tsx
// src/features/users/hooks/use-users.ts
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/shared/api/client';

interface UsersFilters {
  page?: number;
  limit?: number;
  tier?: string;
  status?: string;
  search?: string;
}

export function useUsers(filters: UsersFilters) {
  return useQuery({
    queryKey: ['admin', 'users', filters],
    queryFn: async () => {
      const { data } = await adminApi.get('/admin/users', { params: filters });
      return data;
    },
    staleTime: 30_000,  // 30 seconds
    refetchInterval: 60_000,  // Auto-refetch every 60s
  });
}

// src/features/users/hooks/use-ban-user.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';

export function useBanUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: number) => {
      const { data } = await adminApi.post(`/admin/users/${userId}/ban`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast.success('User banned successfully');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to ban user');
    },
  });
}
```

### API Client Setup

```tsx
// src/shared/api/client.ts
import axios from 'axios';
import { useAuthStore } from '@/features/auth/store/auth-store';

export const adminApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1',
  timeout: 30_000,
});

// Request interceptor: Add auth token
adminApi.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: Handle 401 (logout), errors
adminApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
```

---

## UI/UX Design System

### Color Palette (Tailwind Config)

```js
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        // PagePay brand colors
        primary: {
          DEFAULT: '#6C5CE7',  // Purple
          50: '#F5F3FF',
          100: '#EDE9FE',
          500: '#6C5CE7',
          600: '#5B4DC9',
          700: '#4A3EB0',
        },
        mint: {
          DEFAULT: '#00B894',  // Money green
          50: '#E6FAF5',
          500: '#00B894',
          600: '#009A7D',
        },
        // Semantic colors
        success: '#00B894',
        warning: '#FDCB6E',
        error: '#D63031',
        info: '#74B9FF',
      },
    },
  },
};
```

### Layout Components

**Sidebar:**
```tsx
// src/shared/components/Sidebar.tsx
import { LayoutDashboard, Users, DollarSign, FileText, Shield, Bot, Settings, FileCode } from 'lucide-react';

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard' },
  { icon: Users, label: 'Users', path: '/users' },
  {
    icon: DollarSign,
    label: 'Finance',
    children: [
      { label: 'Revenue', path: '/finance/revenue' },
      { label: 'Payouts', path: '/finance/payouts' },
      { label: 'Subscriptions', path: '/finance/subscriptions' },
    ],
  },
  { icon: FileText, label: 'Content', path: '/content/catalog' },
  { icon: Shield, label: 'Fraud Detection', path: '/fraud/dashboard' },
  { icon: Bot, label: 'AI Providers', path: '/ai/dashboard' },
  { icon: Settings, label: 'Config', path: '/config/settings' },
  { icon: FileCode, label: 'Audit Logs', path: '/logs' },
];

// Sticky sidebar, full height, dark bg with primary accent
// Collapsed on mobile (drawer), expanded on desktop
```

**Header:**
```tsx
// src/shared/components/Header.tsx
// Top bar: Page title | Search (global) | Notifications bell | Profile dropdown
// Profile dropdown: Role badge, logout button
```

### Component Library

**StatCard:**
```tsx
interface StatCardProps {
  label: string;
  value: string | number;
  change?: { value: number; trend: 'up' | 'down' };
  icon?: LucideIcon;
}

// Card with large number, optional trend indicator, icon
// Used on Dashboard and Revenue pages
```

**DataTable:**
```tsx
// Generic table with TanStack Table
// Features: Sort, filter, pagination, row selection, bulk actions
// Reused across Users, Payouts, Content, etc.
```

**Badge:**
```tsx
interface BadgeProps {
  variant: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  children: React.ReactNode;
}

// Pill-shaped badge for status indicators
// Free (gray), Premium (gold), Active (green), Banned (red)
```

**Modal:**
```tsx
// Overlay modal with backdrop blur
// Used for: Ban user, Adjust balance, Approve payout, etc.
// Close on ESC, click outside
```

---

## Security & Authentication

### Admin Roles & Permissions

```typescript
enum AdminRole {
  SUPER_ADMIN = 'super_admin',  // Full access
  FINANCE = 'finance',           // Revenue, payouts, subscriptions
  MODERATOR = 'moderator',       // Content moderation, community notes
  SUPPORT = 'support',           // Read-only: users, sessions, transactions
}
```

**Permission Matrix:**

| Feature | Super Admin | Finance | Moderator | Support |
|---------|-------------|---------|-----------|---------|
| Dashboard (view) | ✅ | ✅ | ✅ | ✅ |
| Users (view) | ✅ | ❌ | ❌ | ✅ (masked PII) |
| Users (ban) | ✅ | ❌ | ❌ | ❌ |
| Balance (adjust) | ✅ | ✅ | ❌ | ❌ |
| Revenue (view) | ✅ | ✅ | ❌ | ❌ |
| Payouts (approve) | ✅ | ✅ | ❌ | ❌ |
| Content (delete) | ✅ | ❌ | ✅ | ❌ |
| Community (moderate) | ✅ | ❌ | ✅ | ❌ |
| Fraud (review) | ✅ | ❌ | ❌ | ✅ (read-only) |
| AI (monitor) | ✅ | ❌ | ❌ | ✅ (read-only) |
| Config (edit) | ✅ | ❌ | ❌ | ❌ |
| Logs (view) | ✅ | ✅ | ✅ | ✅ |

**Frontend Permission Gate:**
```tsx
// src/shared/hooks/use-permissions.ts
export function usePermissions() {
  const { hasPermission } = useAuthStore();
  return { hasPermission };
}

// Usage in component
const { hasPermission } = usePermissions();

{hasPermission('users.ban') && (
  <button onClick={handleBan}>Ban User</button>
)}
```

### Session Management

- JWT expires after 8 hours
- Refresh token (optional, if we add refresh flow)
- Auto-logout on 401 response
- Activity tracking (last action timestamp)
- Warn user 5 minutes before expiry

---

## Data Flow Architecture

### Example: Ban User Flow

**User Action:**
1. Admin clicks "Ban" button on user row
2. `BanUserModal` opens (confirmation)
3. Admin confirms

**Frontend:**
```tsx
const { mutate: banUser, isPending } = useBanUser();

const handleBan = () => {
  banUser(userId, {
    onSuccess: () => {
      queryClient.invalidateQueries(['admin', 'users']);
      toast.success('User banned');
      closeModal();
    },
  });
};
```

**Backend:**
```python
@router.post("/admin/users/{user_id}/ban")
async def ban_user(
    user_id: int,
    reason: str,
    current_admin = Depends(require_permission("users.ban")),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    
    user.status = "banned"
    user.banned_at = datetime.utcnow()
    user.ban_reason = reason
    
    # Log to audit trail
    await log_admin_action(
        admin_id=current_admin.id,
        action="ban_user",
        target_type="user",
        target_id=user_id,
        changes={"status": {"from": "active", "to": "banned"}},
    )
    
    await db.commit()
    return {"success": True}
```

**State Update:**
- React Query invalidates `['admin', 'users']` cache
- Table re-fetches and shows updated status
- Toast notification confirms success

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1 - Days 1-5)

**Backend (3 days):**
- [ ] Create admin authentication model (`AdminUser` table)
- [ ] Implement `POST /api/v1/auth/admin/login` with JWT
- [ ] Add permission middleware (`require_permission`)
- [ ] Create `AdminAuditLog` model + logging helper
- [ ] Implement core user management endpoints:
  - `GET /admin/users`
  - `GET /admin/users/:id`
  - `POST /admin/users/:id/ban`
  - `POST /admin/users/:id/adjust-balance`
- [ ] Implement dashboard stats endpoints:
  - `GET /admin/dashboard/stats`
  - `GET /admin/revenue/chart`
  - `GET /admin/users/growth`

**Frontend (2 days):**
- [ ] Initialize Vite + React 19 project (`admin/`)
- [ ] Setup Tailwind CSS with PagePay theme
- [ ] Install dependencies (react-router-dom, tanstack/react-query, zustand, axios, lucide-react)
- [ ] Create project structure (routes, features, shared)
- [ ] Build auth store (Zustand)
- [ ] Build API client with interceptors
- [ ] Create login page + form
- [ ] Create root layout (Sidebar + Header)
- [ ] Build Dashboard page with stat cards

### Phase 2: User Management (Week 1 - Days 6-7, Week 2 - Days 1-2)

**Backend (2 days):**
- [ ] Extend user endpoints:
  - `GET /admin/users/:id/sessions`
  - `GET /admin/users/:id/transactions`
  - `GET /admin/users/:id/referrals`
  - `PATCH /admin/users/:id` (update tier, email, etc.)
  - `DELETE /admin/users/:id`
- [ ] Add pagination, filters, search logic
- [ ] Test with real data (seed 1000 users)

**Frontend (2 days):**
- [ ] Build Users list page with:
  - DataTable component (TanStack Table)
  - Search input (debounced)
  - Filter dropdowns (tier, status)
  - Pagination controls
- [ ] Build User detail page with tabs:
  - Overview, Sessions, Transactions, Referrals
- [ ] Build modals:
  - BanUserModal (with reason input)
  - AdjustBalanceModal (with amount input, reason)
- [ ] Create hooks: `useUsers`, `useUserDetail`, `useBanUser`, `useAdjustBalance`

---

### Phase 3: Financial Management (Week 2 - Days 3-5)

**Backend (2 days):**
- [ ] Implement revenue endpoints:
  - `GET /admin/revenue/summary`
  - `GET /admin/revenue/ads` (breakdown by provider)
- [ ] Implement payout management endpoints:
  - `GET /admin/payouts`
  - `POST /admin/payouts/:id/approve`
  - `POST /admin/payouts/:id/reject`
- [ ] Implement subscription endpoints:
  - `GET /admin/subscriptions`
  - `POST /admin/subscriptions/:id/refund`
  - `PATCH /admin/subscriptions/:id/extend`

**Frontend (1 day):**
- [ ] Build Revenue dashboard page:
  - Stat cards (total, ad, premium, margin)
  - Charts (recharts): Revenue breakdown, Ad provider split
  - Date range picker
- [ ] Build Payouts page:
  - Table with filters (status, date)
  - Platform balance widget (with warning)
  - Approve/Reject modals
- [ ] Build Subscriptions page:
  - Table with tier filters
  - Refund/Extend modals
- [ ] Create hooks: `useRevenue`, `usePayouts`, `useSubscriptions`, `useApprovePayout`

---

### Phase 4: Content & Fraud (Week 2 - Day 6-7, Week 3 - Days 1-2)

**Backend (2 days):**
- [ ] Implement content management endpoints:
  - `GET /admin/content`
  - `DELETE /admin/content/:id`
  - `PATCH /admin/content/:id`
  - `GET /admin/content/import-history`
- [ ] Implement community moderation endpoints:
  - `GET /admin/community/notes?status=pending`
  - `POST /admin/community/notes/:id/approve`
  - `POST /admin/community/notes/:id/reject`
- [ ] Create `FraudFlag` model
- [ ] Implement fraud detection endpoints:
  - `GET /admin/fraud/sessions` (flag suspicious patterns)
  - `POST /admin/fraud/sessions/:id/review`
  - `GET /admin/fraud/duplicates`
  - `GET /admin/fraud/referrals`

**Frontend (2 days):**
- [ ] Build Content catalog page:
  - Table with filters (type, category, sponsored)
  - Delete/Edit modals
- [ ] Build Content import page:
  - Form (source, limit, page)
  - Recent imports table
- [ ] Build Moderation page:
  - Tabs (pending, approved, rejected)
  - Approve/Reject buttons
  - Full note preview modal
- [ ] Build Fraud dashboard:
  - Alert banner (high-severity count)
  - Tabs (sessions, duplicates, referrals)
  - Review modals
- [ ] Create hooks: `useContent`, `useCommunityNotes`, `useFraudSessions`

---

### Phase 5: AI & Config (Week 3 - Days 3-5)

**Backend (2 days):**
- [ ] Implement AI monitoring endpoints:
  - `GET /admin/ai/health`
  - `GET /admin/ai/usage`
  - `GET /admin/ai/errors`
  - `POST /admin/ai/:provider/reset-circuit`
- [ ] Implement config endpoints:
  - `GET /admin/config`
  - `POST /admin/config`
  - `PUT /admin/config/:key`
  - `DELETE /admin/config/:key`
  - `GET /admin/config/:key/history`

**Frontend (1 day):**
- [ ] Build AI dashboard:
  - Provider health cards (status, latency, circuit)
  - Usage chart (recharts)
  - Error log table
  - Reset circuit button
- [ ] Build Config settings page:
  - Tabs (app config, ad settings, point rates, fees)
  - Inline edit table
  - Add new config modal
- [ ] Create hooks: `useAIHealth`, `useConfig`, `useUpdateConfig`

---

### Phase 6: Audit Logs & Polish (Week 3 - Days 6-7)

**Backend (1 day):**
- [ ] Implement audit log endpoint:
  - `GET /admin/logs` (with filters, pagination)
- [ ] Review and test all admin endpoints
- [ ] Add rate limiting (100 req/min per admin)
- [ ] Add request/response logging
- [ ] Security audit (SQL injection, XSS, CSRF checks)

**Frontend (1 day):**
- [ ] Build Audit logs page:
  - Table with filters (admin, action, target type, date)
  - JSON diff viewer for changes
  - Export CSV button
- [ ] Polish UI:
  - Loading states (skeletons)
  - Error boundaries
  - Toast notifications (sonner)
  - Empty states (no data)
  - Mobile responsive tweaks
- [ ] Add global search in header
- [ ] Add notifications dropdown (fraud alerts, pending approvals)
- [ ] Create hook: `useAuditLogs`

---

## Testing Strategy

### Backend Testing
```bash
# Unit tests (pytest)
- Test permission middleware
- Test fraud detection logic
- Test admin action logging

# Integration tests
- Test full user ban flow (endpoint → DB → audit log)
- Test payout approval flow
- Test config update flow

# Load testing (locust)
- 100 concurrent admin users
- Dashboard endpoint performance
```

### Frontend Testing
```bash
# Unit tests (Vitest + React Testing Library)
- Test auth store (login, logout, permission check)
- Test hooks (useUsers, useBanUser)
- Test components (StatCard, DataTable, Badge)

# E2E tests (Playwright)
- Admin login flow
- Ban user flow
- Approve payout flow
- Config update flow

# Visual regression (Chromatic or Percy)
- Dashboard snapshot
- User list snapshot
- Modal snapshots
```

---

## Deployment Strategy

### Backend
- Deploy alongside existing FastAPI backend
- Same Docker container, same Railway/Render deployment
- Admin routes under `/api/v1/admin/*`
- No new infrastructure needed

### Frontend (Admin Dashboard)
- **Option 1: Vercel** (recommended)
  - Connect GitHub repo
  - Auto-deploy on push to `main`
  - Custom domain: `admin.pagepay.com`
  - Environment variables: `VITE_API_URL`

- **Option 2: Netlify**
  - Same as Vercel
  - Custom domain: `admin.pagepay.com`

- **Option 3: Same VPS as backend**
  - Build static files: `npm run build`
  - Nginx serves from `/var/www/admin`
  - Less convenient (manual deploys)

**Recommended:** Vercel (easiest, free tier, auto-deploy)

---

## Environment Variables

### Backend (.env)
```bash
# Existing
DATABASE_URL=mysql+asyncmy://...
JWT_SECRET_KEY=...
ADMIN_TOKEN=...  # Legacy, keep for backward compat

# New for admin system
ADMIN_JWT_SECRET=...  # Separate secret for admin tokens
ADMIN_JWT_EXPIRY=28800  # 8 hours in seconds
ADMIN_RATE_LIMIT=100  # Requests per minute
```

### Frontend (admin/.env.local)
```bash
VITE_API_URL=http://localhost:8000/api/v1
VITE_APP_NAME=PagePay Admin
VITE_VERSION=1.0.0
```

---

## Database Schema Additions

### 1. AdminUser Table
```python
class AdminUser(Base):
    __tablename__ = "admin_users"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(50))  # super_admin, finance, moderator, support
    permissions: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_login_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_by: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # Admin who created
```

### 2. AdminAuditLog Table
```python
class AdminAuditLog(Base):
    __tablename__ = "admin_audit_log"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    admin_id: Mapped[int | None] = mapped_column(BigInteger, index=True, nullable=True)
    admin_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(100), index=True)  # ban_user, adjust_balance, etc.
    target_type: Mapped[str] = mapped_column(String(50))  # user, content, payment, config
    target_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    changes: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON: {field: {from, to}}
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    result: Mapped[str] = mapped_column(String(20), default="success")  # success, failed
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
```

### 3. FraudFlag Table
```python
class FraudFlag(Base):
    __tablename__ = "fraud_flags"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    flag_type: Mapped[str] = mapped_column(String(50), index=True)  # suspicious_session, referral_abuse, etc.
    severity: Mapped[str] = mapped_column(String(20))  # low, medium, high
    details: Mapped[str] = mapped_column(Text)  # JSON
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)  # pending, reviewed, resolved
    reviewed_by: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

### 4. ContentImportLog Table
```python
class ContentImportLog(Base):
    __tablename__ = "content_import_log"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(50))  # gutenberg, gnews
    admin_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    count_imported: Mapped[int] = mapped_column(Integer, default=0)
    start_page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20))  # success, partial, failed
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
```

### 5. Update User Table
```python
# Add to existing User model
class User(Base):
    # ... existing fields ...
    
    # NEW FIELDS for admin management
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)  # active, banned, suspended
    banned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ban_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    banned_by: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # Admin user ID
```

---

## Migration Plan

```bash
# Create migration
cd backend
alembic revision --autogenerate -m "Add admin management tables"

# Review generated migration
# Manually adjust if needed (add indexes, foreign keys)

# Apply migration
alembic upgrade head

# Seed first admin user
python -c "
from app.models import AdminUser
from app.database import get_db
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=['bcrypt'])

async def seed():
    async for db in get_db():
        admin = AdminUser(
            email='admin@pagepay.com',
            password_hash=pwd_context.hash('changeme123'),
            role='super_admin',
            permissions=json.dumps(['*'])
        )
        db.add(admin)
        await db.commit()

import asyncio
asyncio.run(seed())
"
```

---

## Performance Considerations

### Backend Optimization
1. **Database Indexes:**
   - Index on `admin_audit_log.created_at` (most queries filter by date)
   - Composite index on `fraud_flags(status, severity)` (dashboard queries)
   - Index on `users.status` (filter banned users)

2. **Query Optimization:**
   - Use pagination on all list endpoints (limit 50 default, max 200)
   - Add `SELECT COUNT(*)` query for total count (separate from data query)
   - Use `asyncio.gather()` for parallel DB queries (dashboard stats)

3. **Caching:**
   - Cache dashboard stats for 60 seconds (Redis optional, in-memory dict OK)
   - Cache platform balance for 5 minutes (stale data acceptable)
   - Cache AI provider health for 30 seconds

### Frontend Optimization
1. **Code Splitting:**
   - Lazy load routes: `const UsersPage = lazy(() => import('./routes/users'))`
   - Split vendor chunks (React, recharts, etc.)

2. **React Query Config:**
   ```tsx
   const queryClient = new QueryClient({
     defaultOptions: {
       queries: {
         staleTime: 30_000,  // 30s
         refetchOnWindowFocus: false,
         retry: 1,
       },
     },
   });
   ```

3. **Virtual Scrolling:**
   - Use `@tanstack/react-virtual` for large tables (1000+ rows)
   - Only render visible rows

4. **Debounced Search:**
   - 300ms debounce on search inputs
   - Cancel pending requests on new input

---

## Security Checklist

### Backend
- [ ] Admin JWT uses separate secret from user JWT
- [ ] All admin endpoints require authentication
- [ ] Permission middleware validates role + permissions
- [ ] All mutations logged to `admin_audit_log`
- [ ] Rate limiting (100 req/min per admin)
- [ ] SQL injection protection (SQLAlchemy ORM)
- [ ] XSS protection (Pydantic validates inputs)
- [ ] CORS configured (only allow `admin.pagepay.com`)
- [ ] Sensitive fields masked in logs (passwords, tokens)
- [ ] Admin passwords hashed with bcrypt (cost factor 12)

### Frontend
- [ ] Token stored in localStorage (XSS risk acceptable for admin dashboard)
- [ ] Auto-logout on 401 response
- [ ] HTTPS only in production
- [ ] CSP headers configured
- [ ] Input validation (zod schemas)
- [ ] No inline scripts (CSP violation)
- [ ] Audit log tracks IP address (from `X-Forwarded-For` header)

### Infrastructure
- [ ] Admin dashboard on separate subdomain (`admin.pagepay.com`)
- [ ] Admin login rate-limited (5 attempts per 15 min per IP)
- [ ] Failed login attempts logged
- [ ] 2FA optional (future enhancement)
- [ ] Admin password rotation policy (90 days)

---

## Monitoring & Alerts

### Metrics to Track
1. **Admin Activity:**
   - Login attempts (success/failed)
   - Actions per admin per day
   - High-severity actions (ban, balance adjust)

2. **Platform Health:**
   - Pending payouts count (alert if > 100)
   - Paystack balance (alert if < ₦50,000)
   - Fraud flags count (alert if > 50 high-severity)
   - AI provider circuit breaker status (alert if 2+ open)

3. **Performance:**
   - Dashboard load time (p95 < 2s)
   - API response time (p95 < 500ms)
   - DB query time (p95 < 100ms)

### Alert Channels
- **Slack webhook:** Critical alerts (Paystack balance low, 100+ fraud flags)
- **Email:** Daily digest (yesterday's stats, pending actions)
- **Dashboard banner:** In-app alerts (pending payouts, expired admin sessions)

### Logging
```python
# backend/app/routers/admin.py
import logging

logger = logging.getLogger("admin")

@router.post("/admin/users/{user_id}/ban")
async def ban_user(...):
    logger.info(f"Admin {admin_email} banned user {user_id}, reason: {reason}")
    # ... action ...
```

---

## Documentation Requirements

### API Documentation (OpenAPI/Swagger)
- Auto-generated from FastAPI
- Accessible at `/api/v1/docs` (protected, requires admin token)
- All endpoints documented with:
  - Request/response schemas
  - Permission requirements
  - Example requests

### Admin User Guide
- **Location:** `docs/admin-guide.md` (in repo)
- **Sections:**
  - Getting started (login, navigation)
  - User management (ban, adjust balance)
  - Financial operations (approve payouts, refunds)
  - Content moderation (community notes)
  - Fraud detection (review flags)
  - System configuration (OTA config updates)

### Developer Guide
- **Location:** `docs/admin-dev.md`
- **Sections:**
  - Local setup (backend + frontend)
  - Adding new admin endpoints
  - Adding new admin roles/permissions
  - Testing strategy
  - Deployment process

---

## Future Enhancements (Post-MVP)

### Phase 7: Advanced Analytics (Month 2)
- [ ] Cohort analysis (retention by signup month)
- [ ] LTV (Lifetime Value) projections
- [ ] Churn prediction model
- [ ] A/B test results dashboard
- [ ] Custom report builder (drag-and-drop)

### Phase 8: Automation (Month 3)
- [ ] Auto-ban users with 3+ high-severity fraud flags
- [ ] Auto-approve payouts < ₦10,000 (if no fraud flags)
- [ ] Auto-reject community notes with profanity
- [ ] Scheduled reports (weekly revenue email)

### Phase 9: Mobile Admin App (Month 4)
- [ ] React Native admin app (reuse mobile codebase)
- [ ] Push notifications for critical alerts
- [ ] Quick actions (ban user, approve payout)
- [ ] Limited to super_admin role only

### Phase 10: Multi-Tenant (Month 6+)
- [ ] Support multiple PagePay instances (white-label)
- [ ] Tenant-scoped admin users
- [ ] Cross-tenant reporting

---

## Success Metrics

### Week 1 (Foundation)
- ✅ Admin can login
- ✅ Dashboard shows live stats
- ✅ Admin can view user list
- ✅ Admin can ban users

### Week 2 (User + Finance)
- ✅ Admin can view user detail with all tabs
- ✅ Admin can adjust user balance
- ✅ Admin can view revenue breakdown
- ✅ Admin can approve/reject payouts

### Week 3 (Content + Fraud + AI)
- ✅ Admin can moderate community notes
- ✅ Admin can review fraud flags
- ✅ Admin can monitor AI provider health
- ✅ Admin can edit system config
- ✅ All actions logged to audit trail

### Production Readiness
- [ ] Zero placeholder/mock data
- [ ] All endpoints return real DB data
- [ ] All mutations persist to DB
- [ ] All admin actions logged
- [ ] Rate limiting active
- [ ] HTTPS enforced
- [ ] Error boundaries catch crashes
- [ ] Loading states on all async operations
- [ ] Toast notifications on success/error
- [ ] Mobile responsive (tablet minimum)

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Admin account compromise | Critical | 2FA (future), strong passwords, audit logs |
| Accidental mass user ban | High | Confirmation modals, undo button (reverse ban), audit log |
| SQL injection | Critical | SQLAlchemy ORM (parameterized queries), input validation |
| Unauthorized access | Critical | JWT auth, permission middleware, CORS |
| Performance degradation | Medium | Pagination, caching, DB indexes, query optimization |
| Admin dashboard downtime | Medium | Deploy on Vercel (99.9% uptime), fallback to direct DB access |
| Fraud flag false positives | Medium | Manual review required, "Mark legitimate" action |
| Data leak in logs | High | Mask sensitive fields (passwords, tokens, full emails) |

---

## Appendix A: Sample Admin Permissions

### Super Admin (Full Access)
```json
["*"]
```

### Finance Team
```json
[
  "dashboard.view",
  "revenue.view",
  "payouts.view",
  "payouts.approve",
  "payouts.reject",
  "subscriptions.view",
  "subscriptions.refund",
  "logs.view"
]
```

### Moderator
```json
[
  "dashboard.view",
  "content.view",
  "content.delete",
  "community.view",
  "community.approve",
  "community.reject",
  "logs.view"
]
```

### Support Agent (Read-Only)
```json
[
  "dashboard.view",
  "users.view",
  "fraud.view",
  "logs.view"
]
```

---

## Appendix B: Key File Templates

### Frontend: Auth Store
```tsx
// admin/src/features/auth/store/auth-store.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AdminUser {
  id: number;
  email: string;
  role: 'super_admin' | 'finance' | 'moderator' | 'support';
  permissions: string[];
}

interface AuthState {
  token: string | null;
  user: AdminUser | null;
  setAuth: (token: string, user: AdminUser) => void;
  logout: () => void;
  hasPermission: (perm: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      
      setAuth: (token, user) => {
        set({ token, user });
      },
      
      logout: () => {
        set({ token: null, user: null });
        localStorage.removeItem('admin_token');
        window.location.href = '/login';
      },
      
      hasPermission: (perm) => {
        const { user } = get();
        if (!user) return false;
        if (user.role === 'super_admin') return true;
        return user.permissions.includes(perm) || user.permissions.includes('*');
      },
    }),
    { name: 'pagepay_admin_auth' }
  )
);
```

### Frontend: DataTable Component
```tsx
// admin/src/shared/components/DataTable.tsx
import { flexRender, useReactTable, getCoreRowModel } from '@tanstack/react-table';

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  isLoading?: boolean;
  pagination?: {
    page: number;
    totalPages: number;
    onPageChange: (page: number) => void;
  };
}

export function DataTable<T>({ data, columns, isLoading, pagination }: DataTableProps<T>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (isLoading) {
    return <TableSkeleton />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} className="px-4 py-3 text-left font-semibold">
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-t hover:bg-gray-50">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 py-3">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {pagination && <Pagination {...pagination} />}
    </div>
  );
}
```

### Backend: Admin Middleware
```python
# backend/app/routers/admin.py
from functools import wraps
from fastapi import Depends, HTTPException, Request, status
from app.database import get_db
from app.models import AdminUser, AdminAuditLog
import jwt

def require_permission(permission: str):
    """Dependency that checks admin permission and logs action."""
    
    async def permission_checker(
        request: Request,
        db: AsyncSession = Depends(get_db),
    ):
        # Extract token
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(401, "Missing or invalid token")
        
        token = auth_header.split(" ")[1]
        
        try:
            payload = jwt.decode(token, settings.admin_jwt_secret, algorithms=["HS256"])
            admin_id = payload.get("sub")
            role = payload.get("role")
            permissions = payload.get("permissions", [])
        except jwt.ExpiredSignatureError:
            raise HTTPException(401, "Token expired")
        except jwt.InvalidTokenError:
            raise HTTPException(401, "Invalid token")
        
        # Check permission
        if role != "super_admin" and permission not in permissions and "*" not in permissions:
            raise HTTPException(403, f"Missing permission: {permission}")
        
        # Fetch admin user
        admin = await db.get(AdminUser, admin_id)
        if not admin or not admin.is_active:
            raise HTTPException(403, "Admin account inactive")
        
        # Update last login
        admin.last_login_at = datetime.utcnow()
        admin.last_login_ip = request.client.host
        await db.commit()
        
        return admin
    
    return permission_checker


async def log_admin_action(
    admin: AdminUser,
    action: str,
    target_type: str,
    target_id: int | None,
    changes: dict,
    request: Request,
    db: AsyncSession,
    result: str = "success",
    error: str | None = None,
):
    """Log admin action to audit trail."""
    log = AdminAuditLog(
        admin_id=admin.id,
        admin_email=admin.email,
        action=action,
        target_type=target_type,
        target_id=target_id,
        changes=json.dumps(changes),
        ip_address=request.client.host,
        user_agent=request.headers.get("User-Agent"),
        result=result,
        error_message=error,
    )
    db.add(log)
    await db.commit()
```

---

## Appendix C: Initial Setup Checklist

### Backend Setup
- [ ] Install dependencies: `pip install pyjwt passlib[bcrypt]`
- [ ] Create database migration for new tables
- [ ] Seed first admin user
- [ ] Test admin login endpoint
- [ ] Test permission middleware
- [ ] Test audit logging

### Frontend Setup
- [ ] Create `admin/` directory
- [ ] Initialize Vite project: `npm create vite@latest admin -- --template react-ts`
- [ ] Install dependencies:
  ```bash
  npm install react-router-dom @tanstack/react-query @tanstack/react-table
  npm install zustand axios lucide-react recharts
  npm install sonner zod react-hook-form @hookform/resolvers
  npm install -D tailwindcss postcss autoprefixer
  npx tailwindcss init -p
  ```
- [ ] Configure Tailwind with PagePay theme
- [ ] Setup project structure (routes, features, shared)
- [ ] Create `.env.local` with API URL
- [ ] Test login flow
- [ ] Test API client with interceptors

### Deployment Setup
- [ ] Create `admin.pagepay.com` subdomain DNS record
- [ ] Connect GitHub repo to Vercel
- [ ] Configure environment variables on Vercel
- [ ] Configure CORS on backend (allow admin subdomain)
- [ ] Test production deployment

---

## Conclusion

This architecture provides a **complete, production-ready admin management system** for PagePay that:

✅ **Mirrors mobile app design** - Same colors, typography, design language  
✅ **Uses same tech stack** - React, Zustand, React Query, Tailwind  
✅ **Comprehensive feature set** - Users, finance, content, fraud, AI, config, logs  
✅ **Security-first** - JWT auth, permissions, rate limiting, audit logs  
✅ **Scalable** - Pagination, caching, indexes, virtual scrolling  
✅ **Observable** - Metrics, alerts, performance monitoring  
✅ **Production-ready** - No placeholders, full error handling, tested  

**Estimated timeline:** 3 weeks (15 working days)  
**Team size:** 1 full-stack developer (you + AI pair programming)  
**Deployment cost:** $0 (Vercel free tier, existing backend)

**Next step:** Begin Phase 1 (Foundation) - Backend admin auth + Frontend project setup.

---

**End of Architecture Document**
