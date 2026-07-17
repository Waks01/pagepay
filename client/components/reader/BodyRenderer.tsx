/**
 * BodyRenderer — parses a slice's `body_text` into typed segments
 * and renders each via the matching renderer in `./Renderers/`.
 *
 * This is the v3 sentinel renderer (books/design-plan-v3.md §2.4).
 * It exists so the reader can show diagrams, captions, tables, and
 * equations — not just a wall of text.
 *
 * The renderer is feature-gated on `bodySentinelsVersion === 1`.
 * Slices with version 0 (the entire pre-v3 catalog) fall back to a
 * single <Text> with the raw body, which is what the old reader
 * did. This is intentional: it lets us ship the renderer now and
 * roll the ingest change (emit sentinels + bump version)
 * separately without coordinating a client release.
 *
 * The native ad injection is owned by the parent (the reader
 * screen) — this component only renders text/images/etc. The
 * parent intersperses <NativeAdBanner /> every Nth segment to
 * match the existing ad cadence.
 */

import { memo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { parseBody, type RenderSegment } from './parseBody';
import { TextSegment } from './Renderers/TextSegment';
import { ImageSegment } from './Renderers/ImageSegment';
import { CaptionSegment } from './Renderers/CaptionSegment';
import { TableSegment } from './Renderers/TableSegment';
import { EquationSegment } from './Renderers/EquationSegment';
import type { HighlightEntry } from '@/components/reader/StudyPanel';

type BodyRendererProps = {
  bodyText: string;
  bodySentinelsVersion?: number;
  // Color token from `useEffectiveScheme` — passed in so the renderer
  // can theme its segments without owning a hook (the parent already
  // has tokens in scope).
  inkColor: string;
  inkMutedColor: string;
  // The renderer's "no content" message. Defaults to a static
  // string, but tests pass a custom one.
  emptyMessage?: string;
  // Optional: returns a React node to insert AFTER the segment at
  // the given index. Used by the reader to intersperse native ads.
  // The renderer renders this between segments — no wrapping view
  // is added, so the parent owns layout (marginVertical, etc.).
  renderAfter?: (segmentIndex: number, segment: RenderSegment) => ReactNode;
  // When true, render the body as a single <Text> (pre-v3 path).
  // Same as `bodySentinelsVersion < 1` — exposed as a prop so the
  // parent can force-fall-back for tests or debugging.
  forcePlainText?: boolean;
  // v3 §3.2 — Study mode integration.
  /**
   * Global highlights for the current unit. The renderer projects
   * these onto per-segment windows using each text segment's
   * `bodyStart` (set by parseBody). Empty array = no tints.
   */
  highlights?: HighlightEntry[];
  /**
   * Long-press handler. Called by TextSegment with the local
   * selection range; the parent is responsible for translating
   * back to global offsets using the segment's `bodyStart`.
   */
  onLongPress?: (
    segmentBodyStart: number,
    localSelection: { start: number; end: number },
  ) => void;
  /**
   * Tapping a tinted span fires this. The parent uses the id
   * to open the focused-highlight menu in StudyPanel.
   */
  onHighlightPress?: (highlightId: string) => void;
};

function BodyRendererImpl({
  bodyText,
  bodySentinelsVersion,
  inkColor,
  inkMutedColor,
  emptyMessage = 'No content yet.',
  renderAfter,
  forcePlainText,
  highlights = [],
  onLongPress,
  onHighlightPress,
}: BodyRendererProps) {
  // Feature gate: version 0 or missing → render as plain text. The
  // pre-v3 catalog has every slice at version 0, so this branch is
  // the common case today.
  if (forcePlainText || !bodySentinelsVersion || bodySentinelsVersion < 1) {
    if (!bodyText) {
      return (
        <Text style={[styles.empty, { color: inkMutedColor }]}>
          {emptyMessage}
        </Text>
      );
    }
    return (
      <PlainBodyWithHighlights
        bodyText={bodyText}
        highlights={highlights}
        inkColor={inkColor}
        onLongPress={onLongPress}
        onHighlightPress={onHighlightPress}
      />
    );
  }

  const segments = parseBody(bodyText);
  if (segments.length === 0) {
    return (
      <Text style={[styles.empty, { color: inkMutedColor }]}>
        {emptyMessage}
      </Text>
    );
  }

  return (
    <View>
      {segments.map((seg, idx) => (
        <View key={seg.key}>
          <SegmentDispatcher
            segment={seg}
            inkColor={inkColor}
            inkMutedColor={inkMutedColor}
            highlights={seg.kind === 'text' ? highlights : []}
            onLongPress={onLongPress}
            onHighlightPress={onHighlightPress}
          />
          {renderAfter ? renderAfter(idx, seg) : null}
        </View>
      ))}
    </View>
  );
}

/**
 * Pre-v3 single-Text body with optional highlight tints. We treat
 * the whole body as one "segment" with bodyStart=0, so the same
 * highlight-clipping logic in TextSegment handles it.
 */
function PlainBodyWithHighlights({
  bodyText,
  highlights,
  inkColor,
  onLongPress,
  onHighlightPress,
}: {
  bodyText: string;
  highlights: HighlightEntry[];
  inkColor: string;
  onLongPress?: BodyRendererProps['onLongPress'];
  onHighlightPress?: BodyRendererProps['onHighlightPress'];
}) {
  if (!highlights.length && !onLongPress) {
    return (
      <Text style={{ color: inkColor, fontSize: 17, lineHeight: 26 }}>
        {bodyText}
      </Text>
    );
  }
  return (
    <View>
      <TextSegment
        text={bodyText}
        inkColor={inkColor}
        highlights={highlights}
        onLongPress={onLongPress ? (e) => {
          const sel = e.nativeEvent.selection;
          if (!sel) return;
          onLongPress(0, sel);
        } : undefined}
        onHighlightPress={onHighlightPress}
      />
    </View>
  );
}

/**
 * SegmentDispatcher — one switch statement that picks the right
 * renderer. Hoisted out so the parent's `.map` doesn't re-create
 * the switch on every render. Each renderer is memoized separately
 * so a re-render of one segment doesn't blow away the others.
 */
function SegmentDispatcher({
  segment,
  inkColor,
  inkMutedColor,
  highlights,
  onLongPress,
  onHighlightPress,
}: {
  segment: RenderSegment;
  inkColor: string;
  inkMutedColor: string;
  highlights: HighlightEntry[];
  onLongPress?: BodyRendererProps['onLongPress'];
  onHighlightPress?: BodyRendererProps['onHighlightPress'];
}) {
  switch (segment.kind) {
    case 'text':
      return (
        <TextSegment
          text={segment.text}
          inkColor={inkColor}
          highlights={highlights}
          onLongPress={onLongPress ? (e) => {
            const sel = e.nativeEvent.selection;
            if (!sel) return;
            onLongPress(segment.bodyStart, sel);
          } : undefined}
          onHighlightPress={onHighlightPress}
        />
      );
    case 'image':
      return <ImageSegment src={segment.src} alt={segment.alt} />;
    case 'caption':
      return <CaptionSegment text={segment.text} inkMutedColor={inkMutedColor} />;
    case 'table':
      return <TableSegment rows={segment.rows} inkColor={inkColor} borderColor={inkMutedColor} />;
    case 'equation':
      return <EquationSegment text={segment.text} inkColor={inkColor} />;
  }
}

export const BodyRenderer = memo(BodyRendererImpl);

const styles = StyleSheet.create({
  empty: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    paddingVertical: 24,
  },
});
