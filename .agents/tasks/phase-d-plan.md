# Phase D: Audio/Podcast Narration — Implementation Plan

> **Task:** Implement 7 audio endpoints for on-demand podcast narration of study materials.
> Plan authored: 2025-01-11 | Workflow: wf_20b0c84aaeafd4b5

---

## Audit Findings

### Backend Status
- **Audio endpoints:** None exist. No stubs in `app/routers/study.py`.
- **Audio models:** None exist. `AudioTopic`, `AudioBatch`, `AudioEpisode` tables not yet created.
- **Audio schemas:** None exist. No Pydantic types for audio request/response.
- **TTS service:** ✅ Exists. `app/services/tts_hybrid.py` provides `synthesize_study_audio(text, voice)` with fallback provider chain (NVIDIA → OpenRouter → Gemini → edge-tts). All return MP3 bytes cached at `{AUDIO_CACHE_DIR}/tts/{shard}/{key}.mp3`.
- **Cost logging:** ❌ Not implemented. No `AiUsageLog` model or cost-per-action logging infrastructure yet.

### Frontend Contract (Verified)
All types and endpoints from `page/src/features/study/api.ts` lines 750–960 are **exact specifications**. All endpoint paths, request bodies, response shapes, and EducationLevel enum MUST match verbatim.

### Alembic Migration Status
- Highest existing migration: `029_add_beneficiaries_table.py`
- Next migration to create: `030_audio_tables.py`

### Pricing & Cost Rules (from PRICING_AND_UNIT_ECONOMICS.md)
- **Narration cost to us:** ₦3.38 per episode (5,400 chars) → blended: ₦0.43/1,000 chars
- **Charge to user:** 76 SV per episode (₦7.60)
- **Margin:** 2.25× (healthy)
- **Estimated speech rate:** 15 chars/sec → `estimated_seconds = char_count / 15`
- **Episodes per topic:** Split topics >5,400 chars into multiple episodes
- **Cost per episode:** `ceil((char_count / 1,000) * 0.43 * 10)` SV, rounded up to nearest integer

---

## Database Schema

### Table: `audio_topics`
```sql
CREATE TABLE audio_topics (
  id SERIAL PRIMARY KEY,
  material_id INTEGER NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  topic_index INTEGER NOT NULL,
  topic_name VARCHAR(255) NOT NULL,
  char_count INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(material_id, topic_index),
  INDEX(material_id)
)
```

### Table: `audio_batches`
```sql
CREATE TABLE audio_batches (
  id SERIAL PRIMARY KEY,
  material_id INTEGER NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_indexes TEXT NOT NULL COMMENT 'JSON list [1,3,5]',
  total_episodes INTEGER NOT NULL,
  total_cost_sv INTEGER NOT NULL,
  refunded_sv INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'queued' COMMENT 'queued|generating|completed|expired',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX(material_id),
  INDEX(user_id),
  INDEX(material_id, user_id),
  INDEX(status)
)
```

### Table: `audio_episodes`
```sql
CREATE TABLE audio_episodes (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES audio_batches(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  topic_index INTEGER NOT NULL,
  episode_index INTEGER NOT NULL,
  total_episodes INTEGER NOT NULL,
  level VARCHAR(50) NOT NULL DEFAULT 'natural',
  status VARCHAR(20) NOT NULL DEFAULT 'queued' COMMENT 'queued|generating|ready|failed',
  cost_sv INTEGER NOT NULL,
  char_count INTEGER NOT NULL,
  estimated_seconds INTEGER NOT NULL,
  actual_duration_seconds INTEGER NULL,
  audio_data LONGBLOB NULL COMMENT 'MP3 bytes, nullable until generation completes',
  audio_url VARCHAR(512) NULL COMMENT 'Base64 data URI or external URL',
  position_seconds FLOAT NOT NULL DEFAULT 0.0,
  completed_at TIMESTAMP NULL,
  refunded_at TIMESTAMP NULL,
  error_message VARCHAR(512) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX(batch_id),
  INDEX(material_id),
  INDEX(status),
  INDEX(batch_id, status)
)
```

### Indexes
- `audio_topics(material_id)` — lookup all topics for a material
- `audio_batches(material_id, user_id)` — per-user batches for a material
- `audio_episodes(batch_id)` — all episodes in a batch
- `audio_episodes(batch_id, status)` — find next queued episode

---

## Cost Calculation Examples

### Example 1: 3,000-char topic
```
char_count = 3000
cost_sv = ceil((3000 / 1000) * 0.43 * 10) = ceil(12.9) = 13 SV
estimated_seconds = 3000 / 15 = 200 seconds
episodes = 1 (under 5,400 char limit)
```

### Example 2: 10,000-char topic (split into 2 episodes)
```
char_count = 10000
episodes = ceil(10000 / 5400) = 2
episode_1: 5400 chars → cost = ceil(23.22) = 24 SV, estimated = 360s
episode_2: 4600 chars → cost = ceil(19.76) = 20 SV, estimated = 307s
total_cost_sv = 44 SV
```

### Example 3: Batch with 3 topics (5,400 + 3,000 + 8,000 = 16,400 chars)
```
Episode totals:
  1. Topic 0, ep 1 of 1: 5400 chars, 46 SV
  2. Topic 1, ep 1 of 1: 3000 chars, 13 SV
  3. Topic 2, ep 1 of 2: 5400 chars, 46 SV
  4. Topic 2, ep 2 of 2: 2600 chars, 12 SV
total_episodes = 4
total_cost_sv = 117 SV
```

---

## Implementation Plan

### Phase 1: Database & Models

- [ ] **1. Create migration 030_audio_tables.py**
  - Define `audio_topics`, `audio_batches`, `audio_episodes` tables with exact schema above
  - Add indexes: (material_id), (batch_id), (batch_id, status), (material_id, user_id)
  - Idempotent: use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`
  - Files: `backend/alembic/versions/030_audio_tables.py`
  - Verify: `alembic upgrade head` completes without error; tables exist in DB

- [ ] **2. Create SQLAlchemy models for audio**
  - Define `AudioTopic`, `AudioBatch`, `AudioEpisode` ORM classes in `backend/app/models/__init__.py`
  - `AudioTopic` → material_id (FK cascade), topic_index, topic_name, char_count, created_at
  - `AudioBatch` → material_id (FK cascade), user_id (FK cascade), topic_indexes (JSON), total_episodes, total_cost_sv, refunded_sv, status, created_at
  - `AudioEpisode` → batch_id (FK cascade), material_id (FK cascade), topic_index, episode_index, total_episodes, level, status, cost_sv, char_count, estimated_seconds, actual_duration_seconds, audio_data (LargeBinary), audio_url, position_seconds, completed_at, refunded_at, error_message, created_at
  - Files: `backend/app/models/__init__.py`
  - Verify: `python -c "from app.models import AudioTopic, AudioBatch, AudioEpisode; print('OK')"` runs without error

- [ ] **3. Create Pydantic schemas for audio**
  - Define request/response schemas in `backend/app/schemas/__init__.py`:
    - `AudioTopic` → topic_index, topic_name, episodes, char_count, estimated_seconds, cost_sv
    - `AudioTopicsResponse` → material_id, title, topics[], levels[], default_level
    - `AudioQuote` → level, topics[], topic_count, episode_count, total_char_count, total_cost_sv, estimated_seconds, balance_sv
    - `AudioEpisode` (schema) → id, topic_index, episode_index, total_episodes, level, status, cost_sv, char_count, estimated_seconds, actual_duration_seconds, audio_url, position_seconds, completed_at, refunded_at, error_message, created_at
    - `AudioBatchesResponse` → material_id, episodes[], next_episode_id, total_cost_sv, refunded_sv
    - `AudioBatchCreatePayload` → topic_indexes[], level (optional)
    - `AudioBatchCreateResult` → ok, error?, detail?, cost_sv?, balance_sv?, created?, reused?, episodes?[]
    - `AudioPositionPayload` → position_seconds, completed (optional bool)
  - Files: `backend/app/schemas/__init__.py`
  - Verify: `python -c "from app.schemas import AudioTopicsResponse, AudioEpisode; print('OK')"` runs without error

---

### Phase 2: Backend Endpoints

- [ ] **4. Implement GET /api/v1/study/audio/topics/{materialId}**
  - Query `study_materials` by id, check user has access (or is admin)
  - Parse `parsed_structure` JSON → extract all topics
  - For each topic:
    - Create/update `audio_topics` row (upsert on material_id + topic_index)
    - Calculate topic char_count from content
  - Query all `audio_topics` for this material, sorted by topic_index
  - For each topic, split into episodes (max 5,400 chars each)
  - Build `AudioTopic[]` with episode count, total char_count, cost_sv per topic, estimated_seconds
  - Fetch education levels from `study_materials` table (enum)
  - Return `AudioTopicsResponse` with material_id, title, topics[], levels[], default_level
  - Error: 404 if material not found or user lacks access; 500 on DB error
  - Files: `backend/app/routers/study.py`
  - Verify: `curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/study/audio/topics/1` returns AudioTopicsResponse with topics list

- [ ] **5. Implement POST /api/v1/study/audio/quote/{materialId}**
  - Parse request body: `{ topic_indexes: [int], level?: EducationLevel }`
  - Validate: topic_indexes must be valid, sorted, not empty
  - Default level to material's default if not provided
  - For each topic_index:
    - Fetch `audio_topics` row (or 404)
    - Split into episodes, sum up cost_sv and char_count
  - Calculate:
    - `topic_count = len(topic_indexes)`
    - `episode_count = sum(ceil(topic.char_count / 5400))`
    - `total_char_count = sum(topic.char_count)`
    - `total_cost_sv = sum of all episode costs`
    - `estimated_seconds = total_char_count / 15`
    - `balance_sv = current_user.service_credit_balance`
  - Return `AudioQuote` with these fields
  - Error: 404 if any topic_index invalid; 400 if topic_indexes empty
  - Files: `backend/app/routers/study.py`
  - Verify: Quote returned with correct cost_sv and episode_count matching the topic splits

- [ ] **6. Implement POST /api/v1/study/audio/batches/{materialId}**
  - Parse request: `{ topic_indexes: [int], level?: EducationLevel }`
  - Validate same as quote endpoint
  - Check user's service_credit_balance ≥ total_cost_sv (required for initial charge)
  - Check for existing batch with same (material_id, user_id, topic_indexes, level):
    - If exists and status='completed': return existing episodes as `reused`
    - If exists and status='generating': return current episodes as `created` (in-progress)
    - If exists and status='queued': return error "already queued"
  - Create `audio_batches` row: material_id, user_id, topic_indexes (JSON), total_episodes, total_cost_sv, status='queued'
  - For each topic, create `audio_episodes`:
    - Split by 5,400 char chunks
    - For each episode: topic_index, episode_index, total_episodes (count per topic), level, status='queued', cost_sv, char_count, estimated_seconds
    - Do NOT charge yet (charge happens per episode on generation)
  - Return `AudioBatchCreateResult` with ok=true, cost_sv, balance_sv, created (count), episodes[]
  - Error: 402 if insufficient balance; 400 if invalid topic_indexes
  - Files: `backend/app/routers/study.py`
  - Verify: Batch created with episodes in 'queued' status; subsequent identical request returns reused episodes

- [ ] **7. Implement GET /api/v1/study/audio/batches/{materialId}**
  - Query `audio_batches` where material_id=materialId and user_id=current_user.id
  - If no batches, return empty list
  - For each batch (latest first), fetch all `audio_episodes` sorted by (topic_index, episode_index)
  - Fetch next queued episode (oldest first by created_at) across all batches
  - Return `AudioBatchesResponse` with material_id, episodes[], next_episode_id, total_cost_sv (sum), refunded_sv (sum)
  - Files: `backend/app/routers/study.py`
  - Verify: Batches returned with episodes sorted; next_episode_id matches oldest queued episode

- [ ] **8. Implement POST /api/v1/study/audio/generate-next/{materialId}**
  - Find oldest queued episode for this material (status='queued', ordered by created_at)
  - If none: return `{ processed: null, remaining: 0 }`
  - If found:
    - Update episode status='generating'
    - Fetch episode's topic text from `parsed_structure` (reconstruct or store as part of schema)
    - Slice text by episode_index range: `start = episode_index * 5400, end = (episode_index + 1) * 5400`
    - Call `synthesize_study_audio(text_slice, voice)` → (audio_bytes, provider)
    - On success:
      - Store audio_bytes in audio_episodes.audio_data
      - Set audio_url = "data:audio/mp3;base64,{base64(audio_bytes)}" (or external URL if preferred)
      - Update episode status='ready', actual_duration_seconds = len(audio_bytes) / (bitrate), completed_at = now
      - Charge user: `user.service_credit_balance -= episode.cost_sv`
      - Log cost via AiUsageLog (if implemented; otherwise skip)
      - Return `{ processed: episode.id, topic_index, episode_index, remaining: count_of_queued_after_this }`
    - On failure:
      - Update episode status='failed', error_message = "TTS synthesis failed"
      - Refund cost: `user.service_credit_balance += episode.cost_sv`, `audio_batches.refunded_sv += episode.cost_sv`
      - Set episode.refunded_at = now
      - Return `{ processed: episode.id, error: "generation_failed", refunded: true, remaining: count_queued }`
  - Error: 404 if material not found; 500 if TTS fails after retries
  - Files: `backend/app/routers/study.py`, `backend/app/services/audio_generation.py` (new service)
  - Verify: Episode marked 'ready' with audio_url set; user balance debited correctly; failed episodes marked 'failed' with refund

- [ ] **9. Implement POST /api/v1/study/audio/batches/{batchId}/position**
  - Path param: batchId (NOT materialId — client drives this with batch ID)
  - Parse body: `{ position_seconds: float, completed?: bool }`
  - Fetch `audio_batches` by id, validate user owns it
  - Find the episode in this batch (or fetch most recent episode in batch?)
    - If multiple episodes: update all of them? Or find the "current" one?
    - Spec unclear; assume: update all episodes' position_seconds to the same value (user paused playback)
  - If completed=true: set first episode's completed_at = now (user finished listening)
  - Return 204 No Content on success
  - Error: 404 if batch not found or user doesn't own it; 400 if invalid position
  - Files: `backend/app/routers/study.py`
  - Verify: position_seconds persists; subsequent fetch returns saved position

- [ ] **10. Implement POST /api/v1/study/audio/batches/{batchId}/retry**
  - Path param: batchId
  - Fetch `audio_batches` by id, validate user owns it
  - Find all episodes with status='failed'
  - For each failed episode: reset status='queued', clear error_message, clear refunded_at
  - Refund user: `user.service_credit_balance += sum(episode.cost_sv for failed episodes)`, `batch.refunded_sv -= refund_amount`
  - Return 204 No Content
  - Error: 404 if batch not found; 400 if no failed episodes
  - Files: `backend/app/routers/study.py`
  - Verify: Failed episodes reset to 'queued'; user balance restored

---

### Phase 3: Helper Services

- [ ] **11. Create audio_generation.py service**
  - `extract_topic_text(parsed_structure, topic_index) -> str` — pull topic content from parsed JSON
  - `split_topic_into_episodes(text) -> List[str]` — split by 5,400 char chunks
  - `calculate_episode_cost(char_count) -> int` — return SV cost, rounded up
  - `calculate_estimated_seconds(char_count) -> int` — return char_count / 15
  - Files: `backend/app/services/audio_generation.py`
  - Verify: Extract, split, cost calculation all match spec examples

- [ ] **12. Integrate cost logging (optional Phase 2)**
  - If AiUsageLog model exists: log each generation attempt with cost_usd = (char_count / 1000) * 0.43 / 1332.5 (FX)
  - If not: skip for now, add TODO comment
  - Files: `backend/app/routers/study.py` (in generate-next endpoint)
  - Verify: Cost log entries appear after generation

---

### Phase 4: Frontend Integration Validation

- [ ] **13. Verify frontend contract matches**
  - Check `page/src/features/study/api.ts` lines 750–960 for exact endpoint paths, request/response types
  - Confirm all 7 functions exist and match:
    - `fetchAudioTopics(materialId)`
    - `quoteAudioNarration(materialId, { topic_indexes, level? })`
    - `createAudioBatches(materialId, { topic_indexes, level? })`
    - `fetchAudioBatches(materialId)`
    - `generateNextAudioEpisode(materialId)`
    - `saveAudioPosition(batchId, { position_seconds, completed? })`
    - `retryAudioBatch(batchId)`
  - Files: No changes; verification only
  - Verify: All endpoint paths and signatures match frontend spec exactly

---

### Phase 5: Testing & Validation

- [ ] **14. Write unit tests for audio endpoints**
  - Test cost calculation edge cases (3,000 chars, 5,400 chars, 10,000 chars)
  - Test episode splitting (topic > 5,400 chars splits correctly)
  - Test balance check before batch creation (insufficient funds → 402 error)
  - Test batch deduplication (same topic_indexes returns reused episodes)
  - Test failed episode refund logic (cost restored to user)
  - Test quote endpoint (returns correct total cost and episode count)
  - Files: `backend/tests/test_study_audio.py` (new)
  - Verify: `pytest backend/tests/test_study_audio.py -v` passes all tests

- [ ] **15. Integration test: full audio workflow**
  - Create study material with parsed_structure
  - Call quote endpoint, validate cost
  - Create batch, validate episodes exist
  - Fetch batches, validate next_episode_id
  - Call generate-next, mock TTS response, validate audio_url set and status='ready'
  - Save position, fetch batch, validate position_seconds persisted
  - Call retry on failed episode, validate refund applied
  - Files: `backend/tests/test_study_audio_integration.py` (new)
  - Verify: Full workflow passes end-to-end

---

## Endpoint Reference

| Endpoint | Method | Path | Status |
|----------|--------|------|--------|
| Fetch topics | GET | `/api/v1/study/audio/topics/{materialId}` | `audio_topics`, `audio_batches` |
| Quote narration | POST | `/api/v1/study/audio/quote/{materialId}` | Calculate cost |
| Create batch | POST | `/api/v1/study/audio/batches/{materialId}` | Create batch + episodes |
| Fetch batches | GET | `/api/v1/study/audio/batches/{materialId}` | Fetch episodes |
| Generate next | POST | `/api/v1/study/audio/generate-next/{materialId}` | TTS + charge |
| Save position | POST | `/api/v1/study/audio/batches/{batchId}/position` | Persist playback state |
| Retry batch | POST | `/api/v1/study/audio/batches/{batchId}/retry` | Reset failed episodes |

---

## Error Cases & Responses

### 400 Bad Request
- Empty or invalid topic_indexes
- Invalid position_seconds (negative or exceeds duration)
- Malformed JSON body

### 402 Payment Required
- User's service_credit_balance < total_cost_sv before batch creation

### 404 Not Found
- Material not found
- Topic index out of range
- Batch not found
- Batch belongs to different user

### 500 Internal Server Error
- TTS synthesis fails after all provider retries
- Database connection error
- Parsing study material's parsed_structure fails

---

## Cost Impact & Billing Notes

### Per-Episode Cost to PagePay
- **Input (text embedding):** ₦0.0006/1k chars (GLM Flash)
- **Output (narration script):** ₦0.0119/1k chars (GLM Flash)
- **TTS (MeloTTS):** ₦0.11/min audio (~₦0.0004/char)
- **Total:** ₦0.43/1,000 chars = ₦3.38 per 5,400-char episode

### Revenue to PagePay
- **Charge user:** 76 SV per episode (₦7.60)
- **Margin:** 55% (2.25×)

### Who Pays
- **User pays:** Service credit (SV) at episode generation time (immediate debit)
- **Failed episodes:** SV refunded immediately, episode marked 'failed'

---

## Open Questions / Assumptions

1. **Topic text storage:** The spec assumes we can extract topic text from `parsed_structure` JSON. The current schema does not store raw topic text — only parsed topics. We reconstruct by slicing the text at episode boundaries.

2. **Audio URL format:** Should we return base64 data URIs (inline) or external S3/CDN URLs? Current plan uses base64; if external storage needed, add async file upload step.

3. **Audio persistence:** Should audio_data (MP3 bytes) be stored in DB (current plan) or only serve from cache? DB storage allows streaming but increases payload. Cache-only means regeneration on cache miss.

4. **Cost logging:** AiUsageLog model does not exist in current models. Assume it will be added or skip cost logging for Phase D.

5. **Batch deduplication logic:** Should identical batches reuse episodes or create new ones? Current plan: reuse if completed, allow new if expired. Verify this matches business intent.

6. **Position tracking per episode:** The `saveAudioPosition` endpoint receives a batchId. How do we know which episode the user is listening to? Assume: update all episodes in the batch to the same position, or return the "current" episode ID from the previous generate-next call.

---

## Dependency Order

1. **Critical path:** Migration 030 → Models → Schemas → Endpoints 4–10
2. **Parallel:** Unit tests (14) and service helpers (11–12) can start once schemas exist
3. **Integration tests (15)** only after all endpoints are live
4. **Frontend validation (13)** can happen immediately (no backend changes needed)

---

## Rollout Checklist

- [ ] Migration 030 runs and creates tables
- [ ] All 7 endpoints respond with correct status codes
- [ ] Cost calculation matches examples in spec
- [ ] Episode splitting handles all char counts correctly
- [ ] Balance checks prevent overspending
- [ ] Failed episodes refund correctly
- [ ] Next episode selection returns oldest queued
- [ ] Unit tests pass
- [ ] Integration test passes end-to-end
- [ ] Frontend can call all 7 endpoints without 5xx errors
