/**
 * TextSegment — renders plain prose between sentinels. The same
 * 17/26 font sizing the pre-v3 reader used (see the old
 * `app/reader/[id].tsx:671` body style). Lifted into its own file
 * so other reader surfaces (Study mode, Listen mode placeholder)
 * can reuse the exact same look.
 *
 * Why a custom <Text> wrapper and not a shared one: each rendered
 * segment is a logical "block" (sentinel, image, table) and gets
 * its own margin. Conflating them into a single <Text> would make
 * the spacing impossible to tune.
 *
 * v3 §3.2 — Study mode highlighting. When the reader is in Study
 * mode it passes:
 *   - `highlights`: the unit's highlight ranges (pre-sorted, possibly
 *     pre-merged). The segment splits the segment's `text` into
 *     `default` + `tinted` <Text> spans based on these ranges.
 *   - `onLongPress`: the long-press callback that captures the
 *     user's selection. We attach it to the parent <Text> so the
 *     native context-menu flow still works.
 *
 * Ranges are *local* to this segment — i.e. they're offsets within
 * `text`, not within the full body. The reader projects global
 * highlights to per-segment ranges by intersecting them with the
 * segment's `textStartOffset` (set by the renderer's caller).
 */

import { memo, useCallback } from 'react';
import { StyleSheet, Text, type GestureResponderEvent } from 'react-native';
import { colorTintFor, type HighlightEntry } from '@/components/reader/StudyPanel';

type TextSegmentProps = {
  text: string;
  inkColor: string;
  /**
   * Per-segment highlights. Offsets are local to `text`. The
   * caller is responsible for clipping global highlights to this
   * segment's window. Empty array = no tints.
   */
  highlights?: HighlightEntry[];
  /**
   * Fired on long-press. The native event's `selection` field
   * gives the offsets *within this segment's text*. The parent
   * must translate back to global offsets before writing to the
   * store.
   */
  onLongPress?: (
    e: { nativeEvent: { selection?: { start: number; end: number } } } & GestureResponderEvent,
  ) => void;
  /**
   * Tapping a tinted span fires this. The parent uses the offset
   * to set the focused highlight (which then opens the color
   * picker / delete menu in StudyPanel).
   */
  onHighlightPress?: (highlightId: string) => void;
};

function TextSegmentImpl({
  text,
  inkColor,
  highlights = [],
  onLongPress,
  onHighlightPress,
}: TextSegmentProps) {
  // Stable handler. RN's Text onLongPress fires AFTER the user
  // releases, with the final native selection in the event. If
  // the user just tapped (no drag), selection is undefined and
  // we no-op.
  const handleLongPress = useCallback(
    (e: Parameters<NonNullable<typeof onLongPress>>[0]) => {
      onLongPress?.(e);
    },
    [onLongPress],
  );

  if (!highlights.length) {
    return (
      <Text
        style={[styles.text, { color: inkColor }]}
        onLongPress={handleLongPress}
      >
        {text}
      </Text>
    );
  }

  // Split `text` into chunks: alternating default and tinted.
  // We assume `highlights` is non-overlapping and sorted (the
  // StudyPanel's merge step guarantees this). The result is a
  // flat list of <Text> children RN can lay out.
  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  const chunks: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((h, i) => {
    // Clip highlight to this segment.
    const s = Math.max(0, h.start);
    const e = Math.min(text.length, h.end);
    if (s >= e) return;
    if (s > cursor) {
      chunks.push(
        <Text key={`t${i}`} style={{ color: inkColor }}>
          {text.slice(cursor, s)}
        </Text>,
      );
    }
    chunks.push(
      <Text
        key={`h${i}`}
        onPress={onHighlightPress ? () => onHighlightPress(h.id) : undefined}
        style={{ backgroundColor: colorTintFor(h.color), color: inkColor }}
      >
        {text.slice(s, e)}
      </Text>,
    );
    cursor = e;
  });
  if (cursor < text.length) {
    chunks.push(
      <Text key="tail" style={{ color: inkColor }}>
        {text.slice(cursor)}
      </Text>,
    );
  }
  return (
    <Text style={styles.text} onLongPress={handleLongPress}>
      {chunks}
    </Text>
  );
}

export const TextSegment = memo(TextSegmentImpl);

const styles = StyleSheet.create({
  text: {
    fontSize: 17,
    lineHeight: 26,
    marginBottom: 14,
  },
});
