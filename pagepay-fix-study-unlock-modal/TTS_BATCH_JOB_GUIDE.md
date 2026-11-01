# TTS Batch Job Guide

**Quick reference for generating audio for the OpenStax curriculum**

---

## Prerequisites

1. Backend is deployed and running
2. `edge-tts==6.1.18` is installed (already in requirements.txt)
3. Admin auth token is configured (`X-Admin-Token` header)
4. Disk space available: ~1-2GB for 800 audio files

---

## Option 1: Generate ALL Audio (One-Time Job)

**Endpoint:** `POST /admin/content/tts/generate-all`

**Headers:**
```
X-Admin-Token: <your-admin-token>
```

**Query params:**
- `force=false` (default) — Skip existing files
- `force=true` — Regenerate all files

**Expected runtime:** 1-2 hours for ~800 units

**Example (curl):**
```bash
curl -X POST "https://api.pagepay.ng/api/v1/admin/content/tts/generate-all?force=false" \
  -H "X-Admin-Token: your-token-here"
```

**Response:**
```json
{
  "total_units": 827
}
```

---

## Option 2: Generate Audio for Single Work

**Endpoint:** `POST /admin/content/tts/generate-work/{work_id}`

**Use case:** Generate audio for a single book (e.g., after adding new content)

**Expected runtime:** 5-10 minutes per work (depends on book size)

**Example (University Physics Vol 1, work_id=42):**
```bash
curl -X POST "https://api.pagepay.ng/api/v1/admin/content/tts/generate-work/42?force=false" \
  -H "X-Admin-Token: your-token-here"
```

**Response:**
```json
{
  "units_processed": 63
}
```

---

## How to Find Work IDs

**SQL query:**
```sql
SELECT id, title, content_type 
FROM content_catalog 
WHERE parent_work_id IS NULL 
  AND source = 'openstax'
ORDER BY title;
```

**Or via API:**
```bash
curl "https://api.pagepay.ng/api/v1/admin/content?content_type=book&source=openstax" \
  -H "X-Admin-Token: your-token-here"
```

---

## Monitoring Progress

### Check Generated Files
```bash
# On server
ls -lh var/audio_cache/units/*/
```

### Check Logs
Look for these log lines:
```
INFO: Generating TTS audio: unit 123 (4521 chars)
INFO: TTS audio generated: unit 123 -> var/audio_cache/units/23/123.mp3 (543210 bytes)
```

### Test Audio Endpoint
```bash
# Should return 200 with audio/mpeg
curl -I "https://api.pagepay.ng/api/v1/content/audio/123.mp3"

# Should return 404 if not generated yet
curl -I "https://api.pagepay.ng/api/v1/content/audio/999999.mp3"
```

---

## Troubleshooting

### Job Takes Too Long
**Cause:** Concurrency too low (default=5)  
**Fix:** Concurrency is hardcoded in the service. To increase, edit `app/services/tts.py` and change `concurrency=5` to `concurrency=10`  
**Caution:** Higher concurrency may trigger edge-tts rate limits

### Audio Quality Issues
**Cause:** Voice mispronouncing technical terms  
**Fix:** Edit `app/services/tts.py` and change `DEFAULT_VOICE = "en-US-AriaNeural"` to another voice:
- `en-US-JennyNeural` — Female, clear
- `en-US-GuyNeural` — Male, warm
- `en-GB-SoniaNeural` — British accent

Then rerun with `?force=true` to regenerate.

### Disk Space Full
**Cause:** 800 MP3 files × ~500KB each = ~400MB (less than expected)  
**Fix:** Clean up old files if needed:
```bash
rm -rf var/audio_cache/units/*
```

Then rerun the batch job.

### Audio File Exists But 404
**Cause:** File permissions or path mismatch  
**Check:**
```bash
# Verify file exists
ls -lh var/audio_cache/units/23/123.mp3

# Verify path logic matches
# Shard = unit_id % 100 (two digits)
# Unit 123 → shard 23 → units/23/123.mp3
```

---

## After Batch Job Completes

### 1. Verify Sample Audio Files
Test a few units manually:
```bash
curl "https://api.pagepay.ng/api/v1/content/audio/1.mp3" -o test-1.mp3
curl "https://api.pagepay.ng/api/v1/content/audio/100.mp3" -o test-100.mp3
curl "https://api.pagepay.ng/api/v1/content/audio/500.mp3" -o test-500.mp3
```

Listen to each file to verify quality.

### 2. Test Listen Mode in App
1. Open PagePay app
2. Navigate to any OpenStax book
3. Tap "Listen" mode in reader
4. Verify audio plays
5. Test play/pause, skip, speed controls
6. Test premium gate on unit 2 (free users should be locked)

### 3. Monitor Error Logs
Watch for these errors:
```
ERROR: TTS generation failed for unit 123: <error>
```

If errors appear, investigate and regenerate those specific units.

---

## Production Checklist

- [ ] TTS batch job completed successfully
- [ ] Sample audio files tested and quality verified
- [ ] Audio endpoint returns 200 for generated files
- [ ] Audio endpoint returns 404 for non-existent files
- [ ] 30-day cache headers present in response
- [ ] Listen mode tested in app
- [ ] Premium gate tested (free user locked on unit 2+)
- [ ] Background playback tested (minimize app while playing)
- [ ] No errors in backend logs

---

## Quick Commands Reference

```bash
# Generate all audio (1-2 hours)
curl -X POST "https://api.pagepay.ng/api/v1/admin/content/tts/generate-all" \
  -H "X-Admin-Token: <token>"

# Generate single work
curl -X POST "https://api.pagepay.ng/api/v1/admin/content/tts/generate-work/{work_id}" \
  -H "X-Admin-Token: <token>"

# Check if audio exists for unit
curl -I "https://api.pagepay.ng/api/v1/content/audio/{unit_id}.mp3"

# Test audio playback
curl "https://api.pagepay.ng/api/v1/content/audio/{unit_id}.mp3" -o test.mp3
```

---

**Status:** Ready to run  
**Estimated time:** 1-2 hours for full catalog  
**Next step:** Run the batch job, then deploy 🚀
