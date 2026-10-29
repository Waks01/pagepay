/**
 * Local study store (highlights + notes) for the v3 reader Study mode.
 *
 * Why a separate store instead of putting this in the global preferences
 * zustand:
 *   - Study data is per-user, per-work, per-unit. Putting it in the
 *     global store would re-render every consumer on every highlight
 *     change, which is too chatty at write-rate (1+/min for a heavy
 *     reader).
 *   - We need debounced flushes. The preferences store is "every
 *     change persists", which is fine for theme/lang but wastes RTT
 *     for highlights. This store batches writes on a 10s timer (and
 *     on app-background) and posts the full blob via PUT.
 *   - On mount, the reader pre-loads the blob from the server. From
 *     then on the store is the source of truth and the server is
 *     reconciled. This is the same "local-first, server-confirmed"
 *     pattern Notion/Apple Notes use (per v3 §3.2).
 *
 * Why we keep the flush timer in the store (not a hook in the screen):
 *   - The reader screen is heavy. A timer in the screen would force
 *     the screen to keep it alive across unmounts. The store's
 *     lifecycle is independent of any one screen mount.
 */
import { create } from 'zustand';
import { AppState, type AppStateStatus } from 'react-native';
import {
  getStudyData,
  putStudyData,
  patchHighlights,
  patchNote,
  type StudyDataBlob,
  type HighlightEntry,
  type NoteEntry,
  type HighlightColor,
} from '@/src/shared/api/studyData';

interface StudyState {
  blob: StudyDataBlob;
  loaded: boolean;
  /** Last successful server sync timestamp (ms epoch). */
  lastSyncedAt: number | null;
  /** True while a sync is in flight. UI uses this to show a subtle "syncing" hint. */
  syncing: boolean;
  /** Last error from a sync attempt. UI surfaces a banner if non-null. */
  lastError: string | null;

  /** Bootstrap the store from the server. Idempotent — safe to call
   *  from the reader's mount. */
  load: () => Promise<void>;

  /** Local-only mutations. Each call schedules a debounced flush. */
  addHighlight: (unitId: number, entry: HighlightEntry) => void;
  removeHighlight: (unitId: number, highlightId: string) => void;
  setNote: (unitId: number, text: string) => void;
  /** Highlight color update — e.g. user picked a new color from the
   *  long-press menu for an existing highlight. */
  setHighlightColor: (unitId: number, highlightId: string, color: HighlightColor) => void;

  /** Imperative flush — used on app-background or slice-finish. */
  flush: () => Promise<void>;
}

const EMPTY_BLOB: StudyDataBlob = { highlights: {}, notes: {} };

// 10s debounce window. The Notion/Apple Notes sweet spot — long
// enough to coalesce a fast reader's bursts, short enough that a
// crash never costs more than 10s of work.
const FLUSH_DEBOUNCE_MS = 10_000;

export const useStudyStore = create<StudyState>((set, get) => {
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let appStateSub: { remove: () => void } | null = null;

  const scheduleFlush = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      // Fire and forget — the store's `syncing` flag tracks the
      // actual in-flight state, so callers can await `flush()`
      // directly if they need a hard barrier.
      get().flush().catch(() => {
        // Errors are stored on the state; we don't rethrow from the
        // timer because there'd be no listener.
      });
    }, FLUSH_DEBOUNCE_MS);
  };

  // Flush on app backgrounding. The user is putting the app down;
  // that's our last-chance signal to push the latest edits to the
  // server. If we miss this, the next launch's `load()` rehydrates
  // stale data, but the in-memory edits are not lost on this device.
  const onAppStateChange = (state: AppStateStatus) => {
    if (state === 'background' || state === 'inactive') {
      get().flush().catch(() => {});
    }
  };

  return {
    blob: EMPTY_BLOB,
    loaded: false,
    lastSyncedAt: null,
    syncing: false,
    lastError: null,

    load: async () => {
      if (get().loaded) return;
      try {
        const blob = await getStudyData();
        set({ blob, loaded: true, lastError: null });
        // Subscribe to AppState only after a successful load. Before
        // load, the store has nothing to flush.
        if (!appStateSub) {
          appStateSub = AppState.addEventListener('change', onAppStateChange);
        }
      } catch (e) {
        // Don't mark loaded — the reader can retry, and a sync-less
        // session is still useful (user sees their in-memory work).
        set({ lastError: (e as Error).message });
      }
    },

    addHighlight: (unitId, entry) => {
      const { blob } = get();
      const key = String(unitId);
      const existing = blob.highlights[key] ?? [];
      // Idempotent on highlight id: if a duplicate is added (which
      // can happen if the same long-press fires twice in a flaky
      // gesture handler), keep the original.
      if (existing.some((h) => h.id === entry.id)) return;
      set({
        blob: {
          ...blob,
          highlights: {
            ...blob.highlights,
            [key]: [...existing, entry],
          },
        },
      });
      scheduleFlush();
    },

    removeHighlight: (unitId, highlightId) => {
      const { blob } = get();
      const key = String(unitId);
      const existing = blob.highlights[key];
      if (!existing) return;
      set({
        blob: {
          ...blob,
          highlights: {
            ...blob.highlights,
            [key]: existing.filter((h) => h.id !== highlightId),
          },
        },
      });
      scheduleFlush();
    },

    setHighlightColor: (unitId, highlightId, color) => {
      const { blob } = get();
      const key = String(unitId);
      const existing = blob.highlights[key];
      if (!existing) return;
      set({
        blob: {
          ...blob,
          highlights: {
            ...blob.highlights,
            [key]: existing.map((h) => (h.id === highlightId ? { ...h, color } : h)),
          },
        },
      });
      scheduleFlush();
    },

    setNote: (unitId, text) => {
      const { blob } = get();
      const key = String(unitId);
      const trimmed = text.trim();
      const next: StudyDataBlob = { ...blob, notes: { ...blob.notes } };
      if (trimmed) {
        const now = new Date().toISOString();
        const existing = blob.notes[key];
        next.notes[key] = {
          text: trimmed,
          created_at: existing?.created_at ?? now,
          updated_at: now,
        };
      } else {
        // Empty text → delete the note. Mirrors the backend PATCH
        // contract: empty text means clear, not "store empty string."
        delete next.notes[key];
      }
      set({ blob: next });
      scheduleFlush();
    },

    flush: async () => {
      // Cancel any pending debounce — we're flushing now, so the
      // scheduled one becomes a no-op.
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      const { blob, syncing } = get();
      if (syncing) {
        // A flush is already in flight. The blob it ships is the
        // one it snapshotted; the new edits will be picked up by
        // the next debounce or the next explicit flush.
        return;
      }
      set({ syncing: true });
      try {
        const next = await putStudyData(blob);
        set({ blob: next, lastSyncedAt: Date.now(), lastError: null });
      } catch (e) {
        set({ lastError: (e as Error).message });
      } finally {
        set({ syncing: false });
      }
    },
  };
});

// Internal helper used by tests / debugging. Not exported by name on
// the hook to discourage production callers from reaching in.
export async function _internalPatchNoteDirect(
  unitId: number,
  text: string,
): Promise<StudyDataBlob> {
  return await patchNote(unitId, text);
}

export async function _internalPatchHighlightsDirect(
  unitId: number,
  entries: HighlightEntry[],
): Promise<StudyDataBlob> {
  return await patchHighlights(unitId, entries);
}

// Re-export types so screens can `import type { HighlightEntry } from
// '@/src/shared/lib/studyStore'` without going through the API
// client. Single source of truth.
export type { HighlightEntry, NoteEntry, StudyDataBlob, HighlightColor };
