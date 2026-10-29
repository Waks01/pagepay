/**
 * MathText — renders a LaTeX expression.
 *
 * Two modes, because an equation means different things in different
 * places:
 *
 * - **inline** sits inside a line of prose. It is a single `<Text>`
 *   tree, so it wraps with the sentence around it. A fraction inline
 *   is written as a slashed fraction (`1⁄2`) — a stacked one would
 *   break the line.
 * - **display** stands on its own as a worked formula. Fractions stack
 *   with a rule between them, roots get a bar over the radicand, and
 *   exponents are raised.
 *
 * The renderer is deliberately built from plain `<Text>` and `<View>`.
 * A WebView-based maths engine would typeset fractions and integrals
 * more beautifully, but it needs the network on every formula, it
 * cannot sit inside a line of prose, and it is slow on the cheap
 * Android phones this app actually runs on.
 */

import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { parseLatex, type MathNode } from "@/src/shared/lib/latex";
import { Fonts } from "@/constants/theme";

type MathTextProps = {
  /** The LaTeX source. */
  children: string;
  color: string;
  fontSize?: number;
  /** Standalone formula, or inside a line of prose. */
  display?: boolean;
};

const RULE_COLOR_OPACITY = 0.35;

function MathTextImpl({
  children,
  color,
  fontSize = 16,
  display = false,
}: MathTextProps) {
  const nodes = parseLatex(children);
  if (nodes.length === 0) {
    return <Text style={{ color, fontSize }}>{children}</Text>;
  }

  if (!display) {
    return (
      <Text
        style={{
          color,
          fontSize,
          fontFamily: Fonts.mono,
        }}
      >
        {renderInline(nodes, color, fontSize)}
      </Text>
    );
  }

  return (
    <View style={styles.displayRow}>
      <View
        style={[
          styles.displayBox,
          { borderColor: withOpacity(color, RULE_COLOR_OPACITY) },
        ]}
      >
        {renderDisplay(nodes, color, fontSize)}
      </View>
    </View>
  );
}

export const MathText = memo(MathTextImpl);

/** A colour with an alpha applied, for hairlines. */
function withOpacity(hex: string, opacity: number): string {
  if (hex.startsWith("#") && (hex.length === 7 || hex.length === 4)) {
    const alpha = Math.round(opacity * 255)
      .toString(16)
      .padStart(2, "0");
    return `${hex}${alpha}`;
  }
  return hex;
}

// ── Inline ────────────────────────────────────────────────────────────

function renderInline(
  nodes: MathNode[],
  color: string,
  fontSize: number,
): React.ReactNode[] {
  return nodes.map((node, index) => {
    const key = `i-${index}`;
    switch (node.kind) {
      case "text": {
        // A single Latin letter is a variable and is set in italic.
        if (/^[a-zA-Z]$/.test(node.text)) {
          return (
            <Text key={key} style={{ fontStyle: "italic", color }}>
              {node.text}
            </Text>
          );
        }
        return (
          <Text key={key} style={{ color }}>
            {node.text}
          </Text>
        );
      }
      case "literal":
        return (
          <Text key={key} style={{ color }}>
            {node.text}
          </Text>
        );
      case "symbol":
        return (
          <Text key={key} style={{ color }}>
            {node.text}
          </Text>
        );
      case "frac": {
        const small = Math.round(fontSize * 0.82);
        return (
          <Text key={key} style={{ color }}>
            {renderInline(node.numerator, color, small)}
            <Text style={{ color, fontSize: Math.round(fontSize * 0.9) }}>
              ⁄
            </Text>
            {renderInline(node.denominator, color, small)}
          </Text>
        );
      }
      case "sqrt":
        return (
          <Text key={key} style={{ color }}>
            {node.index ? renderInline(node.index, color, fontSize * 0.7) : null}
            <Text style={{ color }}>√</Text>
            {renderInline(node.radicand, color, fontSize)}
          </Text>
        );
      case "script": {
        const small = Math.round(fontSize * 0.72);
        const base = node.base.length
          ? renderInline(node.base, color, fontSize)
          : null;
        return (
          <Text key={key} style={{ color }}>
            {base}
            {node.subscript ? (
              <Text style={{ color, fontSize: small }}>{renderInline(node.subscript, color, small)}</Text>
            ) : null}
            {node.exponent ? (
              <Text style={{ color, fontSize: small }}>{renderInline(node.exponent, color, small)}</Text>
            ) : null}
          </Text>
        );
      }
      case "row":
        return (
          <Text key={key} style={{ color }}>
            {renderInline(node.children, color, fontSize)}
          </Text>
        );
      default:
        return null;
    }
  });
}

// ── Display ───────────────────────────────────────────────────────────

function renderDisplay(
  nodes: MathNode[],
  color: string,
  fontSize: number,
): React.ReactNode {
  return (
    <View style={styles.displayContent}>
      {nodes.map((node, index) => {
        const key = `d-${index}`;
        switch (node.kind) {
          case "text":
            return (
              <Text
                key={key}
                style={[
                  styles.displayText,
                  {
                    color,
                    fontSize,
                    fontStyle: /^[a-zA-Z]$/.test(node.text)
                      ? "italic"
                      : "normal",
                  },
                ]}
              >
                {node.text}
              </Text>
            );
          case "literal":
            return (
              <Text key={key} style={[styles.displayText, { color, fontSize }]}>
                {node.text}
              </Text>
            );
          case "symbol":
            return (
              <Text key={key} style={[styles.displayText, { color, fontSize }]}>
                {node.text}
              </Text>
            );
          case "frac":
            return (
              <View key={key} style={styles.fracStack}>
                <View style={styles.fracPart}>
                  {renderDisplay(node.numerator, color, fontSize * 0.92)}
                </View>
                <View
                  style={[
                    styles.fracRule,
                    { backgroundColor: withOpacity(color, RULE_COLOR_OPACITY) },
                  ]}
                />
                <View style={styles.fracPart}>
                  {renderDisplay(node.denominator, color, fontSize * 0.92)}
                </View>
              </View>
            );
          case "sqrt":
            return (
              <View key={key} style={styles.sqrtRow}>
                {node.index ? (
                  <Text
                    style={[
                      styles.displayText,
                      { color, fontSize: fontSize * 0.6, marginTop: -2 },
                    ]}
                  >
                    {flatten(node.index)}
                  </Text>
                ) : null}
                <Text
                  style={[
                    styles.displayText,
                    { color, fontSize: fontSize * 1.05, marginTop: -2 },
                  ]}
                >
                  √
                </Text>
                <View
                  style={[
                    styles.sqrtRadicand,
                    { borderColor: withOpacity(color, RULE_COLOR_OPACITY) },
                  ]}
                >
                  {renderDisplay(node.radicand, color, fontSize)}
                </View>
              </View>
            );
          case "script": {
            const small = Math.round(fontSize * 0.66);
            return (
              <View key={key} style={styles.scriptRow}>
                <View style={styles.scriptBase}>
                  {node.base.length
                    ? renderDisplay(node.base, color, fontSize)
                    : null}
                </View>
                {node.subscript ? (
                  <Text
                    style={[
                      styles.displayText,
                      { color, fontSize: small, marginTop: fontSize * 0.42 },
                    ]}
                  >
                    {flatten(node.subscript)}
                  </Text>
                ) : null}
                {node.exponent ? (
                  <Text
                    style={[
                      styles.displayText,
                      { color, fontSize: small, marginTop: -fontSize * 0.52 },
                    ]}
                  >
                    {flatten(node.exponent)}
                  </Text>
                ) : null}
              </View>
            );
          }
          case "row":
            return (
              <View key={key} style={styles.scriptRow}>
                {renderDisplay(node.children, color, fontSize)}
              </View>
            );
          default:
            return null;
        }
      })}
    </View>
  );
}

/** Flatten a parsed subtree to plain text, for scripts and indices. */
function flatten(nodes: MathNode[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
        case "literal":
        case "symbol":
          return node.text;
        case "row":
          return flatten(node.children);
        case "frac":
          return `${flatten(node.numerator)}/${flatten(node.denominator)}`;
        case "sqrt":
          return `√${flatten(node.radicand)}`;
        case "script":
          return flatten(node.base);
        default:
          return "";
      }
    })
    .join("");
}

const styles = StyleSheet.create({
  displayRow: {
    alignItems: "center",
    paddingVertical: 4,
  },
  displayBox: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  displayContent: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  displayText: {
    fontFamily: Fonts.mono,
    lineHeight: 24,
  },
  fracStack: {
    alignItems: "center",
    paddingHorizontal: 3,
  },
  fracPart: {
    alignItems: "center",
    paddingHorizontal: 2,
  },
  fracRule: {
    width: "100%",
    minWidth: 12,
    height: 1,
    marginVertical: 2,
  },
  sqrtRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  sqrtRadicand: {
    borderTopWidth: 1,
    paddingHorizontal: 3,
    paddingTop: 2,
  },
  scriptRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  scriptBase: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
});
