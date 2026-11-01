/**
 * TableSegment — v1 monospace block per v3 §2.4. The slicer joins
 * rows with ` | ` and rows with newlines; `parseBody` re-splits on
 * ` | ` to give us a 2D array.
 *
 * v1 (this) is monospace because we don't have a table component
 * installed and rolling one for a small volume of education
 * tables is over-engineering. v2 (post-launch) swaps this for a
 * real table component when we add chart support.
 *
 * The first row is rendered in bold to suggest a header without
 * the slicer having to mark it explicitly. If the slicer ever
 * starts emitting header rows explicitly (e.g. `[TABLE HEADER]…`),
 * this is the place to switch on that.
 */

import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

type TableSegmentProps = {
  rows: string[][];
  inkColor: string;
  borderColor: string;
};

function TableSegmentImpl({ rows, inkColor, borderColor }: TableSegmentProps) {
  return (
    <View style={[styles.wrap, { borderColor }]}>
      {rows.map((row, rowIdx) => (
        <View
          key={`r-${rowIdx}`}
          style={[
            styles.row,
            rowIdx > 0 && { borderTopColor: borderColor, borderTopWidth: StyleSheet.hairlineWidth },
          ]}
        >
          {row.map((cell, cellIdx) => (
            <Text
              key={`c-${rowIdx}-${cellIdx}`}
              style={[
                styles.cell,
                cellIdx > 0 && { borderLeftColor: borderColor, borderLeftWidth: StyleSheet.hairlineWidth },
                rowIdx === 0 && styles.headerCell,
                { color: inkColor },
              ]}
            >
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

export const TableSegment = memo(TableSegmentImpl);

const styles = StyleSheet.create({
  wrap: {
    marginVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
  },
  cell: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 16,
  },
  headerCell: {
    fontWeight: '700',
  },
});
