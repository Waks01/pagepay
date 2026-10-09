import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

type ContentBlock = {
  type:
    | "heading"
    | "body"
    | "list"
    | "numbered_list"
    | "tip"
    | "warning"
    | "calculation"
    | "code"
    | "quote"
    | "formula"
    | "table";
  text?: string;
  level?: number;
  style?: string;
  items?: string[];
  label?: string;
  steps?: string[];
  language?: string;
  attribution?: string;
  description?: string;
  headers?: string[];
  rows?: string[][];
};

type SpecialBlockCardProps = {
  block: ContentBlock;
  tokens: any;
  index: number;
};

const BLOCK_CONFIG: Record<
  string,
  {
    icon: string;
    borderTint: string;
    backgroundTint: string;
    labelTint: string;
    textTint: string;
    badgeText: string;
    fallbackLabel: string;
  }
> = {
  tip: {
    icon: "bulb-outline",
    borderTint: "rgba(14, 124, 102, 0.35)",
    backgroundTint: "rgba(14, 124, 102, 0.06)",
    labelTint: "#0E7C66",
    textTint: "#1A1A1A",
    badgeText: "Tip",
    fallbackLabel: "Remember",
  },
  warning: {
    icon: "warning-outline",
    borderTint: "rgba(230, 126, 34, 0.35)",
    backgroundTint: "rgba(230, 126, 34, 0.06)",
    labelTint: "#C8781E",
    textTint: "#1A1A1A",
    badgeText: "Caution",
    fallbackLabel: "Important",
  },
  calculation: {
    icon: "calculator-outline",
    borderTint: "rgba(52, 73, 94, 0.35)",
    backgroundTint: "rgba(52, 73, 94, 0.06)",
    labelTint: "#34495E",
    textTint: "#1A1A1A",
    badgeText: "Worked Example",
    fallbackLabel: "Example",
  },
  code: {
    icon: "terminal-outline",
    borderTint: "rgba(75, 85, 99, 0.35)",
    backgroundTint: "rgba(30, 41, 59, 0.06)",
    labelTint: "#374151",
    textTint: "#1A1A1A",
    badgeText: "Code",
    fallbackLabel: "Code",
  },
  quote: {
    icon: "chatbubbles-outline",
    borderTint: "rgba(139, 92, 246, 0.35)",
    backgroundTint: "rgba(139, 92, 246, 0.06)",
    labelTint: "#7C3AED",
    textTint: "#1A1A1A",
    badgeText: "Quote",
    fallbackLabel: "Quote",
  },
  formula: {
    icon: "pulse-outline",
    borderTint: "rgba(6, 182, 212, 0.35)",
    backgroundTint: "rgba(6, 182, 212, 0.06)",
    labelTint: "#0891B2",
    textTint: "#1A1A1A",
    badgeText: "Formula",
    fallbackLabel: "Formula",
  },
  table: {
    icon: "grid-outline",
    borderTint: "rgba(107, 114, 128, 0.35)",
    backgroundTint: "rgba(107, 114, 128, 0.06)",
    labelTint: "#4B5563",
    textTint: "#1A1A1A",
    badgeText: "Table",
    fallbackLabel: "Data",
  },
};

export function SpecialBlockCard({ block, tokens, index }: SpecialBlockCardProps) {
  const config = BLOCK_CONFIG[block.type];
  if (!config) return null;

  const label = block.label || config.fallbackLabel;

  return (
    <Animated.View
      entering={FadeInDown.duration(400).delay(index * 60)}
      style={[
        styles.root,
        {
          borderLeftColor: config.borderTint,
          backgroundColor: config.backgroundTint,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={[styles.iconPill, { backgroundColor: config.borderTint }]}>
          <Ionicons name={config.icon as any} size={14} color={config.labelTint} />
        </View>
        <Text style={[styles.label, { color: config.labelTint }]}>
          {label}
        </Text>
        {block.language && (
          <Text style={[styles.languageBadge, { color: config.labelTint }]}>
            {block.language}
          </Text>
        )}
      </View>

      {block.text ? (
        <Text style={[styles.bodyText, { color: config.textTint }]}>
          {block.text}
        </Text>
      ) : null}

      {block.description ? (
        <Text style={[styles.descriptionText, { color: config.textTint }]}>
          {block.description}
        </Text>
      ) : null}

      {block.steps && block.steps.length > 0 && (
        <View style={styles.stepsContainer}>
          {block.steps.map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={[styles.stepNumber, { backgroundColor: config.borderTint }]}>
                <Text style={[styles.stepNumberText, { color: config.labelTint }]}>
                  {i + 1}
                </Text>
              </View>
              <Text style={[styles.stepText, { color: config.textTint }]}>
                {step}
              </Text>
            </View>
          ))}
        </View>
      )}

      {block.items && block.items.length > 0 && (
        <View style={styles.itemsContainer}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.itemRow}>
              <Text style={[styles.itemBullet, { color: config.labelTint }]}>
                {"\u2022"}
              </Text>
              <Text style={[styles.itemText, { color: config.textTint }]}>
                {item}
              </Text>
            </View>
          ))}
        </View>
      )}

      {block.attribution && (
        <Text style={[styles.attribution, { color: config.labelTint }]}>
          {block.attribution}
        </Text>
      )}

      {block.headers && block.rows && (
        <View style={styles.tableContainer}>
          <View style={[styles.tableRow, styles.tableHeaderRow]}>
            {block.headers.map((header, i) => (
              <Text
                key={i}
                style={[styles.tableHeaderCell, { color: config.labelTint }]}
              >
                {header}
              </Text>
            ))}
          </View>
          {block.rows.map((row, rowIndex) => (
            <View
              key={rowIndex}
              style={[
                styles.tableRow,
                rowIndex % 2 === 0 ? styles.tableRowEven : styles.tableRowOdd,
              ]}
            >
              {row.map((cell, cellIndex) => (
                <Text
                  key={cellIndex}
                  style={[styles.tableCell, { color: config.textTint }]}
                >
                  {cell}
                </Text>
              ))}
            </View>
          ))}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderLeftWidth: 4,
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    gap: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconPill: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  languageBadge: {
    fontSize: 11,
    fontWeight: "600",
    marginLeft: "auto",
    opacity: 0.8,
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 22,
  },
  descriptionText: {
    fontSize: 13,
    lineHeight: 20,
    opacity: 0.85,
    marginTop: 2,
  },
  stepsContainer: {
    gap: 8,
    marginTop: 4,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  stepNumber: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  stepNumberText: {
    fontSize: 12,
    fontWeight: "700",
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
  },
  itemsContainer: {
    gap: 6,
    marginTop: 2,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  itemBullet: {
    fontSize: 16,
    lineHeight: 22,
    marginTop: 1,
  },
  itemText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
  },
  attribution: {
    fontSize: 13,
    fontStyle: "italic",
    marginTop: 4,
    opacity: 0.8,
  },
  tableContainer: {
    borderRadius: 8,
    overflow: "hidden",
    marginTop: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.08)",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  tableHeaderRow: {
    backgroundColor: "rgba(0,0,0,0.04)",
  },
  tableRowEven: {
    backgroundColor: "transparent",
  },
  tableRowOdd: {
    backgroundColor: "rgba(0,0,0,0.015)",
  },
  tableHeaderCell: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  tableCell: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
});
