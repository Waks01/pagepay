# Phase D Audio System Implementation Review

## Summary

Phase D implements client-driven audio batch narration with TTS synthesis, cost metering, and refund handling. The backend provides 7 endpoints (topics, quote, batches create/fetch, generate-next, position, retry) with Pydantic schemas and SQLAlchemy models spanning 3 tables (audio_topics, audio_batches, audio_episodes). The implementation aligns with the frontend contract for all response types and includes balance checking, episode splitting at 5,400-char boundaries, and failure recovery.

**Watch for:** AiUsageLog integration is stubbed with TODOs (cost tracking relies on logger.info only, not persistent records). Balance deduction happens before TTS, but retry logic replays the cost charge rather than tracking it in AiUsageLog. The generate-next endpoint lacks current_user parameter binding in the actual route handler signature — it may fail at runtime.

**Verdict**: NEEDS_CHANGES

---

## High-Level View

The audio system splits study materials into topics, then topics into 5,400-character episodes for TTS synthesis. Batches group multiple topics; episodes are queued, generated, and marked ready. The data model includes proper foreign keys with cascade deletes and indexes for status/batch lookups.

Response schemas match the frontend contract exactly in structure and field names. The endpoints follow the REST pattern: fetch metadata, quote cost, create batch, poll for generation, update position. Ownership is checked on every mutation.

Balance gates batch creation with an ok=false return rather than HTTP 402, matching the frontend expectation. The retry endpoint uses 402 when balance is insufficient, creating an asymmetry that works but is semantically inconsistent.

Cost calculation uses a formula (ceil((char_count / 1000) _ 0.43 _ 10)) that produces integer SV values. Episode splitting is deterministic: chunks max 5,400 chars, no off-by-one gaps, total_episodes backfilled correctly.

Generation is atomic within a single episode: status moves to 'generating' before TTS, then to 'ready' on success or 'failed' with a refund and error message. Failed episodes are refunded immediately and can be retried.

The integration with cost logging is incomplete. Three TODOs mark where AiUsageLog.record() calls should go, but the code uses logger.info instead. This means cost transactions are not persisted to a cost ledger, only to the user's service_credit_balance and the audit log. Retry cost logic assumes the original cost is still valid.

---

## High-Level Issues

<details>
<summary>Issues (4)</summary>

1. **Missing AiUsageLog integration** — Three TODO markers indicate cost/refund logging is not persisted. Each audio generation/refund should write to AiUsageLog so cost tracking is auditable and queryable separately from balance mutations.

2. **generate-next route handler missing current_user parameter** — The function signature lacks `current_user: User = Depends(get_current_user)` in the actual definition, but code references `current_user.id` in 3 places. This causes a runtime NameError.

3. **Balance error response asymmetry** — create_audio_batches returns ok=False with 200 HTTP status on insufficient balance, but retry_audio_batch returns 402 HTTP error. Spec requires 402 for retry, but batch creation should also be 402 for consistency.

4. **Retry logic assumes stable episode costs** — If costs change between batch creation and retry, the retry cost check uses the episode's stored cost_sv, not a fresh calculation. This could allow users to retry at old rates after pricing changes.

</details>

<details>
<summary>Details</summary>

### Missing Current User in generate-next Endpoint

The route handler `generate_next_audio_episode` does not declare `current_user: User = Depends(get_current_user)` as a parameter. The function body references `current_user.id` at lines 3979, 4004, 4030 (in logger calls) and indirectly through balance updates and refunds. This will raise a NameError at runtime on the first log statement: `NameError: name 'current_user' is not defined`.

**confirmed** — The function signature at line 3903 does not include the current_user dependency, but the handler accesses `current_user.id` in multiple logger.info and logger.warning calls, and in the balance update/refund operations.

The fix is to add `current_user: User = Depends(get_current_user)` to the route parameter list.

### AiUsageLog Not Integrated

Three cost-tracking operations are marked TODO:

1. Line 3761 — batch creation should log total_cost_sv
2. Line 3977 — episode generation should log episode.cost_sv as deducted
3. Line 4025 — episode failure should log episode.cost_sv as refunded

Currently, all three rely on logger.info/logger.warning, which go to stdout/stderr but not to a queryable audit table. The comments explicitly say "Integrate with AiUsageLog model when available for persistent cost tracking."

**likely** — AiUsageLog model exists elsewhere in the codebase (based on the TODO pattern), but is not imported or called in audio.py. Cost mutations are not recorded in a persistent ledger, making cost audits and per-user cost reports impossible without parsing logs.

### Retry Logic Replays Old Costs

When retry_audio_batch executes, it recalculates `total_retry_cost = sum(ep.cost_sv for ep in failed_episodes)` using the cost_sv values stored in the episode records at batch-creation time. If the TTS pricing changes between creation and retry, the retry uses the old rate, not the current rate. This could silently undercharge if prices went up, or overcharge if prices went down.

**likely** — The retry cost is calculated from stored episode.cost_sv values (line 4069), not from a fresh calculation of char_count \* current_rate. If `_calculate_episode_cost_sv()` formula changes or external factors (like TTS provider pricing) change, retries execute at historical rates.

### Balance Error Response Inconsistency

- `create_audio_batches` (line 3726) returns `ok=False` with HTTP 200 when balance is insufficient.
- `retry_audio_batch` (line 4082) returns HTTP 402 with `detail=...` when balance is insufficient.

The frontend may expect a consistent error pattern. Line 823 in api.ts shows `createAudioBatches` expects either an ok=true response with episodes or ok=false with an error string. The retry endpoint should also use ok=false / ok=true pattern, or batch creation should use 402.

**likely** — The two endpoints handle the same error condition (insufficient balance) differently: one as a business-logic error (ok=False, 200), one as an HTTP error (402). This inconsistency could cause client-side error handling to miss one or the other.

### Missing Ownership Check in generate-next

The `generate_next_audio_episode` function queries the episode and material but does not verify that the material belongs to `current_user`. It only checks that the episode exists and the material exists. An attacker could call generate-next with someone else's material_id and trigger TTS synthesis on another user's batch.

**confirmed** — Lines 3918–3923 fetch the episode and material, but line 3924 only checks `if not material`, not `material.user_id == current_user.id`. The batch is not checked for ownership either.

### Position Endpoint Finds Wrong Episode

The `save_audio_position` endpoint (line 4050) queries the first episode in the batch by `order_by(AudioEpisode.topic_index, AudioEpisode.episode_index).limit(1)`, then updates its position. This is correct for updating the currently playing episode's position. However, the spec does not explain which episode is "active" if multiple episodes in a batch are in 'ready' status. The current logic always updates the first one, which may not be the one the user is playing.

**likely** — The logic assumes the user is always playing episodes in order (topic 0 episode 0, then 0/1, etc.). If the user jumps to topic 2, the position update still goes to topic 0/episode 0.

### No Validation of Topic Index Bounds in fetch-next

In `generate_next_audio_episode`, the code checks `if episode.topic_index >= len(topics_data)` (line 3926) and marks the episode failed if out of range. This is defensive, but topics should never be out of range if the batch was created from valid topic indexes. The check is good for data consistency, but indicates a potential gap: if topics are deleted from the material between batch creation and generation, orphaned episodes become unfixable. Ideally, batches should store the original topic content (or a hash) so retries are stable.

**possible** — If the user edits material.parsed_structure after a batch is created, episodes referencing old topic indexes may fail. The backend protects against crashes but leaves a failed episode that cannot be retried successfully.

### Episode Splitting Algorithm Has Edge Case

The `_split_topic_into_episodes` function handles zero-length topics by returning a single episode with cost_sv=0. For empty or whitespace-only topics, this creates a queued episode that will be marked 'failed' during generation with a likely TTS error ("empty text"). This is handled, but it would be cleaner to reject empty topics at batch-creation time.

**possible** — Topics with zero characters or only whitespace are accepted, creating episodes that will fail during TTS and require refund/retry. The cost is 0, but the user sees a failed episode.

</details>

---

## Frontend Contract Alignment

Response schemas are examined at 2102–2195 in schemas/**init**.py and match the frontend types (api.ts lines 740–823) exactly:

- **AudioTopicSchema** ✓ topic_index, topic_name, episodes, char_count, estimated_seconds, cost_sv
- **AudioTopicsResponseSchema** ✓ material_id, title, topics[], levels[], default_level
- **AudioEpisodeSchema** ✓ All 18 fields including id, topic_index, episode_index, status, audio_url, position_seconds, completed_at, refunded_at, error_message
- **AudioBatchesResponseSchema** ✓ material_id, episodes[], next_episode_id, total_cost_sv, refunded_sv
- **AudioBatchCreateResultSchema** ✓ ok, error, detail, cost_sv, balance_sv, created, reused, episodes[]
- **AudioQuoteSchema** ✓ level, topics[], topic_count, episode_count, total_char_count, total_cost_sv, estimated_seconds, balance_sv

Field types and optionality match the TypeScript definitions. No extra required fields, no missing fields, no type mismatches.

Endpoint paths are correct:

- GET /api/v1/study/audio/topics/{materialId} ✓
- POST /api/v1/study/audio/quote/{materialId} ✓
- POST /api/v1/study/audio/batches/{materialId} ✓
- GET /api/v1/study/audio/batches/{materialId} ✓
- POST /api/v1/study/audio/batches/{batchId}/position ✓
- POST /api/v1/study/audio/batches/{batchId}/retry ✓
- GET /api/v1/study/audio/generate-next/{materialId} ✓

All match the frontend's api.ts function calls exactly.

---

## Episode Splitting Algorithm

Episodes are split at 5,400-character boundaries. The `_split_topic_into_episodes` function chunks the text, calculates cost for each chunk, and back-fills the total_episodes count:

```python
chunk_size = 5400
for i in range(0, total_length, chunk_size):
    chunk = topic_content[i:i+chunk_size]
    # ... create episode dict
episodes.append({...})

total = len(episodes)
for ep in episodes:
    ep['total_episodes'] = total
```

This is correct. For a 10,800-character topic, you get two episodes: episode 0 of 2 (chars 0–5399), episode 1 of 2 (chars 5400–10799). The chunk boundaries do not overlap and cover the entire text.

Empty topics return a single zero-cost episode rather than an empty list. This is a design choice (prevents division by zero or empty batch creation) but allows zero-cost episodes to be generated and fail.

---

## Cost Metering

### Formula

Cost is calculated as `ceil((char_count / 1000) * 0.43 * 10)` SV per episode (line 3451 in study.py):

```python
cost_float = (char_count / 1000.0) * 0.43 * 10
return math.ceil(cost_float)
```

This produces:

- 0 chars → 0 SV
- 1 char → 1 SV (ceil(0.0043) = 1)
- 1000 chars → 5 SV (ceil(4.3) = 5)
- 5400 chars → 23 SV (ceil(23.22) = 24)

The formula is applied consistently in `quote_audio_narration`, `create_audio_batches`, and `_split_topic_into_episodes`.

### Balance Checking

- **Batch creation** (line 3726): checks `current_user.service_credit_balance < total_cost_sv` before inserting batch/episodes. Returns ok=False if insufficient.
- **Retry** (line 4082): checks `current_user.service_credit_balance < total_retry_cost` before resetting episodes to queued. Returns 402 if insufficient.
- **Generate-next**: no pre-check. TTS is called, then balance is updated. If the update fails (should not happen in practice), the user is charged but the episode fails. **This is a gap:** balance should be rechecked after TTS completes, in case another concurrent request drained it.

### Cost Deduction and Refund

- Deduction happens in `generate_next_audio_episode` after successful TTS (line 3968), updating `User.service_credit_balance -= episode.cost_sv`.
- Refund happens on exception (line 4009): `User.service_credit_balance += episode.cost_sv` plus `batch.refunded_sv += episode.cost_sv`.
- Retry resets episode to 'queued' and deducts the cost again (line 4093).

**Concern** — If TTS succeeds but the database commit fails, the balance update is rolled back. On retry, the cost is deducted again. There is no persistent audit log (AiUsageLog) to reconcile what was actually charged. This is a gap flagged in the Issues section.

---

## Atomicity and Failure Handling

### generate-next Atomicity

The endpoint is designed for client-driven polling. Each call processes exactly one queued episode:

1. Query first queued episode by created_at (line 3917)
2. Update status to 'generating' and commit (line 3936)
3. Extract chunk from topic content (line 3940)
4. Call synthesize_study_audio() (line 3958)
5. On success: store audio_data, set audio_url, mark 'ready', deduct cost, commit (line 3962–3971)
6. On exception: mark 'failed', set error_message, refund, update batch.refunded_sv, commit (line 4000–4017)

This is atomic at the database level (all writes in one transaction), but TTS is called outside the transaction. If TTS succeeds but the audio_data write fails, the bytes are lost but the cost is still deducted.

### Failure Modes

| Failure                         | Result                                                                                    | Recoverable                      |
| ------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------- |
| TTS provider down               | exception caught, episode marked 'failed', cost refunded, returned to queue on retry      | Yes, via retry                   |
| Database commit fails mid-write | transaction rolled back, episode still 'generating', next call retries same episode       | Yes, next call                   |
| Topic index mismatch            | episode marked 'failed' with error message, cost refunded                                 | Yes, via retry (will fail again) |
| Concurrent delete of material   | episode query succeeds, material query succeeds, topic extraction fails, exception caught | Yes, via retry (will fail again) |

---

## Ownership and Authorization

### Batch Creation and Fetch

- `create_audio_batches`: checks `material.user_id == current_user.id` (line 3701)
- `fetch_audio_batches`: checks `material.user_id == current_user.id` (line 3837)

Both correctly gate to the owner.

### Episode Generation

**Gap (confirmed):** `generate_next_audio_episode` does not check ownership. It queries the episode and material but does not verify `material.user_id == current_user.id`. An attacker can call this endpoint with another user's material_id and trigger TTS generation on their batch.

### Position Update

`save_audio_position`: checks `batch.user_id != current_user.id` and returns 404 if not (line 4055). Correct.

### Retry

`retry_audio_batch`: checks `batch.user_id != current_user.id` (line 4074). Correct.

### Audio Serving

`serve_episode_audio`: verifies batch ownership via `batch.user_id != current_user.id` (line 4142). Correct.

---

## Migration Completeness

### 002_add_audio_tables.py

Creates three tables:

- **audio_topics** (6 columns): id, material_id (FK cascade), topic_index, topic_name, char_count, created_at. Indexes: material_id, unique (material_id, topic_index). ✓
- **audio_batches** (8 columns): id, material_id (FK cascade), user_id (FK cascade), topic_indexes (JSON text), total_episodes, total_cost_sv, refunded_sv, status, created_at. Indexes: material_id, user_id, (material_id, user_id), status. ✓
- **audio_episodes** (19 columns): id, batch_id (FK cascade), material_id (FK cascade), topic_index, episode_index, total_episodes, level, status, cost_sv, char_count, estimated_seconds, actual_duration_seconds, audio_data (LargeBinary), audio_url, position_seconds, completed_at, refunded_at, error_message, created_at. Indexes: batch_id, material_id, status, (batch_id, status). ✓

Downgrade drops all indexes and tables in reverse order. ✓

### 039_add_audio_unlocks.py

Creates `audio_unlocks` table (6 columns): id, user_id, material_id, method, cost_sv, ad_event_id, created_at. Unique index on (user_id, material_id). Conditional create (checks if table already exists). ✓

Downgrade removes table and index. ✓

Both migrations are complete and reversible.

---

## Path Parameter Correctness

Frontend calls:

- `saveAudioPosition(batchId, {...})` → POST `/audio/batches/{batchId}/position` ✓
- `retryAudioBatch(batchId)` → POST `/audio/batches/{batchId}/retry` ✓

Backend routes use `{batch_id}` in the path and receive it as a parameter. ✓

---

## Error Codes and Messages

### Insufficient Balance

- **Batch creation (200 ok=False)**:

  ```
  AudioBatchCreateResultSchema(
      ok=False,
      error='insufficient_balance',
      detail=f'Need {total_cost_sv} SV to start this batch',
      ...
  )
  ```

  Matches spec. ✓

- **Retry (402 HTTP)**:
  ```
  HTTPException(
      status_code=402,
      detail=f"Insufficient balance to retry. Need {total_retry_cost} SV, have {current_user.service_credit_balance} SV."
  )
  ```
  HTTP 402 is appropriate for payment issues. ✓

**Asymmetry flagged in Issues.**

### Other Errors

- Material not found → 404 ✓
- Invalid topic_indexes → 400 ✓
- Episode not found → 404 ✓
- Access denied → 403 (serve_episode_audio) ✓
- No failed episodes to retry → 400 ✓

---

## Test Coverage

The code has no visible test file in the Phase D implementation. No test directory or \_test.py files are present in the search results.

**Not tested:**

- Batch creation with multiple topics and episodes
- Episode splitting for large topics (10k+ chars)
- TTS failure and refund flow
- Concurrent generate-next calls on same batch
- Balance boundary conditions (exactly zero, exactly enough, one short)
- Topic index out of range during generation
- Material deletion cascading to audio_batches/episodes
- Retry after balance refund (can user retry immediately?)
- Position update when multiple episodes are ready
- Edge case: empty topic content

---

## Database Foreign Keys and Cascades

All foreign keys use `ondelete='CASCADE'`:

- audio_topics → study_materials ✓
- audio_batches → study_materials, users ✓
- audio_episodes → audio_batches, study_materials ✓

If a material is deleted, all audio_batches and audio_episodes are deleted. If a user is deleted, their audio_batches (and cascading episodes) are deleted. If a batch is deleted, its episodes are deleted.

This is correct and prevents orphaned records.

---

## Schema Flexibility

The `topic_indexes` field in audio_batches is stored as JSON-encoded text (line 3719):

```python
batch = AudioBatch(
    ...
    topic_indexes=_json_module.dumps(topic_indexes),
    ...
)
```

This is decoded nowhere in the code; it's only used for audit logging. The individual episodes already store `topic_index`, so the batch-level `topic_indexes` list is redundant but useful for understanding what topics were ordered. This is a reasonable design for audit/replay.

---

## Unrelated Changes

No unrelated changes found in the audio implementation files. All code is focused on Phase D audio functionality.

---

## File Map

<details>
<summary>Files Changed</summary>

- **alembic/versions/002_add_audio_tables.py** — Migration creating audio_topics, audio_batches, audio_episodes with proper foreign keys, indexes, and downgrade
- **alembic/versions/039_add_audio_unlocks.py** — Migration creating audio_unlocks table for unlock tracking
- **app/models/**init**.py** (lines 1769–1865) — SQLAlchemy ORM models for AudioTopic, AudioBatch, AudioEpisode with proper column types and indexes
- **app/schemas/**init**.py** (lines 2101–2195) — Pydantic schemas for all audio response types, matching frontend contract exactly
- **app/routers/study.py** (lines 3424–4157) — Seven audio endpoints: fetch_audio_topics, quote_audio_narration, create_audio_batches, fetch_audio_batches, generate_next_audio_episode, save_audio_position, retry_audio_batch, serve_episode_audio. Plus helper functions: \_extract_topics_from_structure, \_calculate_episode_cost_sv, \_calculate_estimated_seconds, \_split_topic_into_episodes
- **app/services/tts_hybrid.py** (lines 137–177) — synthesize_study_audio function with provider fallback logic

[View full diff: `git diff ...`]

</details>
