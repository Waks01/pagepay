# Study Feature Backend Rebuild Plan

**Date**: 2026-01-11  
**Gap Period**: ~3 months (backend partially deleted and recovered)  
**Scope**: Complete audit and gap analysis of Study feature (Phase 3 AI Exam Prep + subsequent phases)

---

## Executive Summary

The frontend calls **25+ API endpoints** related to study materials, assets, exams, chat, audio, and data sync. The backend provides:
- ✅ Material upload & listing (SOW parsing)
- ✅ Asset generation (MCQ, flashcard, essay, diagram, video)
- ✅ Asset unlock (points or ad-watch)
- ✅ Quiz completion tracking
- ✅ Chat with rate limiting
- ✅ Study sessions (start/end)
- ✅ TTS/audio narration
- ❌ **MISSING**: Exam mode (5 critical endpoints)
- ❌ **MISSING**: Page images (rendered PDF pages)
- ❌ **MISSING**: Figure extraction (diagram crops)
- ❌ **MISSING**: Audio batching (podcast episodes)
- ❌ **MISSING**: Study data sync (highlights/notes)
- ⚠️ **INCOMPLETE**: Some endpoints exist but lack full implementation

**Total Work**: ~15 endpoints to build/fix; 8+ DB tables to verify or create.

---

## Section 1: Frontend Endpoint Inventory

All endpoints called by the frontend study feature, grouped by functional area.

### Material Upload & Management

| Method | Path | Params | Response | Frontend File | Status |
|--------|------|--------|----------|---------------|--------|
| POST | `/api/v1/study/sow/upload` | `{text, exam_type?, education_level?}` | `{material_id, title, exam_type, parsed_structure}` | `features/study/api.ts` | ✅ EXISTS |
| POST | `/api/v1/study/sow/upload-image` | FormData: file, exam_type, education_level | `{job_id, status}` | `features/study/api.ts` | ✅ EXISTS |
| POST | `/api/v1/study/sow/upload-images` | FormData: files[], exam_type, education_level | `{job_id, status}` | `features/study/api.ts` | ❌ MISSING |
| POST | `/api/v1/study/sow/upload-document` | FormData: file, exam_type, selected_pages?, education_level | `{job_id, status}` | `features/study/api.ts` | ✅ EXISTS |
| POST | `/api/v1/study/sow/preview-pdf` | FormData: file, exam_type | `{pages: [{page, total, image}], total, truncated}` | `app/(app)/study/index.tsx` | ✅ EXISTS |
| GET | `/api/v1/study/sow/jobs/{job_id}` | - | `{job_id, status, material_id?, error?, progress?, stage?, updated_at}` | `features/study/api.ts` | ✅ EXISTS |
| GET | `/api/v1/study/materials` | `exam_type?` | `[{id, title, exam_type, asset_types[], created_at}]` | `features/study/api.ts` | ✅ EXISTS |
| GET | `/api/v1/study/materials/{id}` | - | `{id, title, exam_type, parsed_structure, assets[], content?, file_mime_type?, has_original_file?, education_level?, page_count?, figure_count?, created_at}` | `features/study/api.ts` | ✅ EXISTS |
| PATCH | `/api/v1/study/materials/{id}` | `{title?, exam_type?}` | `{...MaterialDetail}` | `features/study/api.ts` | ✅ EXISTS |
| DELETE | `/api/v1/study/materials/{id}` | - | 204 No Content | `features/study/api.ts` | ✅ EXISTS |

### Material Artifacts (Pages & Figures)

| Method | Path | Params | Response | Frontend File | Status |
|--------|------|--------|----------|---------------|--------|
| GET | `/api/v1/study/materials/{id}/page-images` | - | `[{page, image_url, width, height, is_scan}]` | `features/study/api.ts::fetchMaterialPages` | ❌ MISSING |
| GET | `/api/v1/study/materials/{id}/figures` | - | `[{figure_index, page, image_url, width, height, description?, caption?}]` | `features/study/api.ts::fetchMaterialFigures` | ❌ MISSING |
| GET | `/api/v1/study/materials/{id}/file` | - | Binary (original uploaded file) | `features/study/api.ts::fetchMaterial` (has_original_file check) | ⚠️ EXISTS (partial) |

### Asset Generation & Unlock

| Method | Path | Params | Response | Frontend File | Status |
|--------|------|--------|----------|---------------|--------|
| POST | `/api/v1/study/generate` | `{material_id, asset_type, count?, topic?, mode?, difficulty?, education_level?}` | `{assets: []}` | `features/study/api.ts` | ✅ EXISTS |
| POST | `/api/v1/study/unlock` | `{asset_id, method: "points"\|"ad"}` | `{unlocked, content, new_balance, method, points_spent}` | `features/study/api.ts` | ✅ EXISTS |
| POST | `/api/v1/study/examples/generate` | `{material_id, topic?, mode?, education_level?, subject_hints?}` | `{assets: []}` | `features/study/api.ts` | ✅ EXISTS |
| POST | `/api/v1/study/examples/check` | `{material_id, example_id, step_index?, user_answer, user_attempt?}` | `{correct, feedback, hint?, next_step_instruction?, show_answer}` | `features/study/api.ts` | ✅ EXISTS |

### Quiz & Bonus

| Method | Path | Params | Response | Frontend File | Status |
|--------|------|--------|----------|---------------|--------|
| POST | `/api/v1/study/quiz/complete` | `{asset_id, score}` | `{bonus_awarded, bonus_points, new_balance, message}` | `features/study/api.ts` | ✅ EXISTS |

### Exam Mode (CRITICAL - ALL MISSING)

| Method | Path | Params | Response | Frontend File | Status |
|--------|------|--------|----------|---------------|--------|
| POST | `/api/v1/study/exam/start` | `{material_id, exam_type}` | `{session_id, exam_type, total_questions, duration_seconds, expires_at, questions: [{id, question, options[], explanation?}]}` | `features/study/api.ts::startExam` | ❌ MISSING |
| GET | `/api/v1/study/exam/{sessionId}/questions` | - | `{session_id, status, expires_at, total_questions, questions: [...]}` | `features/study/api.ts::getExamQuestions` | ❌ MISSING |
| POST | `/api/v1/study/exam/{sessionId}/answer` | `{session_id, question_id, selected_answer}` | `{question_id, is_correct}` | `features/study/api.ts::submitExamAnswer` | ❌ MISSING |
| POST | `/api/v1/study/exam/{sessionId}/submit` | - | `{session_id, score, correct_count, wrong_count, total_questions, passed}` | `features/study/api.ts::submitExam` | ❌ MISSING |
| GET | `/api/v1/study/exam/history` | - | `[{id, exam_type, score?, correct_count, wrong_count, total_questions, started_at, submitted_at?, passed}]` | `features/study/api.ts::fetchExamHistory` | ❌ MISSING |
| GET | `/api/v1/study/exam/{sessionId}/result` | - | `{session_id, exam_type, score, correct_count, wrong_count, total_questions, passed, started_at, submitted_at?, questions: [{id, question, options[], correct_answer, selected_answer?, is_correct, explanation?}]}` | `features/study/api.ts::fetchExamResult` | ❌ MISSING |

### Chat (Study Tutor)

| Method | Path | Params | Response | Frontend File | Status |
|--------|------|--------|----------|---------------|--------|
| POST | `/api/v1/study/chat` | `{material_id, message, education_level?, difficulty?, language?, history?, pay_for_turn?}` | Text (streamed or single) | `features/study/api.ts::sendChatMessage` | ✅ EXISTS |

### Audio / Podcast Narration

| Method | Path | Params | Response | Frontend File | Status |
|--------|------|--------|----------|---------------|--------|
| GET | `/api/v1/study/audio/topics/{materialId}` | - | `{material_id, title, topics: [{topic_index, topic_name, episodes, char_count, estimated_seconds, cost_sv}], levels[], default_level}` | `features/study/api.ts::fetchAudioTopics` | ⚠️ STUB? |
| POST | `/api/v1/study/audio/quote/{materialId}` | `{topic_indexes[], level?}` | `{level, topics[], topic_count, episode_count, total_char_count, total_cost_sv, estimated_seconds, balance_sv}` | `features/study/api.ts::quoteAudioNarration` | ⚠️ STUB? |
| POST | `/api/v1/study/audio/batches/{materialId}` | `{topic_indexes[], level?}` | `{ok, error?, detail?, cost_sv?, balance_sv?, created?, reused?, episodes?: [...]}` | `features/study/api.ts::createAudioBatches` | ⚠️ STUB? |
| GET | `/api/v1/study/audio/batches/{materialId}` | - | `{material_id, episodes: [{id, topic_index, episode_index, total_episodes, level, status, cost_sv, char_count, estimated_seconds, actual_duration_seconds?, audio_url?, position_seconds, completed_at?, refunded_at?, error_message?, created_at?}], next_episode_id?, total_cost_sv, refunded_sv}` | `features/study/api.ts::fetchAudioBatches` | ⚠️ STUB? |
| POST | `/api/v1/study/audio/generate-next/{materialId}` | - | `{processed?, topic_index?, episode_index?, remaining, error?, refunded?}` | `features/study/api.ts::generateNextAudioEpisode` | ⚠️ STUB? |
| POST | `/api/v1/study/audio/batches/{batchId}/position` | `{position_seconds, completed?}` | 200 OK | `features/study/api.ts::saveAudioPosition` | ⚠️ STUB? |
| POST | `/api/v1/study/audio/batches/{batchId}/retry` | - | 200 OK | `features/study/api.ts::retryAudioBatch` | ⚠️ STUB? |

### Study Data Sync (Highlights & Notes)

| Method | Path | Params | Response | Frontend File | Status |
|--------|------|--------|----------|---------------|--------|
| GET | `/api/v1/content/users/me/study-data` | - | `{highlights: {unit_id: [{id, start, end, color, created_at?}]}, notes: {unit_id: {text, created_at, updated_at}}}` | `shared/api/studyData.ts::getStudyData` | ✅ EXISTS |
| PUT | `/api/v1/content/users/me/study-data` | `{highlights: {...}, notes: {...}}` | `{...StudyDataBlob}` | `shared/api/studyData.ts::putStudyData` | ✅ EXISTS |
| PATCH | `/api/v1/content/users/me/study-data/highlights/{unitId}` | `{entries: [...]}` | `{...StudyDataBlob}` | `shared/api/studyData.ts::patchHighlights` | ✅ EXISTS |
| PATCH | `/api/v1/content/users/me/study-data/notes/{unitId}` | `{text}` | `{...StudyDataBlob}` | `shared/api/studyData.ts::patchNote` | ✅ EXISTS |

### Study Progress & Sessions

| Method | Path | Params | Response | Frontend File | Status |
|--------|------|--------|----------|---------------|--------|
| POST | `/api/v1/study/progress` | `{material_id, unit_index?, bookmark?, progress_pct?}` | `{material_id, progress_pct, last_unit_index, bookmarked, updated_at}` | `features/study/api.ts` (no direct call) | ⚠️ STUB? |
| GET | `/api/v1/study/materials/{id}/progress` | - | `{material_id, overall_progress, per_unit: [{unit_index, progress_pct}]}` | `features/study/api.ts` (no direct call) | ⚠️ STUB? |
| POST | `/api/v1/study/session/start` | `{material_id}` | `{session_id, started_at}` | `features/study/api.ts` (no direct call) | ⚠️ STUB? |
| POST | `/api/v1/study/session/end` | `{session_id, duration_seconds?, notes?}` | `{session_id, ended_at}` | `features/study/api.ts` (no direct call) | ⚠️ STUB? |

### AI Routing (Cost Logging)

| Method | Path | Params | Response | Frontend File | Status |
|--------|------|--------|----------|---------------|--------|
| POST | `/api/v1/ai/route` | `{prompt, task_type?, max_tokens?}` | `{response, provider, model}` | `features/study/api.ts::routeAi` | ✅ EXISTS |

### Ad Revenue Logging

| Method | Path | Params | Response | Frontend File | Status |
|--------|------|--------|----------|---------------|--------|
| POST | `/api/v1/study/ads/revenue` | `{ad_type, revenue_usd, impressions?}` | 200 OK | `shared/lib/ads.ts` | ⚠️ STUB? |

---

## Section 2: Backend Endpoint Inventory

All endpoints currently implemented in `backend/app/routers/study.py` and `study_data.py`.

### Implemented Endpoints

| Method | Path | Status | DB Model | Impl Level |
|--------|------|--------|----------|-----------|
| POST | `/api/v1/study/sow/upload` | ✅ | `StudyMaterial` | Full |
| POST | `/api/v1/study/sow/upload-image` | ✅ | `StudyMaterial`, `SowUploadJob` | Full (with background worker) |
| POST | `/api/v1/study/sow/upload-document` | ✅ | `StudyMaterial`, `SowUploadJob` | Full (with background worker) |
| POST | `/api/v1/study/sow/preview-pdf` | ✅ | - | Full (inline rendering) |
| GET | `/api/v1/study/sow/jobs/{job_id}` | ✅ | `SowUploadJob` | Full |
| GET | `/api/v1/study/materials` | ✅ | `StudyMaterial`, `StudyAsset` | Full |
| GET | `/api/v1/study/materials/{id}` | ✅ | `StudyMaterial`, `StudyAsset`, `StudyTransaction` | Full |
| PATCH | `/api/v1/study/materials/{id}` | ✅ | `StudyMaterial` | Full |
| DELETE | `/api/v1/study/materials/{id}` | ✅ | `StudyMaterial` | Full |
| GET | `/api/v1/study/materials/{id}/export` | ✅ | `StudyMaterial` | Full (PDF, DOCX, TXT, image formats) |
| GET | `/api/v1/study/materials/{id}/file` | ✅ | `StudyMaterial` | Full |
| GET | `/api/v1/study/materials/{id}/pages` | ✅ | `StudyMaterial` | Full (PDF page rendering inline) |
| POST | `/api/v1/study/generate` | ✅ | `StudyAsset` | Partial (generates asset, no streaming) |
| POST | `/api/v1/study/unlock` | ✅ | `StudyTransaction`, `StudyAsset` | Full |
| POST | `/api/v1/study/examples/generate` | ✅ | `StudyAsset` | Partial |
| POST | `/api/v1/study/examples/check` | ✅ | `StudyAsset` | Partial |
| POST | `/api/v1/study/chat` | ✅ | - | Full (streaming, rate-limited) |
| POST | `/api/v1/study/quiz/complete` | ✅ | `StudyTransaction` | Full |
| POST | `/api/v1/study/progress` | ✅ | `StudyProgress` | Full |
| GET | `/api/v1/study/materials/{id}/progress` | ✅ | `StudyProgress` | Full |
| POST | `/api/v1/study/session/start` | ✅ | `ReadingSession` | Full |
| POST | `/api/v1/study/session/end` | ✅ | `ReadingSession` | Full |
| POST | `/api/v1/study/tts` | ✅ | - | Full (calls hybrid TTS service) |
| GET | `/api/v1/study/tts/audio/{filename}` | ✅ | - | Full (file serving) |

### Study Data Endpoints

| Method | Path | Status | DB Model | Impl Level |
|--------|------|--------|----------|-----------|
| GET | `/api/v1/content/users/me/study-data` | ✅ | `User.study_data` | Full |
| PUT | `/api/v1/content/users/me/study-data` | ✅ | `User.study_data` | Full |
| PATCH | `/api/v1/content/users/me/study-data/highlights/{uid}` | ✅ | `User.study_data` | Full |
| PATCH | `/api/v1/content/users/me/study-data/notes/{uid}` | ✅ | `User.study_data` | Full |

### Endpoints Stubbed/Incomplete

| Method | Path | Status | Issue |
|--------|------|--------|-------|
| POST | `/api/v1/study/sow/upload-images` (multi-image single request) | ❌ | NOT IMPLEMENTED |
| GET | `/api/v1/study/materials/{id}/page-images` | ❌ | NOT IMPLEMENTED (separate from /pages which renders inline) |
| GET | `/api/v1/study/materials/{id}/figures` | ❌ | NOT IMPLEMENTED (diagram extraction missing) |
| GET | `/api/v1/study/audio/topics/{materialId}` | ⚠️ | STUB (returns empty or error) |
| POST | `/api/v1/study/audio/quote/{materialId}` | ⚠️ | STUB |
| POST | `/api/v1/study/audio/batches/{materialId}` | ⚠️ | STUB |
| GET | `/api/v1/study/audio/batches/{materialId}` | ⚠️ | STUB |
| POST | `/api/v1/study/audio/generate-next/{materialId}` | ⚠️ | STUB |
| POST | `/api/v1/study/audio/batches/{batchId}/position` | ⚠️ | STUB |
| POST | `/api/v1/study/audio/batches/{batchId}/retry` | ⚠️ | STUB |
| POST | `/api/v1/study/exam/start` | ❌ | MISSING (5 exam endpoints gone) |
| GET | `/api/v1/study/exam/{sessionId}/questions` | ❌ | MISSING |
| POST | `/api/v1/study/exam/{sessionId}/answer` | ❌ | MISSING |
| POST | `/api/v1/study/exam/{sessionId}/submit` | ❌ | MISSING |
| GET | `/api/v1/study/exam/history` | ❌ | MISSING |
| GET | `/api/v1/study/exam/{sessionId}/result` | ❌ | MISSING |

---

## Section 3: Gap Analysis

### Critical Gaps (Blocks Frontend Functionality)

#### GAP-001: Exam Mode Completely Missing
- **Endpoints**: 6 endpoints for exam session management
- **Frontend Calls**: `startExam()`, `getExamQuestions()`, `submitExamAnswer()`, `submitExam()`, `fetchExamHistory()`, `fetchExamResult()`
- **Current State**: No backend implementation
- **Required**:
  - DB tables: `StudyExamSession`, `StudyExamQuestion`, `StudyExamAnswer` (or similar)
  - Endpoints to create/manage exam sessions
  - Exam question generation from material parsed structure
  - Answer validation and scoring
  - History tracking
- **Blocker**: Frontend exam screens cannot work without this

#### GAP-002: Page Images Endpoint Missing
- **Endpoint**: `GET /api/v1/study/materials/{id}/page-images`
- **Frontend Call**: `fetchMaterialPages()`
- **Expected Response**: Array of `{page, image_url, width, height, is_scan}`
- **Current State**: Backend has inline `/pages` endpoint that renders pages into base64 blobs; frontend expects separate CDN-hosted URLs
- **Required**:
  - Either: Store rendered page images in S3/R2 during upload
  - Or: Return base64-encoded PNG as `image_url` in the response (simpler, less scalable)
  - **Decision**: Return base64 data URIs in `image_url` field to avoid new storage infra

#### GAP-003: Figures (Diagram Extraction) Missing
- **Endpoint**: `GET /api/v1/study/materials/{id}/figures`
- **Frontend Call**: `fetchMaterialFigures()`
- **Expected Response**: Array of `{figure_index, page, image_url, width, height, description?, caption?}`
- **Current State**: No extraction or storage of diagram crops
- **Required**:
  - Diagram detection + cropping during SOW parsing
  - Storage of diagram images + metadata
  - DB table: `StudyFigure` (or expand `StudyAsset`)
  - **Decision**: Create `StudyFigure` table, extract during PDF/image processing, store crops in DB or S3

#### GAP-004: Multi-Image Upload (single request, multiple files)
- **Endpoint**: `POST /api/v1/study/sow/upload-images`
- **Frontend Call**: `uploadSowImages()` (used when user selects multiple photos)
- **Current State**: Not implemented; frontend falls back to single-image upload
- **Required**:
  - Accept array of files in FormData
  - Process all pages as one material
  - Extract text from each image in sequence
  - Merge into single material + parsed structure
  - **Decision**: Implement as simple wrapper around upload-image logic, process sequentially

#### GAP-005: Audio/Podcast System Incomplete
- **Endpoints**: 7 audio endpoints (topics, quote, batches, generate-next, position, retry)
- **Frontend Calls**: All audio generation and episode tracking
- **Current State**: Endpoints may stub; unclear if full implementation exists
- **Required**:
  - DB tables: `AudioEpisode`, `AudioBatch`, `AudioTopic` (or similar)
  - TTS integration (already has `tts` endpoint)
  - Cost tracking (per episode, per topic)
  - Batch generation with client-driven progress
  - Position tracking for playback resume
  - **Decision**: Verify existing implementation; rebuild if incomplete

---

### DB Schema Gaps

#### Missing Tables

| Table | Purpose | Reason | Priority |
|-------|---------|--------|----------|
| `StudyExamSession` | Exam session state | Exam endpoints need to store session data | CRITICAL |
| `StudyExamQuestion` | Questions for an exam | Exam questions need storage | CRITICAL |
| `StudyExamAnswer` | User answers during exam | Track user responses + scoring | CRITICAL |
| `StudyFigure` | Extracted diagrams from materials | Figure extraction endpoint needs storage | HIGH |
| `AudioEpisode` | Podcast episode metadata | Audio system needs episode tracking | HIGH |
| `AudioBatch` | Batch generation request | Audio system needs batch tracking | HIGH |
| `AudioTopic` | Topics within a material for narration | Audio system needs topic structure | MEDIUM |

#### Existing Tables (From Alembic Migrations)

- `StudyMaterial` — ✅ Exists (migration 016, 017, 041, 042)
- `StudyAsset` — ✅ Exists (implied in routers)
- `StudyProgress` — ✅ Exists (implied in routers)
- `StudyTransaction` — ✅ Exists (for unlock tracking)
- `SowUploadJob` — ✅ Exists (upload background job tracking)
- `ReadingSession` — ✅ Exists (session tracking)
- `User.study_data` — ✅ Exists (JSON blob for highlights/notes)

---

### Response Shape Gaps

#### Incomplete Field Population

| Endpoint | Field | Expected | Current | Gap |
|----------|-------|----------|---------|-----|
| `GET /materials/{id}` | `page_count` | Number of pages in material | Null | ⚠️ MISSING |
| `GET /materials/{id}` | `figure_count` | Number of extracted figures | Null | ⚠️ MISSING |
| `GET /materials/{id}` | `explanation_structure` | Teaching layer (rewritten for clarity) | Null | ⚠️ NOT IMPLEMENTED |
| `GET /materials/{id}` | `education_level` | Depth level (primary/secondary/tertiary/research) | Null | ⚠️ STORED BUT NOT RETURNED |
| `GET /page-images` | `image_url` | URL to CDN or data URI | No endpoint | ❌ MISSING |
| `GET /figures` | `image_url` | URL to CDN or data URI | No endpoint | ❌ MISSING |

---

## Section 4: DB Schema Changes Required

### New Tables

#### `StudyExamSession`
```sql
CREATE TABLE study_exam_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  material_id INTEGER NOT NULL,
  exam_type VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'in_progress',  -- in_progress, submitted, expired
  total_questions INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,
  score INTEGER NULL,
  correct_count INTEGER DEFAULT 0,
  wrong_count INTEGER DEFAULT 0,
  passed BOOLEAN NULL,
  started_at DATETIME DEFAULT NOW(),
  submitted_at DATETIME NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT NOW(),
  INDEX(user_id, material_id),
  INDEX(status, expires_at)
);
```

#### `StudyExamQuestion`
```sql
CREATE TABLE study_exam_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES study_exam_sessions(id),
  question_index INTEGER NOT NULL,
  question_text TEXT NOT NULL,
  options TEXT NOT NULL,  -- JSON array of strings
  correct_answer VARCHAR(500) NOT NULL,
  explanation TEXT NULL,
  created_at DATETIME DEFAULT NOW(),
  INDEX(session_id, question_index)
);
```

#### `StudyExamAnswer`
```sql
CREATE TABLE study_exam_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES study_exam_sessions(id),
  question_id INTEGER NOT NULL REFERENCES study_exam_questions(id),
  selected_answer VARCHAR(500) NULL,
  is_correct BOOLEAN NULL,
  created_at DATETIME DEFAULT NOW(),
  INDEX(session_id, question_id)
);
```

#### `StudyFigure`
```sql
CREATE TABLE study_figures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES study_materials(id),
  figure_index INTEGER NOT NULL,
  page_number INTEGER NOT NULL,
  image_data LONGBLOB NOT NULL,  -- PNG/JPEG bytes
  image_mime_type VARCHAR(50) DEFAULT 'image/png',
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  description TEXT NULL,
  caption TEXT NULL,
  created_at DATETIME DEFAULT NOW(),
  INDEX(material_id, figure_index)
);
```

#### `AudioEpisode` (if missing)
```sql
CREATE TABLE audio_episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES study_materials(id),
  topic_index INTEGER NOT NULL,
  episode_index INTEGER NOT NULL,
  total_episodes INTEGER NOT NULL,
  education_level VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'queued',  -- queued, generating, ready, failed
  cost_sv INTEGER NOT NULL,
  char_count INTEGER NOT NULL,
  estimated_seconds INTEGER NOT NULL,
  actual_duration_seconds INTEGER NULL,
  audio_url VARCHAR(500) NULL,
  audio_data LONGBLOB NULL,  -- If storing locally
  position_seconds INTEGER DEFAULT 0,
  completed_at DATETIME NULL,
  refunded_at DATETIME NULL,
  error_message TEXT NULL,
  created_at DATETIME DEFAULT NOW(),
  INDEX(material_id, topic_index, episode_index)
);
```

#### `AudioBatch` (if missing)
```sql
CREATE TABLE audio_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES study_materials(id),
  user_id INTEGER NOT NULL,
  education_level VARCHAR(20) NOT NULL,
  topic_indexes TEXT NOT NULL,  -- JSON array
  total_episodes INTEGER NOT NULL,
  completed_episodes INTEGER DEFAULT 0,
  total_cost_sv INTEGER NOT NULL,
  refunded_sv INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',  -- pending, in_progress, completed, failed
  created_at DATETIME DEFAULT NOW(),
  INDEX(material_id, user_id)
);
```

### Alembic Migration Files to Create

- `043_study_exam_schema.py` — Create exam tables
- `044_study_figures_schema.py` — Create figures table
- `045_audio_episodes_schema.py` — Create audio tables (if needed)
- `046_study_material_metadata.py` — Add `page_count`, `figure_count`, `explanation_structure` to `StudyMaterial`

---

## Section 5: Ordered Implementation List

### Phase A: Critical Exam System (BLOCKS UI)

| ID | Title | Files | Dependencies | Priority |
|----|-------|-------|--------------|----------|
| STUDY-001 | Create exam DB schema (3 tables) | `alembic/versions/043_*.py` | None | CRITICAL |
| STUDY-002 | Add exam schemas (Pydantic) | `app/schemas.py` | STUDY-001 |  CRITICAL |
| STUDY-003 | Implement `POST /exam/start` | `routers/study.py` | STUDY-002 | CRITICAL |
| STUDY-004 | Implement `GET /exam/{id}/questions` | `routers/study.py` | STUDY-003 | CRITICAL |
| STUDY-005 | Implement `POST /exam/{id}/answer` | `routers/study.py` | STUDY-003 | CRITICAL |
| STUDY-006 | Implement `POST /exam/{id}/submit` + scoring | `routers/study.py` | STUDY-005 | CRITICAL |
| STUDY-007 | Implement `GET /exam/history` | `routers/study.py` | STUDY-001 | CRITICAL |
| STUDY-008 | Implement `GET /exam/{id}/result` | `routers/study.py` | STUDY-006 | CRITICAL |

### Phase B: Material Artifacts (Pages & Figures)

| ID | Title | Files | Dependencies | Priority |
|----|-------|-------|--------------|----------|
| STUDY-009 | Create figures DB schema + migration | `alembic/versions/044_*.py` | None | HIGH |
| STUDY-010 | Implement figure extraction during PDF upload | `routers/study.py::_process_sow_document_job` | STUDY-009 | HIGH |
| STUDY-011 | Implement figure extraction during image upload | `routers/study.py::_process_sow_image_job` | STUDY-009 | HIGH |
| STUDY-012 | Implement `GET /materials/{id}/page-images` endpoint | `routers/study.py` | STUDY-009 | HIGH |
| STUDY-013 | Implement `GET /materials/{id}/figures` endpoint | `routers/study.py` | STUDY-009 | HIGH |
| STUDY-014 | Update `GET /materials/{id}` to include page_count + figure_count | `routers/study.py` | STUDY-012, STUDY-013 | HIGH |

### Phase C: Multi-Image Upload

| ID | Title | Files | Dependencies | Priority |
|----|-------|-------|--------------|----------|
| STUDY-015 | Implement `POST /sow/upload-images` | `routers/study.py` | None | MEDIUM |

### Phase D: Audio System (Podcast)

| ID | Title | Files | Dependencies | Priority |
|----|-------|-------|--------------|----------|
| STUDY-016 | Audit existing audio endpoints | `routers/study.py` | None | MEDIUM |
| STUDY-017 | Create audio DB schema if needed | `alembic/versions/045_*.py` | None | MEDIUM |
| STUDY-018 | Implement/fix `GET /audio/topics/{materialId}` | `routers/study.py` | STUDY-017 | MEDIUM |
| STUDY-019 | Implement/fix `POST /audio/quote/{materialId}` | `routers/study.py` | STUDY-017 | MEDIUM |
| STUDY-020 | Implement/fix `POST /audio/batches/{materialId}` | `routers/study.py` | STUDY-017 | MEDIUM |
| STUDY-021 | Implement/fix `GET /audio/batches/{materialId}` | `routers/study.py` | STUDY-017 | MEDIUM |
| STUDY-022 | Implement/fix `POST /audio/generate-next/{materialId}` | `routers/study.py` | STUDY-017 | MEDIUM |
| STUDY-023 | Implement/fix `POST /audio/batches/{batchId}/position` | `routers/study.py` | STUDY-017 | MEDIUM |
| STUDY-024 | Implement/fix `POST /audio/batches/{batchId}/retry` | `routers/study.py` | STUDY-017 | MEDIUM |

### Phase E: Polish & Completion

| ID | Title | Files | Dependencies | Priority |
|----|-------|-------|--------------|----------|
| STUDY-025 | Add page_count, figure_count metadata | `alembic/versions/046_*.py`, `routers/study.py` | STUDY-012, STUDY-013 | LOW |
| STUDY-026 | Implement explanation_structure (teaching layer) | `routers/study.py`, AI prompts | None | LOW |
| STUDY-027 | Run full integration tests + fix seams | `tests/study_*.py` | All phases | FINAL |

---

## Section 6: Restructuring Authorization

### Decomposition Analysis

This work **DOES decompose cleanly into independent phases**:

1. **Phase A: Exam System** — Self-contained; no cross-phase dependencies beyond DB schemas
2. **Phase B: Material Artifacts** — Independent; requires schema but not A
3. **Phase C: Multi-Image Upload** — Independent; orthogonal to A, B, D
4. **Phase D: Audio System** — Independent; has its own DB schema + endpoints
5. **Phase E: Polish** — Integrates all phases; runs full tests

Each phase:
- Has its own DB migrations
- Implements a coherent feature (exam = exam flow; audio = audio flow)
- Leaves the codebase buildable after each step
- Can be verified independently

**Recommendation**: Restructure into FEAT-001 through FEAT-005 per phases above, with a convergence loop for integration.

---

## Next Steps

1. **User confirms this audit is accurate** — any endpoints or details missing?
2. **User prioritizes phases** — exam first (blocks UI), then figures, then audio?
3. **Workflow restructures** into phase-based FEATs and runs coder loop with reviews

---

## Context for Implementation

- **Backend Stack**: FastAPI, SQLAlchemy async, PostgreSQL, Alembic migrations
- **Frontend Stack**: React Native + Expo, Tanstack Query, TypeScript
- **AI Integration**: Cloudflare Workers AI router (cost metered per call)
- **Storage**: Postgres for blobs, file bytes stored as LONGBLOB or separate table columns
- **Build**: `docker-compose up` for backend; `expo dev-client` for frontend
- **Testing**: pytest for backend; vitest/React Testing Library for frontend

