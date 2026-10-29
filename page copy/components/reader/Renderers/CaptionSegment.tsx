/**
 * CaptionSegment — muted, smaller text below the preceding image.
 * Per v3 §2.4: "Show captions in smaller, muted text below."
 *
 * Captions are detected as standalone `Caption: …` lines in
 * `parseBody.ts`. The parser doesn't pair them with a preceding
 * image explicitly — the renderer just always shows them after
 * the previous block. If a caption shows up in the middle of
 * prose without an image above it, that's a slicing bug, not a
 * rendering bug; the renderer should not silently drop it.
 */

import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

type CaptionSegmentProps = {
  text: string;
  inkMutedColor: string;
};

function CaptionSegmentImpl({ text, inkMutedColor }: CaptionSegmentProps) {
  return (
    <View style={styles.wrap}>
      <Text style={[styles.text, { color: inkMutedColor }]}>{text}</Text>
    </View>
  );
}

export const CaptionSegment = memo(CaptionSegmentImpl);

const styles = StyleSheet.create({
  wrap: {
    marginTop: -4,
    marginBottom: 14,
    paddingHorizontal: 8,
  },
  text: {
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
  },
});
