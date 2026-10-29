/**
 * Study Data client — typed wrapper around the 4 study-data endpoints
 * added in the v3 study-mode migration (migrations 016/017).
 *
 * Why a dedicated client (not a generic apiFetch from the reader):
 *   - Highlights and notes are written at the rate the user reads
 *     (1+ writes per minute for a heavy reader). We batch locally
 *     in zustand and flush every 10s. A typed client makes the
 *     batched-flush contract explicit at the call site.
 *   - The blob shape is strict (per v3 §Appendix A) — a typed
 *     client means a runtime mistake at the writer shows up as
 *     a TS error here, not a 422 from the server.
 *
 * Auth: every call goes through `apiFetch`, so the global 401 →
 * refresh → retry flow handles expired tokens for us.
 *
 * Rate limits (per backend `study_data.py`):
 *   - GET   /        — no limit
 *   - PUT   /        — 60/min
 *   - PATCH highlights|notes /  — 30/min
 *
 * We do NOT enforce those client-side. The user is offline-first;
 * a flush that hits 429 will surface as a transient error and the
 * batcher will retry on the next tick.
 */
import { apiFetch } from './client';

export type HighlightColor = 'yellow' | 'green' | 'pink' | 'blue';

export interface HighlightEntry {
  /** Stable per-highlight id (client-generated UUID). */
  id: string;
  /** Zero-based character offset into the slice body. */
  start: number;
  /** Zero-based character offset, exclusive. */
  end: number;
  color: HighlightColor;
  /** ISO 8601 timestamp from the writer; backend falls back to now. */
  created_at?: string;
}

export interface NoteEntry {
  text: string;
  created_at: string;
  updated_at: string;
}

/**
 * The user-level study blob. Keys are stringified `unit_id` per
 * the v3 §Appendix A spec — JSON object keys are always strings,
 * and keeping them as strings here means `study_data.highlights[42]`
 * and `study_data.highlights["42"]` are the same key in JSON.
 */
export interface StudyDataBlob {
  highlights: Record<string, HighlightEntry[]>;
  notes: Record<string, NoteEntry>;
}

export interface StudyDataPatchHighlights {
  entries: HighlightEntry[];
}

export interface StudyDataPatchNote {
  text: string;
}

const STUDY_PATH = '/api/v1/content/users/me/study-data';

export async function getStudyData(): Promise<StudyDataBlob> {
  const res = await apiFetch(STUDY_PATH, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`getStudyData failed: ${res.status}`);
  }
  // Backend returns an empty blob (not null) on a fresh user.
  return (await res.json()) as StudyDataBlob;
}

export async function putStudyData(blob: StudyDataBlob): Promise<StudyDataBlob> {
  const res = await apiFetch(STUDY_PATH, {
    method: 'PUT',
    body: JSON.stringify(blob),
  });
  if (!res.ok) {
    throw new Error(`putStudyData failed: ${res.status}`);
  }
  return (await res.json()) as StudyDataBlob;
}

export async function patchHighlights(
  unitId: number,
  entries: HighlightEntry[],
): Promise<StudyDataBlob> {
  const res = await apiFetch(`${STUDY_PATH}/highlights/${unitId}`, {
    method: 'PATCH',
    body: JSON.stringify({ entries } satisfies StudyDataPatchHighlights),
  });
  if (!res.ok) {
    throw new Error(`patchHighlights failed: ${res.status}`);
  }
  return (await res.json()) as StudyDataBlob;
}

export async function patchNote(
  unitId: number,
  text: string,
): Promise<StudyDataBlob> {
  const res = await apiFetch(`${STUDY_PATH}/notes/${unitId}`, {
    method: 'PATCH',
    body: JSON.stringify({ text } satisfies StudyDataPatchNote),
  });
  if (!res.ok) {
    throw new Error(`patchNote failed: ${res.status}`);
  }
  return (await res.json()) as StudyDataBlob;
}
