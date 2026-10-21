/**
 * SpecialBlockCard — the cards that carry the parts of a material that
 * are not ordinary prose.
 *
 * A worked calculation, a formula, a piece of code, a quoted saying, a
 * theorem, a definition, a table: each of these has a shape of its
 * own, and each renders differently.
 *
 * The rule the whole thing follows is that the server sends the
 * *source* and this file decides the *presentation*. A formula arrives
 * as LaTeX and is typeset; a code listing arrives as text and is set
 * in monospace with its indentation intact and a way to copy it. That
 * split is the project's own convention — the catalog reader does the
 * same thing with its `[[EQ:…]]` sentinels — and it means the same
 * stored material can look right on a phone and on a tablet.
 */

import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

import { CodeBlock } from "@/components/study/CodeBlock";
import { MathText } from "@/components/study/MathText";
import { RichText } from "@/components/study/RichText";
import { Fonts } from "@/constants/theme";

export type ContentBlock = {
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
    | "statement"
    | "definition"
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
  term?: string;
  headers?: string[];
  rows?: string[][];
};

type SpecialBlockCardProps = {
  block: ContentBlock;
  tokens: any;
  index: number;
};

type BlockConfig = {
  icon: string;
  borderTint: string;
  backgroundTint: string;
  labelTint: string;
  badgeText: string;
  fallbackLabel: string;
};

const BLOCK_CONFIG: Record<string, BlockConfig> = {
  tip: {
    icon: "bulb-outline",
    borderTint: "rgba(14, 124, 102, 0.35)",
    backgroundTint: "rgba(14, 124, 102, 0.06)",
    labelTint: "#0E7C66",
    badgeText: "Tip",
    fallbackLabel: "Remember",
  },
  warning: {
    icon: "warning-outline",
    borderTint: "rgba(230, 126, 34, 0.35)",
    backgroundTint: "rgba(230, 126, 34, 0.06)",
    labelTint: "#C8781E",
    badgeText: "Caution",
    fallbackLabel: "Important",
  },
  calculation: {
    icon: "calculator-outline",
    borderTint: "rgba(52, 73, 94, 0.35)",
    backgroundTint: "rgba(52, 73, 94, 0.06)",
    labelTint: "#34495E",
    badgeText: "Worked Example",
    fallbackLabel: "Example",
  },
  code: {
    icon: "terminal-outline",
    borderTint: "rgba(75, 85, 99, 0.35)",
    backgroundTint: "rgba(30, 41, 59, 0.05)",
    labelTint: "#374151",
    badgeText: "Code",
    fallbackLabel: "Code",
  },
  quote: {
    icon: "chatbubbles-outline",
    borderTint: "rgba(139, 92, 246, 0.35)",
    backgroundTint: "rgba(139, 92, 246, 0.05)",
    labelTint: "#7C3AED",
    badgeText: "Quote",
    fallbackLabel: "Quote",
  },
  formula: {
    icon: "pulse-outline",
    borderTint: "rgba(6, 182, 212, 0.35)",
    backgroundTint: "rgba(6, 182, 212, 0.05)",
    labelTint: "#0891B2",
    badgeText: "Formula",
    fallbackLabel: "Formula",
  },
  statement: {
    icon: "ribbon-outline",
    borderTint: "rgba(180, 83, 9, 0.35)",
    backgroundTint: "rgba(180, 83, 9, 0.05)",
    labelTint: "#B45309",
    badgeText: "Statement",
    fallbackLabel: "Statement",
  },
  definition: {
    icon: "bookmark-outline",
    borderTint: "rgba(79, 70, 229, 0.35)",
    backgroundTint: "rgba(79, 70, 229, 0.05)",
    labelTint: "#4F46E5",
    badgeText: "Definition",
    fallbackLabel: "Definition",
  },
  table: {
    icon: "grid-outline",
    borderTint: "rgba(107, 114, 128, 0.35)",
    backgroundTint: "rgba(107, 114, 128, 0.05)",
    labelTint: "#4B5563",
    badgeText: "Table",
    fallbackLabel: "Data",
  },
};

export function SpecialBlockCard({ block, tokens, index }: SpecialBlockCardProps) {
  const config = BLOCK_CONFIG[block.type];
  if (!config) return null;

  const label = block.label || config.fallbackLabel;

  // Code is a listing, not a card. It gets its own surface so the
  // monospace and the indentation read as code.
  if (block.type === "code") {
    return (
      <Animated.View entering={FadeInDown.duration(400).delay(index * 60)}>
        <View style={styles.codeWrap}>
          <CodeBlock
            code={block.text ?? ""}
            language={block.language}
            color={tokens.ink}
            mutedColor={tokens.inkMuted}
            surfaceColor={tokens.codeSurface}
            borderColor={tokens.border}
            accentColor={tokens.mint}
          />
        </View>
      </Animated.View>
    );
  }

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
        <Text style={[styles.label, { color: config.labelTint }]}>{label}</Text>
        {block.language && (
          <Text style={[styles.languageBadge, { color: config.labelTint }]}>
            {block.language}
          </Text>
        )}
      </View>

      {block.type === "definition" && block.term ? (
        <View style={styles.definitionHead}>
          <Text style={[styles.definitionTerm, { color: tokens.ink }]}>
            {block.term}
          </Text>
          {block.text ? (
            <RichText
              color={tokens.ink}
              fontSize={15}
              lineHeight={22}
              style={styles.definitionText}
            >
              {block.text}
            </RichText>
          ) : null}
        </View>
      ) : null}

      {block.type === "definition" && !block.term && block.text ? (
        <RichText color={tokens.ink} fontSize={15} lineHeight={22}>
          {block.text}
        </RichText>
      ) : null}

      {block.type === "formula" ? (
        <View style={styles.formulaWrap}>
          <MathText color={tokens.ink} fontSize={20} display>
            {block.text ?? ""}
          </MathText>
        </View>
      ) : null}

      {block.type === "formula" && block.description ? (
        <RichText
          color={tokens.inkMuted}
          fontSize={14}
          lineHeight={20}
          style={styles.descriptionText}
        >
          {block.description}
        </RichText>
      ) : null}

      {block.type === "statement" && block.text ? (
        <Text style={[styles.statementText, { color: tokens.ink }]}>
          {block.text}
        </Text>
      ) : null}

      {block.type === "quote" && block.text ? (
        <View style={styles.quoteRow}>
          <View style={[styles.quoteRule, { backgroundColor: config.labelTint }]} />
          <View style={styles.quoteBody}>
            <Text style={[styles.quoteText, { color: tokens.ink }]}>
              {block.text}
            </Text>
            {block.attribution ? (
              <Text style={[styles.attribution, { color: config.labelTint }]}>
                {block.attribution}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Everything else carries plain or inline-mathematical prose. */}
      {block.type !== "definition" &&
      block.type !== "formula" &&
      block.type !== "quote" &&
      block.type !== "statement" &&
      block.text ? (
        <RichText color={tokens.ink} fontSize={15} lineHeight={22}>
          {block.text}
        </RichText>
      ) : null}

      {block.type !== "formula" && block.description ? (
        <RichText
          color={tokens.inkMuted}
          fontSize={13}
          lineHeight={20}
          style={styles.descriptionText}
        >
          {block.description}
        </RichText>
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
              <RichText
                color={tokens.ink}
                fontSize={14}
                lineHeight={21}
                style={styles.stepText}
              >
                {step}
              </RichText>
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
              <RichText
                color={tokens.ink}
                fontSize={14}
                lineHeight={21}
                style={styles.itemText}
              >
                {item}
              </RichText>
            </View>
          ))}
        </View>
      )}

      {block.headers && block.rows && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tableScroll}
          contentContainerStyle={styles.tableScrollContent}
        >
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
                    style={[styles.tableCell, { color: tokens.ink }]}
                  >
                    {cell}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
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
  codeWrap: {
    marginBottom: 14,
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
  descriptionText: {
    fontSize: 13,
    lineHeight: 20,
    opacity: 0.85,
    marginTop: 2,
  },
  formulaWrap: {
    alignItems: "center",
    paddingVertical: 6,
  },
  statementText: {
    fontSize: 16,
    lineHeight: 25,
    fontStyle: "italic",
    fontFamily: Fonts.serif,
  },
  definitionHead: {
    gap: 4,
  },
  definitionTerm: {
    fontSize: 17,
    fontWeight: "700",
  },
  definitionText: {
    marginTop: 2,
  },
  quoteRow: {
    flexDirection: "row",
    gap: 12,
  },
  quoteRule: {
    width: 3,
    borderRadius: 2,
  },
  quoteBody: {
    flex: 1,
    gap: 6,
  },
  quoteText: {
    fontSize: 16,
    lineHeight: 25,
    fontStyle: "italic",
    fontFamily: Fonts.serif,
  },
  attribution: {
    fontSize: 13,
    fontStyle: "italic",
    opacity: 0.85,
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
  tableScroll: {
    marginTop: 4,
  },
  tableScrollContent: {
    paddingRight: 4,
  },
  tableContainer: {
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.08)",
    minWidth: "100%",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 12,
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
    minWidth: 96,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  tableCell: {
    minWidth: 96,
    fontSize: 13,
    lineHeight: 18,
  },
});
