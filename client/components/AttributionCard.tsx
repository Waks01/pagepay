/**
 * AttributionCard — the legal attribution block for openly-licensed
 * content (OpenStax, etc.). The backend pre-formats an
 * `attribution_text` string at ingest time; we render it verbatim
 * alongside a license badge. No client-side string assembly, so a
 * license change at the source only requires a re-ingest.
 *
 * The card is hidden when no attribution_text is present (e.g. on
 * casual reader content where the source is public domain and
 * attribution is optional). Returning null keeps the layout clean.
 *
 * Accessibility: the card has a "Source" label, the attribution
 * string, and a license badge. The license badge is rendered as a
 * real <Text> element so screen readers announce "License: CC BY 4.0"
 * rather than just reading the badge styling.
 */
import { StyleSheet, Text, View } from 'react-native';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type AttributionCardProps = {
  attributionText: string | null | undefined;
  licenseType: string | null | undefined;
};

function getTokens(scheme: 'light' | 'dark') {
  return PagePay[scheme];
}

// Map a license string to a human label and a soft background color.
// We keep this in the client so a license name change doesn't require
// a code change for the badge style. The label is a passthrough for
// the common case ("CC BY 4.0" → "CC BY 4.0"); the badge is the
// stylized visual.
function licenseStyle(license: string | null | undefined, tokens: ReturnType<typeof getTokens>) {
  if (!license) return { label: '', bg: tokens.mintSoft, fg: tokens.mint };
  const lc = license.toLowerCase();
  if (lc.includes('cc by-sa')) {
    return { label: 'CC BY-SA 4.0', bg: tokens.mintSoft, fg: tokens.mint };
  }
  if (lc.includes('cc by')) {
    return { label: 'CC BY 4.0', bg: '#E0F2FE', fg: '#0C4A6E' };
  }
  if (lc.includes('public')) {
    return { label: 'Public Domain', bg: tokens.mintSoft, fg: tokens.mint };
  }
  return { label: license, bg: tokens.mintSoft, fg: tokens.mint };
}

export function AttributionCard({ attributionText, licenseType }: AttributionCardProps) {
  const scheme = useEffectiveScheme();
  const tokens = getTokens(scheme);
  const styles = makeStyles(tokens);
  const ls = licenseStyle(licenseType, tokens);

  if (!attributionText) return null;

  return (
    <View style={styles.card} accessibilityLabel={`Source: ${attributionText}. License: ${ls.label}.`}>
      <Text style={styles.label}>Source</Text>
      <Text style={styles.text}>{attributionText}</Text>
      {!!ls.label && (
        <View style={[styles.licensePill, { backgroundColor: ls.bg }]}>
          <Text style={[styles.licenseText, { color: ls.fg }]}>{ls.label}</Text>
        </View>
      )}
    </View>
  );
}

function makeStyles(tokens: ReturnType<typeof getTokens>) {
  return StyleSheet.create({
    card: {
      backgroundColor: tokens.card,
      borderWidth: 1,
      borderColor: tokens.border,
      borderRadius: 14,
      padding: 12,
      marginHorizontal: 16,
      marginTop: 12,
    },
    label: {
      fontSize: 10,
      textTransform: 'uppercase',
      letterSpacing: 1,
      color: tokens.inkMuted,
      marginBottom: 4,
    },
    text: {
      fontSize: 12,
      color: tokens.ink,
      lineHeight: 16,
    },
    licensePill: {
      alignSelf: 'flex-start',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 6,
      marginTop: 6,
    },
    licenseText: {
      fontSize: 10,
      fontWeight: '600',
    },
  });
}
