/**
 * RichText — prose with mathematics in it.
 *
 * The parser writes inline mathematics inside dollar signs, the same
 * way a textbook does: "the area of a circle is $πr^{2}$". This
 * component splits a line on those markers and renders the pieces,
 * so an equation sitting in the middle of a sentence is typeset
 * rather than shown as raw LaTeX.
 *
 * A lone dollar sign is treated as a literal character: prices, and
 * currency amounts, must not break a line.
 */

import { memo, Fragment } from "react";
import { StyleSheet, Text } from "react-native";

import { MathText } from "@/components/study/MathText";
import { splitInlineMath } from "@/src/shared/lib/latex";

type RichTextProps = {
  children: string;
  color: string;
  fontSize?: number;
  lineHeight?: number;
  style?: object;
};

function RichTextImpl({
  children,
  color,
  fontSize = 15,
  lineHeight = 22,
  style,
}: RichTextProps) {
  const parts = splitInlineMath(children ?? "");

  if (parts.length === 0) {
    return null;
  }

  return (
    <Text style={[{ color, fontSize, lineHeight }, style]}>
      {parts.map((part, index) => {
        if (part.kind === "math") {
          return (
            <MathText key={index} color={color} fontSize={fontSize}>
              {part.value}
            </MathText>
          );
        }
        return <Fragment key={index}>{part.value}</Fragment>;
      })}
    </Text>
  );
}

export const RichText = memo(RichTextImpl);

export const richTextStyles = StyleSheet.create({
  body: {
    fontSize: 15,
    lineHeight: 22,
  },
});
