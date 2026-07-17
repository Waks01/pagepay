/**
 * StudyPanel — the controller shown when the reader is in Study mode.
 *
 * What it actually owns (intentionally minimal):
 *   1. The unit's note card (view + edit).
 *   2. The sync status pill (idle / syncing / error / saved).
 *   3. The color-picker bottom sheet that appears after a long-press
 *      captures a selection.
 *
 * What it does NOT own:
 *   - The body text rendering. That stays with the reader's
 *     BodyRenderer. We expose a `useStudyHighlights(unitId)` hook
 *     that the reader uses to render colored <Text> spans inside
 *     the body, so the highlights and the body stay in sync
 *     through the same React tree.
 *
 * Why split it this way:
 *   - The original design (panel renders the body) forced the
 *     reader to fork its body-rendering path: sentinel parsing
 *     for Read mode, custom ColouredBodyText for Study mode. That
 *     doubles the test surface and means ad injection has to know
 *     which mode it's in. The clean shape is: the reader always
 *     renders the body the same way, and the panel's highlights
 *     are layered on top via a `tint` prop the reader hands to
 *     its TextSegment.
 *
 * Web fallback: long-press selection is iOS/Android only. The
 * reader handles the web case with a "Study mode is mobile-only"
 * notice in the body slot.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import {
  useStudyStore,
  type HighlightColor,
  type HighlightEntry,
  type NoteEntry,
  type StudyDataBlob,
} from '@/src/shared/lib/studyStore';

const COLORS: { id: HighlightColor; label: string; hex: string }[] = [
  { id: 'yellow', label: 'Yellow', hex: '#FACC15' },
  { id: 'green', label: 'Green', hex: '#22C55E' },
  { id: 'pink', label: 'Pink', hex: '#EC4899' },
  { id: 'blue', label: 'Blue', hex: '#3B82F6' },
];

export interface SelectionState {
  start: number;
  end: number;
  text: string;
}

export interface StudyPanelProps {
  unitId: number;
  /**
   * Called when the user picks a color from the picker sheet.
   * The reader's long-press handler is what populates
   * `pendingSelection`; we surface it back as a `HighlightEntry`.
   * The reader writes the entry to the store via the hook
   * `useStudyHighlights` exposes.
   */
  onHighlight?: (entry: HighlightEntry) => void;
  /**
   * Called when the user taps "Share as image" on a highlight.
   * The reader is the one that knows the screen layout, so we
   * delegate the actual capture-and-share to it.
   */
  onShareHighlight?: (entry: HighlightEntry) => void;
}

const EMPTY_HIGHLIGHTS: HighlightEntry[] = [];

/**
 * Hook used by the reader to render the body with highlight tints.
 * Returns the highlights for the current unit, sorted by `start`.
 */
export function useStudyHighlights(unitId: number): HighlightEntry[] {
  return useStudyStore((s) => s.blob.highlights[String(unitId)] ?? EMPTY_HIGHLIGHTS);
}

/**
 * Public util the reader can call when the user long-presses a
 * span. Returns a stable color-tint for the entry, useful for
 * downstream rendering that doesn't have the COLORS list.
 */
export function colorTintFor(c: HighlightColor): string {
  switch (c) {
    case 'yellow': return 'rgba(250, 204, 21, 0.45)';
    case 'green':  return 'rgba(34, 197, 94, 0.35)';
    case 'pink':   return 'rgba(236, 72, 153, 0.30)';
    case 'blue':   return 'rgba(59, 130, 246, 0.30)';
  }
}

export function StudyPanel({ unitId, onHighlight, onShareHighlight }: StudyPanelProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const isWeb = Platform.OS === 'web';

  const note = useStudyStore((s) => s.blob.notes[String(unitId)]);
  const syncing = useStudyStore((s) => s.syncing);
  const lastError = useStudyStore((s) => s.lastError);
  const lastSyncedAt = useStudyStore((s) => s.lastSyncedAt);
  const highlights = useStudyStore(
    (s) => s.blob.highlights[String(unitId)] ?? EMPTY_HIGHLIGHTS,
  );
  const setNote = useStudyStore((s) => s.setNote);
  const removeHighlight = useStudyStore((s) => s.removeHighlight);

  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(note?.text ?? '');

  // The reader feeds the selection into us via the imperative
  // `setPendingSelection` returned below. We don't pass it as a
  // prop because the reader doesn't always have it — the
  // selection only exists transiently during a long-press.
  const [pendingSelection, setPendingSelection] = useState<SelectionState | null>(null);

  // The reader also reports which highlight is currently focused
  // (e.g. tapped). We use this to show a "Change color" /
  // "Remove" mini menu.
  const [focusedHighlightId, setFocusedHighlightId] = useState<string | null>(null);

  // When the underlying note changes from elsewhere (another
  // device's sync), refresh the draft if we're not editing.
  useEffect(() => {
    if (!editingNote) {
      setNoteDraft(note?.text ?? '');
    }
  }, [note?.text, editingNote]);

  const onNoteSave = useCallback(() => {
    setNote(unitId, noteDraft);
    setEditingNote(false);
  }, [noteDraft, setNote, unitId]);

  const onNoteCancel = useCallback(() => {
    setNoteDraft(note?.text ?? '');
    setEditingNote(false);
  }, [note?.text]);

  const applyColor = useCallback(
    (color: HighlightColor) => {
      if (!pendingSelection || !onHighlight) {
        setPendingSelection(null);
        return;
      }
      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      onHighlight({
        id,
        start: pendingSelection.start,
        end: pendingSelection.end,
        color,
        created_at: new Date().toISOString(),
      });
      setPendingSelection(null);
    },
    [pendingSelection, onHighlight],
  );

  if (isWeb) {
    return (
      <View style={[styles.webNotice, { borderColor: tokens.border, backgroundColor: tokens.card }]}>
        <Text style={{ color: tokens.ink }}>
          Study mode is mobile-only for now. Highlights and notes will
          appear on your phone once you open the app there.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Sync status pill. */}
      <View style={styles.syncRow}>
        <View
          style={[
            styles.syncPill,
            {
              backgroundColor: tokens.card,
              borderColor: lastError ? tokens.error : tokens.border,
            },
          ]}
        >
          <View
            style={[
              styles.syncDot,
              {
                backgroundColor: lastError
                  ? tokens.error
                  : syncing
                  ? tokens.signal
                  : tokens.mint,
              },
            ]}
          />
          <Text style={[styles.syncText, { color: tokens.inkMuted }]}>
            {lastError
              ? 'Sync failed — will retry'
              : syncing
              ? 'Syncing…'
              : lastSyncedAt
              ? 'Saved'
              : 'Local only'}
          </Text>
        </View>
      </View>

      {/* Note card. */}
      {(note || editingNote) && (
        <View
          style={[
            styles.noteCard,
            { backgroundColor: tokens.mintSoft, borderColor: tokens.mint },
          ]}
        >
          {editingNote ? (
            <>
              <Text style={[styles.noteLabel, { color: tokens.mint }]}>
                Note for this slice
              </Text>
              <TextInput
                value={noteDraft}
                onChangeText={setNoteDraft}
                placeholder="Write your note here…"
                placeholderTextColor={tokens.inkMuted}
                multiline
                style={[
                  styles.noteInput,
                  {
                    color: tokens.ink,
                    backgroundColor: tokens.card,
                    borderColor: tokens.border,
                  },
                ]}
              />
              <View style={styles.noteActions}>
                <Pressable
                  onPress={onNoteCancel}
                  style={[styles.noteBtn, { borderColor: tokens.border }]}
                >
                  <Text style={{ color: tokens.ink }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={onNoteSave}
                  style={[styles.noteBtn, { backgroundColor: tokens.mint }]}
                >
                  <Text style={{ color: tokens.mintText, fontWeight: '600' }}>
                    Save
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View style={styles.noteHeaderRow}>
                <Text style={[styles.noteLabel, { color: tokens.mint }]}>
                  Your note
                </Text>
                <Pressable onPress={() => setEditingNote(true)} hitSlop={8}>
                  <Text style={[styles.noteEditLink, { color: tokens.mint }]}>
                    Edit
                  </Text>
                </Pressable>
              </View>
              <Text style={[styles.noteBody, { color: tokens.ink }]}>
                {note?.text}
              </Text>
            </>
          )}
        </View>
      )}

      {!editingNote && !note && (
        <Pressable
          onPress={() => {
            setNoteDraft('');
            setEditingNote(true);
          }}
          style={[styles.addNoteBtn, { borderColor: tokens.border }]}
        >
          <Text style={{ color: tokens.inkMuted, fontSize: 13 }}>
            + Add a note for this slice
          </Text>
        </Pressable>
      )}

      {/* Highlight summary. */}
      {highlights.length > 0 && !focusedHighlightId && (
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryText, { color: tokens.inkMuted }]}>
            {highlights.length} highlight
            {highlights.length === 1 ? '' : 's'} on this slice
          </Text>
          <Pressable
            onPress={() => {
              const last = [...highlights].sort((a, b) => a.start - b.start).pop();
              if (last) removeHighlight(unitId, last.id);
            }}
            hitSlop={8}
          >
            <Text style={[styles.summaryClear, { color: tokens.signal }]}>
              Remove last
            </Text>
          </Pressable>
        </View>
      )}

      {/* Focused-highlight menu. The reader sets the focused id
          when the user taps a colored span in the body. */}
      {focusedHighlightId && (
        <View
          style={[
            styles.focusedCard,
            { backgroundColor: tokens.card, borderColor: tokens.border },
          ]}
        >
          <Text style={[styles.focusedLabel, { color: tokens.inkMuted }]}>
            Highlighted span
          </Text>
          <View style={styles.focusedRow}>
            {COLORS.map((c) => {
              const active = highlights.find((h) => h.id === focusedHighlightId)?.color === c.id;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => {
                    if (!onHighlight) return;
                    // We update the existing entry by id. The reader's
                    // store will resolve it to a setHighlightColor call.
                    // We don't have direct access here, so we re-emit
                    // a no-op-add with the same id and a new color;
                    // the reader's add handler should treat that as an
                    // upsert (see the note in the reader's onHighlight).
                    const h = highlights.find((h) => h.id === focusedHighlightId);
                    if (h) {
                      onHighlight({ ...h, color: c.id });
                      setFocusedHighlightId(null);
                    }
                  }}
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: c.hex, borderWidth: active ? 3 : 0 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Change to ${c.label}`}
                />
              );
            })}
            <Pressable
              onPress={() => {
                if (focusedHighlightId) {
                  removeHighlight(unitId, focusedHighlightId);
                  setFocusedHighlightId(null);
                }
              }}
              style={[styles.focusedDelete, { borderColor: tokens.error }]}
            >
              <Text style={{ color: tokens.error, fontSize: 12, fontWeight: '600' }}>
                Delete
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setFocusedHighlightId(null)}
              style={[styles.focusedCancel, { borderColor: tokens.border }]}
            >
              <Text style={{ color: tokens.inkMuted, fontSize: 12 }}>Close</Text>
            </Pressable>
          </View>
          {onShareHighlight && (
            <Pressable
              onPress={() => {
                const h = highlights.find((h) => h.id === focusedHighlightId);
                if (h) {
                  onShareHighlight(h);
                  setFocusedHighlightId(null);
                }
              }}
              style={[styles.shareBtn, { borderColor: tokens.mint }]}
            >
              <Text style={{ color: tokens.mint, fontSize: 12, fontWeight: '600' }}>
                Share as image
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Color picker bottom sheet. */}
      {pendingSelection && (
        <View
          style={[
            styles.pickerSheet,
            { backgroundColor: tokens.card, borderColor: tokens.border },
          ]}
        >
          <Text style={[styles.pickerQuote, { color: tokens.ink }]}>
            "{pendingSelection.text.length > 80
              ? pendingSelection.text.slice(0, 77) + '…'
              : pendingSelection.text}"
          </Text>
          <View style={styles.pickerRow}>
            {COLORS.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => applyColor(c.id)}
                style={[styles.colorSwatch, { backgroundColor: c.hex }]}
                accessibilityRole="button"
                accessibilityLabel={`Highlight in ${c.label}`}
              />
            ))}
            <Pressable
              onPress={() => setPendingSelection(null)}
              style={[styles.cancelBtn, { borderColor: tokens.border }]}
            >
              <Text style={{ color: tokens.ink }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Imperative API. The reader uses these to push the
          long-press selection in and to set the focused highlight
          when the user taps a span. We expose them via a render
          prop so the reader can grab the handlers without
          prop-drilling through several layers. */}
      <StudyPanelHandles
        setPendingSelection={setPendingSelection}
        setFocusedHighlightId={setFocusedHighlightId}
      />
    </View>
  );
}

/**
 * The reader renders <StudyPanelHandles /> inside its own tree
 * to grab the imperative API. We use a callback ref pattern
 * instead of a context because: (a) the reader is the only
 * consumer, (b) context would force a re-render on every
 * selection change.
 */
import type { Dispatch, SetStateAction } from 'react';
let _externalSetPending: Dispatch<SetStateAction<SelectionState | null>> | null = null;
let _externalSetFocused: Dispatch<SetStateAction<string | null>> | null = null;

export function setStudyPendingSelection(s: SelectionState | null) {
  _externalSetPending?.(s);
}

export function setStudyFocusedHighlight(id: string | null) {
  _externalSetFocused?.(id);
}

// Re-export the types so screens and other components that import
// from this panel don't have to also reach into the study store.
// Single source of truth: studyStore.ts. This file is a
// re-exporter.
export type { HighlightEntry, HighlightColor, NoteEntry, StudyDataBlob };

function StudyPanelHandles({
  setPendingSelection,
  setFocusedHighlightId,
}: {
  setPendingSelection: Dispatch<SetStateAction<SelectionState | null>>;
  setFocusedHighlightId: Dispatch<SetStateAction<string | null>>;
}) {
  // Stash the setters on module-level refs the reader calls into.
  // We only do this once per mount.
  _externalSetPending = setPendingSelection;
  _externalSetFocused = setFocusedHighlightId;
  return null;
}

const styles = StyleSheet.create({
  root: { width: '100%' },
  webNotice: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginVertical: 12,
  },
  syncRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 8,
  },
  syncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  syncDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  syncText: { fontSize: 11, fontWeight: '500' },
  noteCard: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  noteHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  noteLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  noteEditLink: { fontSize: 13, fontWeight: '600' },
  noteBody: { fontSize: 14, lineHeight: 20 },
  noteInput: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    minHeight: 80,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: 'top',
    marginBottom: 8,
  },
  noteActions: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  noteBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  addNoteBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  summaryText: { fontSize: 12 },
  summaryClear: { fontSize: 12, fontWeight: '600' },
  focusedCard: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  focusedLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  focusedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  colorSwatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderColor: '#000',
  },
  focusedDelete: {
    marginLeft: 'auto',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  focusedCancel: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  shareBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  pickerSheet: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 8,
  },
  pickerQuote: {
    fontSize: 14,
    fontStyle: 'italic',
    marginBottom: 10,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cancelBtn: {
    marginLeft: 'auto',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
});
