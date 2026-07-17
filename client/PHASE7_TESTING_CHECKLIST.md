# Phase 7 Social Tasks - Testing Checklist

## 🧪 Frontend Testing Guide

### Prerequisites
- [ ] Backend server running on configured API URL
- [ ] Database migrated with Phase 7 tables
- [ ] Test user account created
- [ ] Cloudinary credentials configured in backend .env
- [ ] Gemini API key configured for AI verification

---

## Test 1: Task List Screen
**Path:** `/tasks` (Tasks tab)

- [ ] Screen loads without errors
- [ ] Tasks displayed in cards
- [ ] Pull-to-refresh works
- [ ] Platform icons show correctly for all platforms:
  - [ ] Twitter/X
  - [ ] Instagram
  - [ ] TikTok
  - [ ] YouTube
  - [ ] Facebook
  - [ ] LinkedIn
  - [ ] Website tasks
  - [ ] App tasks
- [ ] Net reward calculated correctly (85% of original)
- [ ] Remaining slots displayed
- [ ] Expiry date formatted properly
- [ ] Tapping task navigates to detail screen
- [ ] Stats icon navigates to worker profile
- [ ] Empty state shows when no tasks

---

## Test 2: Task Detail Screen
**Path:** `/tasks/[id]`

- [ ] Task detail loads correctly
- [ ] Back button works
- [ ] Task type and platform badges display
- [ ] Title and description shown
- [ ] Instructions section visible
- [ ] Target URL displayed (if present)
- [ ] Proof requirements section shows proof type
- [ ] Reward card displays net amount
- [ ] Stats grid shows:
  - [ ] Remaining slots
  - [ ] Time limit
  - [ ] Expiry date
- [ ] Requirements card shows level and approval rate
- [ ] Start button enabled for eligible tasks
- [ ] Start button disabled for full tasks
- [ ] Confirmation dialog appears on start
- [ ] Successfully creates submission
- [ ] Navigates to complete screen with submission_id

---

## Test 3: Task Completion Screen
**Path:** `/tasks/[id]/complete`

### Image Upload (Screenshot)
- [ ] "Choose from Gallery" button works
- [ ] Gallery permission requested
- [ ] Image picker opens
- [ ] Selected image shows confirmation
- [ ] "Take Photo" button works
- [ ] Camera permission requested
- [ ] Camera opens
- [ ] Captured photo shows confirmation
- [ ] Image can be removed and re-uploaded
- [ ] Base64 encoding includes data URI prefix

### URL Proof
- [ ] URL input field accepts text
- [ ] Placeholder text helpful
- [ ] URL saved with submission

### Text Proof
- [ ] Text area accepts multi-line input
- [ ] Placeholder text helpful
- [ ] Text saved with submission

### Submission
- [ ] Cannot submit without any proof
- [ ] Alert shows requiring proof
- [ ] Confirmation dialog before submit
- [ ] Loading indicator during submit
- [ ] Success alert on submission
- [ ] Navigates to submission history
- [ ] Error handling for failed submissions

---

## Test 4: Worker Profile Screen
**Path:** `/tasks/profile`

- [ ] Profile loads without errors
- [ ] Back button works
- [ ] Level badge displays current level
- [ ] XP progress bar shows correctly
- [ ] XP text shows current/total
- [ ] Stats cards display:
  - [ ] Tasks completed (green)
  - [ ] Approval rate % (purple)
  - [ ] Total earned in Naira (green)
  - [ ] Tasks rejected (red)
- [ ] Current streak displayed
- [ ] Longest streak displayed
- [ ] Badges section shows earned badges
- [ ] "View Submission History" button navigates
- [ ] "Browse Tasks" button navigates to tasks tab

---

## Test 5: Submission History Screen
**Path:** `/tasks/history`

- [ ] History loads without errors
- [ ] Back button works
- [ ] Filter pills displayed
- [ ] "All" filter shows all submissions
- [ ] "Pending" filter works
- [ ] "Validating" filter works
- [ ] "Approved" filter works
- [ ] "Rejected" filter works
- [ ] Pull-to-refresh works
- [ ] Submission cards show:
  - [ ] Task title
  - [ ] Task type and platform
  - [ ] Status badge with correct color/icon
  - [ ] Reward amount
  - [ ] Submission date/time
  - [ ] Verification date (if verified)
  - [ ] AI confidence score (if available)
  - [ ] Rejection reason (if rejected)
  - [ ] Proof preview section
- [ ] Screenshot indicator shown if uploaded
- [ ] URL shown if provided
- [ ] Text shown if provided
- [ ] Empty state for no submissions
- [ ] Empty state per filter

---

## Test 6: Navigation Flow

### Complete Task Flow
1. [ ] Start from Tasks tab
2. [ ] Tap a task card
3. [ ] Review task details
4. [ ] Tap "Start Task"
5. [ ] Confirm start
6. [ ] Navigate to complete screen
7. [ ] Upload proof
8. [ ] Submit task
9. [ ] Redirected to history
10. [ ] See submission in list

### Profile Flow
1. [ ] Tap stats icon on Tasks tab
2. [ ] View worker profile
3. [ ] Tap "View Submission History"
4. [ ] Review submissions
5. [ ] Use filter pills
6. [ ] Tap back to profile
7. [ ] Tap "Browse Tasks"
8. [ ] Return to Tasks tab

---

## Test 7: Error Scenarios

### Network Errors
- [ ] No internet - shows error message
- [ ] Slow network - shows loading state
- [ ] Failed request - shows retry option

### Permission Errors
- [ ] Camera denied - shows permission alert
- [ ] Gallery denied - shows permission alert
- [ ] Graceful handling without crash

### Validation Errors
- [ ] Empty proof submission - blocked with alert
- [ ] Invalid data - error message displayed
- [ ] Already submitted - proper error handling

### Edge Cases
- [ ] Task no longer available - error displayed
- [ ] Expired task - cannot start
- [ ] Full task - start button disabled
- [ ] Not eligible (level/rating) - error message

---

## Test 8: API Integration

### Authentication
- [ ] Token auto-attached to requests
- [ ] 401 response triggers logout
- [ ] Protected routes require auth

### Data Caching
- [ ] Tasks cached after first load
- [ ] Profile data cached
- [ ] History cached
- [ ] Cache invalidated after mutations

### Real-time Updates
- [ ] Task list updates after starting task
- [ ] Stats update after submission
- [ ] History shows new submissions
- [ ] Query refetch on screen focus

---

## Test 9: Performance

- [ ] Task list scrolls smoothly
- [ ] Images load without lag
- [ ] Large lists don't freeze UI
- [ ] Navigation transitions smooth
- [ ] No memory leaks on repeated navigation

---

## Test 10: UI/UX

### Visual Design
- [ ] Colors match brand (purple, green, red)
- [ ] Proper spacing and padding
- [ ] Card shadows render correctly
- [ ] Icons sized appropriately
- [ ] Text readable on all backgrounds

### Responsiveness
- [ ] Works on small phones (iPhone SE)
- [ ] Works on large phones (iPhone Pro Max)
- [ ] Works on tablets
- [ ] Landscape orientation (if supported)

### Feedback
- [ ] Loading indicators show during waits
- [ ] Success messages on completion
- [ ] Error messages are clear
- [ ] Buttons show pressed state
- [ ] Disabled states are obvious

---

## Test 11: Platform-Specific

### iOS
- [ ] Safe area insets respected
- [ ] Status bar style correct
- [ ] Haptic feedback (if implemented)
- [ ] Native modals work

### Android
- [ ] Material Design ripples
- [ ] Back button behavior correct
- [ ] Navigation gestures work
- [ ] Permissions work correctly

---

## Test 12: Accessibility

- [ ] Screen reader can read all text
- [ ] Buttons have accessible labels
- [ ] Images have alt text
- [ ] Touch targets large enough (44x44pt minimum)
- [ ] Color contrast sufficient

---

## 🐛 Bug Report Template

If you find issues, document:

```markdown
**Screen:** [Which screen]
**Action:** [What you did]
**Expected:** [What should happen]
**Actual:** [What actually happened]
**Error:** [Any error messages]
**Device:** [Phone model, OS version]
**Reproducible:** [Yes/No - Steps]
```

---

## ✅ Sign-Off

Once all tests pass:

- [ ] All screens tested
- [ ] All flows tested
- [ ] No critical bugs
- [ ] Performance acceptable
- [ ] UI polished
- [ ] Ready for production

**Tested By:** _______________
**Date:** _______________
**Build:** _______________
**Notes:** _______________
