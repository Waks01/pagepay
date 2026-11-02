# Phase D Audio System Fixes — Implementation Plan

This plan addresses 7 findings from the Phase D audio system review: 2 high-priority security/runtime issues, 3 medium-priority design corrections, and 2 low-priority enhancements.

---

## HIGH-Priority Fixes

### HIGH-1: Add missing `current_user` parameter to `generate_next_audio_episode` endpoint
**Problem:** The route handler signature is missing `current_user: User = Depends(get_current_user)`, but the function body references `current_user.id` in three logger calls (line 3988, 3990, 4037) and in balance operations. This causes a `NameError` at runtime.

**Fix Location:** `backend/app/routers/study.py`, line 3903 (function signature)

**What to do:** 
Add the missing parameter to the function signature. The function already has `current_user: User = Depends(get_current_user)` in the decorator and should be in the parameter list. Verify the parameter is present and matches the pattern used in other endpoints (e.g., `create_audio_batches` at line 3656).

**Files:**
- `backend/app/routers/study.py` (line 3903–3905)

**Verify:** 
Run `python -m pytest backend/tests/ -k audio` (or the project's test command). The endpoint should no longer raise a NameError when called. If no test exists, manually test by calling `POST /api/v1/study/audio/generate-next/{material_id}` with a valid material_id; it should not error with "name 'current_user' is not defined".

---

### HIGH-2: Add ownership check in `generate_next_audio_episode` after material fetch
**Problem:** The endpoint fetches the material and checks that it exists, but does not verify that `material.user_id == current_user.id`. An attacker can call this endpoint for another user's material and trigger TTS generation on their batch, consuming their credits.

**Fix Location:** `backend/app/routers/study.py`, after line 3923 (where material is fetched)

**What to do:** 
After the existing `if not material:` check (line 3923), add:
```python
if material.user_id != current_user.id:
    raise HTTPException(status_code=403, detail="Access denied")
```
This check must happen before any AI or balance operations.

**Files:**
- `backend/app/routers/study.py` (lines 3918–3928)

**Verify:** 
Write a test that calls `generate-next` with material_id belonging to a different user. The endpoint should return 403 Unauthorized. Alternatively, manually test with two user accounts; the second user's call to the first user's material should fail with 403.

---

## MEDIUM-Priority Fixes

### MEDIUM-1: Replace TODO placeholders with real `AiUsageLog` inserts
**Problem:** Three TODO markers indicate cost/refund logging is not persisted to a database. The code uses `logger.info()` and `logger.warning()` only, which means cost transactions are not auditable or queryable separately from balance mutations.

**Fix Locations:** `backend/app/routers/study.py`
- Line 3761–3768: batch creation TODO (after batch and episodes are committed)
- Line 3986–3997: episode generation cost deduction (after cost is deducted)
- Line 4034–4043: episode refund (after cost is refunded)

**What to do:** 
Create or import an `AiUsageLog` model if it does not exist. Then replace each TODO with a real database insert. Each insert should capture:
- `operation` (str): `"audio_batch_created"`, `"audio_episode_generated"`, or `"audio_episode_refunded"`
- `model` (str): the TTS provider name (from `used_provider` for episode generation, or `"tts_synthesize"` for batches)
- `input_tokens` (int): character count (for audio, use char_count; for TTS it's text length)
- `cost_neurons` (float): the SV cost converted to Neurons (SV * 1000 / 11 to convert to Neurons, as per PRICING_AND_UNIT_ECONOMICS.md)
- `user_id` (UUID/int): `current_user.id`
- `timestamp` (auto): auto-set to `datetime.utcnow()`

Use async SQLAlchemy pattern: `db.add(log); await db.flush()` (do not commit yet, as the outer transaction handles that).

**Files:**
- `backend/app/models/__init__.py` (define or verify `AiUsageLog` model exists; if not, add it)
- `backend/app/routers/study.py` (lines 3761–3768, 3986–3997, 4034–4043)

**Verify:** 
Run `pytest backend/tests/ -k audio` or manually trigger batch creation, episode generation, and episode refund. Query the `AiUsageLog` table and confirm three rows appear with correct operation types, costs, and user_id. If no test framework exists, write a simple integration test.

---

### MEDIUM-2: Change balance error response in `create_audio_batches` from HTTP 200 to HTTP 402
**Problem:** `create_audio_batches` returns HTTP 200 with `ok=False` on insufficient balance (line 3715–3720), while `retry_audio_batch` returns HTTP 402 (line 4082). The inconsistency could confuse client-side error handling.

**Fix Location:** `backend/app/routers/study.py`, lines 3715–3720 (balance check in `create_audio_batches`)

**What to do:** 
Replace the balance check return with an `HTTPException`:
```python
if current_user.service_credit_balance < total_cost_sv:
    raise HTTPException(
        status_code=402,
        detail=f'Need {total_cost_sv} SV to start this batch'
    )
```
Remove the `AudioBatchCreateResultSchema` return with `ok=False`. This makes batch creation consistent with retry (both use 402 for insufficient balance).

**Note:** This is a breaking change for clients that parse HTTP 200 ok=False. Confirm with the frontend team that they expect 402 instead.

**Files:**
- `backend/app/routers/study.py` (lines 3715–3720)

**Verify:** 
Call `create_audio_batches` with a user account that has insufficient balance. The endpoint should return HTTP 402 instead of 200. Confirm the error detail message is clear.

---

### MEDIUM-3: Recalculate retry cost in `retry_audio_batch` instead of using stale episode costs
**Problem:** `retry_audio_batch` uses stored `episode.cost_sv` values from batch creation time. If TTS pricing changes, retries execute at historical rates instead of current rates.

**Fix Location:** `backend/app/routers/study.py`, line 4084 (cost calculation in `retry_audio_batch`)

**What to do:** 
Change the retry cost calculation from:
```python
total_retry_cost = sum(_calculate_episode_cost_sv(ep.char_count) for ep in failed_episodes)
```
to use the current rate formula. The formula is already `_calculate_episode_cost_sv(char_count)`, so confirm it's being used. 

**Also:** After recalculating cost, fetch the material and education level to apply the correct multiplier (PRIMARY=1.0, SECONDARY=1.5, TERTIARY=2.0, RESEARCH=2.5) if not already applied. Check if `_calculate_episode_cost_sv()` includes the multiplier or if a separate factor must be applied based on `episode.level`.

**Verify current formula:** Look at the implementation of `_calculate_episode_cost_sv()` (expected around line 3451 based on the review). Confirm it applies the education_level multiplier. If not, update the retry calculation to include it.

**Files:**
- `backend/app/routers/study.py` (line 4084, and helper function `_calculate_episode_cost_sv`)

**Verify:** 
Manually test: create a batch with education_level PRIMARY (1.0 multiplier), fail an episode, then change the TTS cost formula (or mock it), and retry. Confirm the retry cost is calculated using the new formula, not the original stored cost. If the multiplier is not applied, write a test that confirms SECONDARY multiplies cost by 1.5x vs PRIMARY.

---

## LOW-Priority Enhancements

### LOW-1: Fix position endpoint to track active episode correctly
**Problem:** `save_audio_position` (line 4050) always updates the first episode in the batch (sorted by topic_index, episode_index), not the currently playing episode. If the user jumps to a later episode, the position update still goes to the first one.

**Fix Location:** `backend/app/routers/study.py`, lines 4050–4086

**What to do:** 
The code already sets `batch.active_episode_id` in `generate_next_audio_episode` (line 3968). Enhance `save_audio_position` to accept `episode_id` in the request payload and update that specific episode if provided. If `episode_id` is not in the payload, fall back to `batch.active_episode_id` if set, then to the first episode.

Example payload:
```json
{
  "position_seconds": 45,
  "completed": false,
  "episode_id": 123
}
```

Update the logic:
```python
if 'episode_id' in payload:
    # Use the provided episode_id
    ep_result = await db.execute(
        select(AudioEpisode).where(AudioEpisode.id == payload['episode_id'])
    )
    episode = ep_result.scalar_one_or_none()
    if not episode or episode.batch_id != batch_id:
        raise HTTPException(status_code=404, detail="Episode not found")
elif batch.active_episode_id:
    # Use active_episode_id if set
    # ... existing code
else:
    # Fall back to first episode
    # ... existing code
```

**Files:**
- `backend/app/routers/study.py` (lines 4050–4086, function `save_audio_position`)

**Verify:** 
Test that calling `save_audio_position` with an explicit `episode_id` updates that episode, not the first one. Manually verify the position_seconds field is set on the correct episode.

---

### LOW-2: Add validation to reject empty topics at batch creation
**Problem:** Topics with zero or whitespace-only content are accepted and create episodes with cost_sv=0. These episodes fail during TTS synthesis and require refund/retry.

**Fix Location:** `backend/app/routers/study.py`, lines 3698–3711 (topic validation loop in `create_audio_batches`)

**What to do:** 
Add a validation check in the loop that processes `topic_indexes`. Before splitting a topic into episodes, check if the content is empty or whitespace-only. If so, raise an HTTP 422 error:
```python
for topic_index in topic_indexes:
    topic_item = topics_data[topic_index]
    topic_content = (
        topic_item.get('content') or
        topic_item.get('text') or
        topic_item.get('description') or
        ''
    )
    if isinstance(topic_item, str):
        topic_content = topic_item
    
    # NEW: Validate non-empty content
    if not topic_content or not topic_content.strip():
        raise HTTPException(
            status_code=422,
            detail=f"Topic index {topic_index} has empty content"
        )
    
    episodes = _split_topic_into_episodes(topic_content, topic_index)
    # ... rest of loop
```

**Files:**
- `backend/app/routers/study.py` (lines 3698–3711)

**Verify:** 
Call `create_audio_batches` with a topic that has empty or whitespace-only content. The endpoint should return HTTP 422 with a clear error message. Verify that batches with non-empty topics still create successfully.

---

## Summary of Changes by File

| File | Lines | Issue | Action |
|------|-------|-------|--------|
| `backend/app/routers/study.py` | 3903–3905 | HIGH-1: Missing `current_user` parameter | Add parameter to function signature |
| `backend/app/routers/study.py` | 3918–3928 | HIGH-2: Missing ownership check | Add `if material.user_id != current_user.id` check |
| `backend/app/routers/study.py` | 3761–3768 | MEDIUM-1a: Batch creation TODO | Replace TODO with `AiUsageLog` insert |
| `backend/app/routers/study.py` | 3986–3997 | MEDIUM-1b: Episode generation TODO | Replace TODO with `AiUsageLog` insert |
| `backend/app/routers/study.py` | 4034–4043 | MEDIUM-1c: Episode refund TODO | Replace TODO with `AiUsageLog` insert |
| `backend/app/routers/study.py` | 3715–3720 | MEDIUM-2: Balance error inconsistency | Change from HTTP 200 ok=False to HTTP 402 |
| `backend/app/routers/study.py` | 4084 | MEDIUM-3: Stale retry costs | Confirm using `_calculate_episode_cost_sv()` with current multiplier |
| `backend/app/routers/study.py` | 4050–4086 | LOW-1: Wrong episode position tracked | Accept `episode_id` in payload |
| `backend/app/routers/study.py` | 3698–3711 | LOW-2: Empty topic validation | Add validation check for non-empty content |
| `backend/app/models/__init__.py` | TBD | MEDIUM-1: `AiUsageLog` model | Create or verify model exists |
| `backend/app/ai/prompts.py` | Line ~490+ | VERIFY: Podcast narration prompts | Confirm `PODCAST_NARRATION_SYSTEM_*` exist (CONFIRMED: all 4 exist) |

---

## Testing Checklist

- [ ] HIGH-1: Endpoint does not raise NameError for `current_user`
- [ ] HIGH-2: Calling generate-next with another user's material returns 403
- [ ] MEDIUM-1: Three `AiUsageLog` rows created on batch creation, generation, and refund
- [ ] MEDIUM-2: `create_audio_batches` returns HTTP 402 on insufficient balance
- [ ] MEDIUM-3: Retry cost is recalculated with current rates, not stale costs
- [ ] LOW-1: `save_audio_position` with `episode_id` updates correct episode
- [ ] LOW-2: Empty topic content is rejected with HTTP 422

---

## Notes

- **Cloudflare Workers AI Migration:** The requirements mention a future migration to Cloudflare Workers AI, but that work is OUT OF SCOPE for this fix phase. This plan focuses only on the audio system issues identified in the Phase D review.
- **AiUsageLog Model:** If the model does not exist, it must be created in `backend/app/models/__init__.py` before the coding step can proceed. Confirm its structure matches the requirements.
- **Backward Compatibility:** MEDIUM-2 (HTTP 402 instead of 200) is a breaking change. Coordinate with the frontend team before implementing.

