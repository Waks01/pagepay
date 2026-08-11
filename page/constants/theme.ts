/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
  sepia: {
    text: '#3E2C1C',
    background: '#F5ECD7',
    tint: '#7C5E2A',
    icon: '#7A6650',
    tabIconDefault: '#7A6650',
    tabIconSelected: '#7C5E2A',
  },
};

/**
 * PagePay design tokens. Used by the (auth) screens and any future screens
 * that adopt the brand. Reads both as "wallet/money" (mint) and "book/page"
 * (cream paper) — the two sides of PagePay's value prop.
 *
 * Three color schemes: light, dark, and sepia. Sepia is a warm, paper-
 * toned theme used by long-form readers. The `useEffectiveScheme()`
 * hook now resolves to one of three values.
 */
export const PagePay = {
  light: {
    ink: '#0E1116',
    inkMuted: '#6B7280',
    inkFaint: '#9CA3AF',
    paper: '#FBFAF6',
    paper2: '#F5F2EA',
    card: '#FFFFFF',
    border: '#E5E2DA',
    borderStrong: '#D1CDC2',
    mint: '#0E7C66',
    mintSoft: '#E6F1ED',
    mintFaint: '#F2F8F5',
    mintText: '#FFFFFF',
    signal: '#C2410C',
    signalSoft: '#FDEFE7',
    signalFaint: '#FEF6F1',
    error: '#DC2626',
    gold: '#B8862C',
    indigo: '#2A2F58',
  },
  dark: {
    ink: '#FBFAF6',
    inkMuted: '#9BA1A6',
    inkFaint: '#6B7280',
    paper: '#0E1116',
    paper2: '#15191F',
    card: '#171A21',
    border: '#2A2F38',
    borderStrong: '#3A4150',
    mint: '#34C39B',
    mintSoft: '#1F3D34',
    mintFaint: '#16261F',
    mintText: '#0E1116',
    signal: '#F87171',
    signalSoft: '#3B1F1F',
    signalFaint: '#251515',
    error: '#F87171',
    gold: '#D4A85A',
    indigo: '#8E93C8',
  },
  sepia: {
    // Warm paper tone — easier on the eyes for long reading sessions
    // than pure white. Inspired by Kindle's classic sepia + a slightly
    // darker text than Kindle uses (we have less rendering finesse on
    // mid-range Android panels). Pairs with a brand-tinted mint that's
    // a touch warmer than the light/dark mints.
    ink: '#3E2C1C',
    inkMuted: '#7A6650',
    inkFaint: '#A89175',
    paper: '#F5ECD7',
    paper2: '#EBE0C7',
    card: '#FAF1DD',
    border: '#D9C9A8',
    borderStrong: '#C7B58E',
    mint: '#7C5E2A',
    mintSoft: '#E8D9B0',
    mintFaint: '#F0E4C2',
    mintText: '#FFF8E7',
    signal: '#A04A1F',
    signalSoft: '#F2DCC4',
    signalFaint: '#F8E8D2',
    error: '#A04A1F',
    gold: '#8A6420',
    indigo: '#4A3B6B',
  },
};

/**
 * Editorial design tokens. Spacing on an 8px grid, three radius tiers
 * (sharp input / card / pill), three motion durations. Read alongside
 * `PagePay` — colors come from there, layout shapes come from here.
 */
export const Editorial = {
  spacing: {
    s1: 4,
    s2: 8,
    s3: 12,
    s4: 16,
    s5: 20,
    s6: 24,
    s7: 32,
    s8: 40,
    s9: 56,
  },
  radius: {
    sm: 8,    // inputs, chips
    md: 14,   // cards, buttons
    lg: 20,   // modals
    pill: 999,
  },
  motion: {
    fast: 160,
    med: 240,
    slow: 320,
  },
} as const;

export type PagePayScheme = keyof typeof PagePay;
export type PagePayToken = keyof (typeof PagePay)['light'];

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
    /** Brand display face — Space Grotesk loaded via expo-font. */
    display: 'Inter_700Bold',
    /** Editorial serif — Fraunces loaded via @expo-google-fonts/fraunces. */
    editorial: 'Fraunces_500Medium',
    editorialSemiBold: 'Fraunces_600SemiBold',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
    display: 'Inter_700Bold',
    editorial: 'Fraunces_500Medium',
    editorialSemiBold: 'Fraunces_600SemiBold',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    display: "'Inter', system-ui, sans-serif",
    editorial: "'Fraunces', Georgia, ui-serif, serif",
    editorialSemiBold: "'Fraunces', Georgia, ui-serif, serif",
  },
});
