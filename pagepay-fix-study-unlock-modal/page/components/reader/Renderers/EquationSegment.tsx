/**
 * EquationSegment — v1 monospace inline per v3 §2.4. The
 * `[[EQ:…]]` sentinel carries the LaTeX-like source text inside
 * the brackets; we render it verbatim in monospace.
 *
 * v2 (post-launch) is `react-native-katex` for a real rendered
 * formula. The contract doesn't change — the inner text stays
 * LaTeX, only the renderer does. That's the whole point of the
 * sentinel contract: server sends the source, client picks the
 * presentation.
 *
 * Equations are inline (`[[EQ:F = ma]]`) so they sit in the
 * middle of prose without breaking the line. The renderer's
 * container is a single <Text> for that reason — using a
 * block-level <View> would force a line break.
 */

import { memo } from 'react';
import { StyleSheet, Text } from 'react-native';

type EquationSegmentProps = {
  text: string;
  inkColor: string;
};

function EquationSegmentImpl({ text, inkColor }: EquationSegmentProps) {
  return (
    <Text style={[styles.equation, { color: inkColor }]}>{text}</Text>
  );
}

export const EquationSegment = memo(EquationSegmentImpl);

const styles = StyleSheet.create({
  equation: {
    fontFamily: 'monospace',
    fontSize: 14,
    lineHeight: 22,
    backgroundColor: 'transparent',
  },
});
