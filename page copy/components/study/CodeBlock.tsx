/**
 * CodeBlock — code as it should look in a study app.
 *
 * Code is not prose. Setting it in the body font, letting it wrap at
 * the screen edge, and hiding the indentation all at once make a
 * snippet unreadable — and a snippet is usually the one thing in the
 * material the student needs to copy exactly.
 *
 * So: a monospace face, the real indentation, line numbers, a dark
 * surface that separates it from the surrounding prose, and a
 * horizontal scroll instead of a wrap. The copy button puts the
 * snippet on the clipboard, because "write this down" is what the
 * student is going to do with it.
 */

import { useCallback, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { Fonts } from "@/constants/theme";

type CodeBlockProps = {
  code: string;
  language?: string | null;
  /** Ink colour for the code itself. */
  color: string;
  /** Muted colour for the gutter and the badge. */
  mutedColor: string;
  /** Background of the code surface. */
  surfaceColor: string;
  /** Border colour of the code surface. */
  borderColor: string;
  /** Accent colour for the copy button. */
  accentColor: string;
};

const GUTTER_WIDTH = 30;

export function CodeBlock({
  code,
  language,
  color,
  mutedColor,
  surfaceColor,
  borderColor,
  accentColor,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const lines = (code ?? "").replace(/\n+$/, "").split("\n");

  const handleCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(code);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // A clipboard that refuses is not worth an error dialog.
    }
  }, [code]);

  return (
    <View
      style={[styles.root, { backgroundColor: surfaceColor, borderColor }]}
    >
      <View style={styles.header}>
        <Text style={[styles.language, { color: mutedColor }]}>
          {language || "code"}
        </Text>
        <Pressable
          onPress={handleCopy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Copy the code"
          style={styles.copyButton}
        >
          <Ionicons
            name={copied ? "checkmark" : "copy-outline"}
            size={14}
            color={copied ? accentColor : mutedColor}
          />
          <Text
            style={[styles.copyLabel, { color: copied ? accentColor : mutedColor }]}
          >
            {copied ? "Copied" : "Copy"}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View>
          {lines.map((line, index) => (
            <View key={index} style={styles.line}>
              <Text style={[styles.gutter, { color: mutedColor }]}>
                {index + 1}
              </Text>
              <Text
                style={[styles.code, { color }]}
                // The indentation is part of the code. React Native
                // collapses it, so the spaces are preserved by hand.
                selectable
              >
                {line.length > 0 ? line : " "}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    marginVertical: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  language: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  copyLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  scrollContent: {
    paddingBottom: 12,
  },
  line: {
    flexDirection: "row",
    paddingHorizontal: 12,
  },
  gutter: {
    width: GUTTER_WIDTH,
    fontSize: 12,
    lineHeight: 19,
    fontFamily: Fonts.mono,
    opacity: 0.55,
    textAlign: "right",
    marginRight: 10,
  },
  code: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Fonts.mono,
    ...Platform.select({
      ios: { fontVariant: ["tabular-nums"] },
      default: {},
    }),
  },
});
