# PagePay — Design package

Visual artifacts for the **logos, splash, and onboarding** flow.
All values here match `client/constants/theme.ts` exactly — do not
introduce new colors or fonts when implementing.

## Contents

```
client/
  assets/brand/
    monogram.svg             # app icon (mint P with chamfered page corner + coin)
    wordmark.svg             # billboard logo (monogram + "PagePay" + kicker bar)
    adaptive-foreground.svg  # Android adaptive icon foreground (transparent)
    monochrome.svg           # single-color version for themed icon slots
  design-preview/
    splash.html              # mobile-frame preview of the splash (cold + animated)
    onboarding.html          # mobile-frame preview of the 3 onboarding screens
    README.md                # this file
```

Open `design-preview/splash.html` and `design-preview/onboarding.html`
in any browser to see the design at iPhone 14 size (390×844).

> **The HTML previews are the source of truth for the motion design.**
> Treat them like a Figma prototype: every keyframe timing, easing,
> and easing-curve here is the spec the implementer ports to
> Reanimated 4 in the RN app.

---

## 1. Color tokens (read from `client/constants/theme.ts`)

### Light scheme (primary)

| Token       | Hex       | Role                                                  |
|-------------|-----------|-------------------------------------------------------|
| `ink`       | `#0E1116` | Body / headline text                                  |
| `inkMuted`  | `#6B7280` | Secondary text, "Skip", labels, captions              |
| `paper`     | `#FBFAF6` | App background (cream)                                |
| `card`      | `#FFFFFF` | Card surface                                          |
| `border`    | `#E5E2DA` | Dividers, chip outlines, inactive dots                |
| `mint`      | `#0E7C66` | Primary brand (CTA, monogram, wordmark, active dot)   |
| `mintSoft`  | `#E6F1ED` | Hero plate, coin highlight, soft surface              |
| `mintText`  | `#FFFFFF` | Text on `mint` (e.g. CTA label)                       |
| `signal`    | `#C2410C` | Reserved accent (errors, warnings, hot CTAs)          |
| `signalSoft`| `#FDEFE7` | Reserved accent surface                               |
| `error`     | `#DC2626` | Inline form errors                                    |

### Colors we are NOT using

- **Purple `#6C5CE7`** — referenced in `.kilo/steering.md` brand identity
  but stale. The shipping brand is mint.
- **Inter** — steering says Inter, but the code (`expo-google-fonts/space-grotesk`)
  ships Space Grotesk. We follow the code.
- Any new accent color not in the table above. If you need a new one,
  add it to `client/constants/theme.ts` and reference the token — do
  not inline a hex string.

---

## 2. Typography

- **Display (wordmark, headlines, eyebrow, button label):**
  `Space Grotesk 700 Bold` — loaded in-app via
  `useFonts({ SpaceGrotesk_500Medium, SpaceGrotesk_700Bold })`.
- **Body (onboarding copy, captions, form fields):**
  `system-ui` (iOS) / `Roboto` (Android) / a system fallback stack on web.

### Type scale (onboarding, splash)

| Style    | Size | Weight | Letter-spacing | Line-height |
|----------|------|--------|----------------|-------------|
| Eyebrow  | 12   | 700    | +1.6 px        | 1.0         |
| H2       | 30   | 700    | -0.6 px        | 1.12        |
| Body     | 15   | 400    | 0              | 1.5         |
| CTA      | 16   | 600    | +0.1 px        | 1.0         |
| Wordmark | 44   | 700    | -1.6 px        | 1.0         |

The SVG wordmark in `wordmark.svg` uses 320 px on a 2400×720 artboard
so it remains crisp at any export size (splash banner, Play Store
feature graphic, etc.). When rasterizing for native, replace the
`<text>` with a real Space Grotesk path so font availability isn't a
runtime concern.

---

## 3. Spacing scale

Based on a 4 px grid. Use these in JS via
`StyleSheet.create({ padding: SPACING.lg })`-style helpers, not raw
numbers.

| Token | px  | Use                                           |
|-------|-----|-----------------------------------------------|
| `xs`  | 4   | Inline gaps, dot-to-dot                       |
| `sm`  | 8   | Tight vertical rhythm                         |
| `md`  | 12  | Default gap between eyebrow → headline        |
| `lg`  | 16  | Section gaps, hero padding                    |
| `xl`  | 24  | Hero-to-copy gap                              |
| `2xl` | 28  | Onboarding outer padding (horizontal)         |
| `3xl` | 40  | Hero plate bottom margin                      |

### Component radii

- Cards: `14` (matches `PrimaryButton`)
- Hero plates: `28`
- Dots (active): `4` (pill) / inactive `50%` (circle)
- Phone-frame preview (in HTML): `48` (visual only, not shipped)

---

## 4. Illustration style guide

All onboarding illustrations are **flat, single-weight, two-color
maximum** with one optional accent. They are inline SVGs, not raster.

- **Color palette per illustration:** `mint` for the foreground (the
  subject), `mintSoft` for the "table" / supporting surface, `white`
  for highlights (coin knockout, wallet clasp, etc.). `signal` only
  for "things you spend" moments.
- **No gradients, no drop shadows, no glow.** Solid fills, even weights.
- **Stroke weight:** `3` on a `320` viewBox (so ~0.94 % of the hero
  size). The monogram uses the same scale.
- **Composition:** subject is centered in a square 1:1 hero plate.
  Plates have `border-radius: 28` and a vertical `linear-gradient`
  from `mintSoft` to a slightly lighter tone.
- **Floor disc:** every hero has a soft mint ellipse at `cy=282` of
  ~10 % opacity to ground the subject. The disc is the only "shadow"
  in the system.
- **No "real" brand marks** in any illustration. The wallet in
  Screen 3 carries a generic payment-glyph chip and a `₦` symbol —
  no Flutterwave or Paystack logo.

### Do

- Use the same monogram for the app icon and the splash mark. Don't
  redraw it per screen.
- Use `mint` for "things you earn" (points, coins, success states)
  and `signal` (`#C2410C`) for "things you spend" (premium upsell,
  in-app purchase moment).
- Anchor all illustrations on a `mintSoft` hero plate. The plate is
  the design system — the drawing inside is secondary.
- Keep the headline to 3-4 words ("Earn while you read") and the body
  to 1-2 lines max. Onboarding is skim, not read.

### Don't

- Don't use purple, blue, or any non-mint brand color. They will read
  as a different app.
- Don't introduce a gradient on the monogram — it has to look right
  printed on paper, not just on screen.
- Don't place a logo or wordmark inside the illustration. The
  monogram already lives in the splash, the app bar, and the tab
  bar; doubling up dilutes it.
- Don't animate the cold splash. iOS / Android both take a screenshot
  of whatever the splash shows at launch; if the screenshot is mid-
  animation the device caches a broken frame.
- Don't add a 4th onboarding screen. Steering caps it at 3.

---

## 5. Splash behavior

The two states modeled in `splash.html`:

### 5.1 Cold splash (native, no motion)

Rendered by `expo-splash-screen` from the exported PNG of
`monogram.svg` (or `wordmark.svg` for a billboard version). No animation.
A static ~55-62 % mint progress bar at the bottom of the frame tells
the user the app is alive during JS load. The progress bar does NOT
move — that would put a mid-animation frame into the OS-cached
splash.

### 5.2 JS handoff overlay (motion)

Once `SplashScreen.hideAsync()` is called, an in-app overlay keeps
the same art visible for ~200-800 ms while the first paint of
`RootLayout` happens. This is where the motion lives.

**Motion sequence (in order, ~1.2s for the entry, then ambient):**

| # | Element       | Motion                                                           | Duration / Easing                                                |
|---|---------------|------------------------------------------------------------------|------------------------------------------------------------------|
| 1 | Drift blob    | `translate + scale` alternating                                 | 14s, ease-in-out, infinite, alternate                            |
| 2 | Mark entry    | `scale(0.6) rotate(-8deg)` → `scale(1.06)` → `scale(1.0)`       | 900ms, `cubic-bezier(0.34, 1.56, 0.64, 1)` (overshoot bounce)    |
| 3 | Shimmer       | `translateX(-100%)` → `translateX(100%)` over the mark           | 1100ms, ease-out, once, delayed 500ms after mark entry           |
| 4 | Word entry    | `translateY(14px) opacity:0` → `translateY(0) opacity:1`         | 700ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`, delayed 600ms           |
| 5 | Progress bar  | `translateX(-120%)` → `translateX(220%)` shimmer                 | 1.4s, ease-in-out, infinite                                      |
| 6 | Mark breathe  | `scale(1.0)` ↔ `scale(1.04)`                                     | 2.6s, ease-in-out, infinite, starts after entry completes        |
| 7 | Float tokens  | 8 chips rise `translateY(0)` → `translateY(-220px) opacity:0`    | 5.4s, ease-in-out, infinite, staggered 0.0/0.7/1.3/2.0/2.6/3.2/3.8/4.4s |
| 8 | Sparkles      | 6 dots `scale(0.6) opacity:0` ↔ `scale(1.2) opacity:0.8`         | 2.8s, ease-in-out, infinite, staggered 0.0/0.3/0.6/1.1/1.5/1.8s  |

**Reanimated 4 reference (do not commit until design is approved):**

```tsx
import Animated, {
  Easing, useSharedValue, withRepeat, withSequence,
  withTiming, withDelay, withSpring,
} from 'react-native-reanimated';

export function SplashOverlay() {
  // Mark entry: scale-bounce from 0.6 -> 1.05 -> 1.0
  const markScale = useSharedValue(0.6);
  useEffect(() => {
    markScale.value = withSequence(
      withTiming(1.06, { duration: 540, easing: Easing.out(Easing.cubic) }),
      withSpring(1.0, { damping: 12, stiffness: 180 }),
    );
  }, []);

  // Continuous breathe
  const breathe = useSharedValue(1);
  useEffect(() => {
    breathe.value = withRepeat(
      withTiming(1.04, { duration: 1300, easing: Easing.inOut(Easing.quad) }),
      -1, true,
    );
  }, []);

  // Wordmark slide-up (delayed)
  const wordY = useSharedValue(14);
  const wordO = useSharedValue(0);
  useEffect(() => {
    wordY.value = withDelay(600, withTiming(0, { duration: 700, easing: Easing.out(Easing.cubic) }));
    wordO.value = withDelay(600, withTiming(1, { duration: 700 }));
  }, []);

  // Floating token shared values (8 chips)
  const tokens = Array.from({ length: 8 }, () => useSharedValue(0));
  useEffect(() => {
    tokens.forEach((t, i) => {
      t.value = withDelay(i * 700, withRepeat(
        withTiming(1, { duration: 5400, easing: Easing.inOut(Easing.quad) }),
        -1, false,
      ));
    });
  }, []);

  return (
    <View style={s.root}>
      <Animated.View style={[s.mark, { transform: [{ scale: markScale }] }]}>
        <Animated.Image source={require('@/assets/brand/monogram.png')} style={s.markImg} />
      </Animated.View>
      <Animated.Text style={[s.word, { opacity: wordO, transform: [{ translateY: wordY }] }]}>
        PagePay
      </Animated.Text>
      {/* …progress bar, ambient chips, sparkles… */}
    </View>
  );
}
```

---

## 6. Onboarding behavior

`design-preview/onboarding.html` shows three mobile frames with
continuous motion on every screen. In the real app the same three
screens become a horizontal `expo-router` stack at
`client/app/onboarding/`, gated by the `onboardingCompleted`
preference in `_layout.tsx`.

State machine:

- `index = 0` → "Earn while you read" — `Skip` top-right, `Next` CTA
- `index = 1` → "Turn your syllabus into quizzes" — `Skip`, `Next`
- `index = 2` → "Cash out or go premium" — `Skip` hidden, CTA label
  is `Get started`. Tap → set
  `preferences.onboardingCompleted = true` and `router.replace('/(auth)/register')`.

### 6.1 Screen 1 motion

| Element       | Motion                                                              | Duration / Easing                          |
|---------------|---------------------------------------------------------------------|--------------------------------------------|
| Hero glow     | `scale(1)` ↔ `scale(1.15)` `opacity:0.6` ↔ `opacity:1`              | 3s, ease-in-out, infinite                  |
| Book breathe  | `scale(1) rotate(0)` ↔ `scale(1.025) rotate(0)`                     | 4s, ease-in-out, infinite                  |
| Left page     | `rotateY(0)` ↔ `rotateY(-12deg)`                                    | 5s, ease-in-out, infinite                  |
| Right page    | `rotateY(0)` ↔ `rotateY(12deg)`                                     | 5s, ease-in-out, infinite, 0.4s delay      |
| Coin 1 (left) | `translateY(-40px) rotate(0)` → `translateY(160px) rotate(540deg)`  | 3.2s, ease-in, infinite, 0.0s delay        |
| Coin 2        | same                                                                | 0.5s delay                                 |
| Coin 3 (big)  | same                                                                | 1.0s delay                                 |
| Coin 4        | same                                                                | 1.6s delay                                 |
| Coin 5        | same                                                                | 2.1s delay                                 |
| Headline      | word-by-word fade-up, 80ms stagger                                  | 420ms per word, `cubic-bezier(0.2, 0.8, 0.2, 1)` |

### 6.2 Screen 2 motion

| Element       | Motion                                                              | Duration / Easing                          |
|---------------|---------------------------------------------------------------------|--------------------------------------------|
| AI spark      | `rotate(0deg)` → `rotate(360deg)` around its anchor                  | 4.5s, linear, infinite                     |
| Quiz card     | `translateY(0) scale(1)` ↔ `translateY(-6px) scale(1.04)`            | 6s, ease-in-out, infinite                  |
| Back card L   | `rotate(-4deg)` ↔ `rotate(-7deg) translateX(-4px)`                   | 6s, ease-in-out, infinite                  |
| Back card R   | `rotate(4deg)` ↔ `rotate(7deg) translateX(4px)`                      | 6s, ease-in-out, infinite                  |
| Flashcards ×6 | `translateY(0)` ↔ `translateY(-8px)` at `--rot` offset                | 4s, ease-in-out, infinite, 0.6s stagger     |
| Headline      | typewriter, 45ms per char, then caret blink (900ms, steps(2))        | once on screen entry                       |

### 6.3 Screen 3 motion

| Element        | Motion                                                              | Duration / Easing                          |
|----------------|---------------------------------------------------------------------|--------------------------------------------|
| Wallet flap    | `rotateX(0)` → `rotateX(-30deg)` → `rotateX(0)`                     | 3.6s, ease-in-out, infinite                |
| Coin 1 (top)   | `translateY(-50px)` → `translateY(0) scale(1.1, 0.9)` → `scale(1)`   | 2.4s, ease-out, infinite, 0.0s delay       |
| Coin 2         | same                                                                | 0.25s delay                                |
| Coin 3 (base)  | same                                                                | 0.5s delay                                 |
| ₦ pulse        | `scale(1)` ↔ `scale(1.18)`                                          | 1.8s, ease-in-out, infinite                |
| ₦ trail ×3     | `translateY(0)` → `translateY(-60px) opacity:0`                      | 2.2s, ease-out, infinite, 0.6s stagger     |
| CTA pulse halo | `scale(1) opacity:0` ↔ `scale(1.04) opacity:0.4`                     | 2.4s, ease-in-out, infinite                |
| CTA tap ripple | `width/height: 0` → `360px` `opacity:0.6` → `opacity:0`              | 600ms, ease-out, on tap                    |
| Confetti (18)  | burst `translate(0,0)` → `translate(dx,dy) rotate(rot)`, gravity     | 1.1-1.7s, on final CTA tap, once           |

**Reanimated 4 reference — confetti on final CTA:**

```tsx
import { useSharedValue, withTiming, Easing, runOnJS } from 'react-native-reanimated';

const CONFETTI_COLORS = ['#0E7C66', '#34C39B', '#E6F1ED', '#C2410C', '#FDEFE7', '#0B5C4B'];

function burstConfetti(origin: { x: number; y: number }, containerRef: View) {
  const pieces = Array.from({ length: 18 }, (_, i) => {
    const angle = (Math.PI * 2 * i) / 18 + Math.random() * 0.3;
    const dist  = 120 + Math.random() * 100;
    return {
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist + 200, // gravity
      rot: Math.random() * 720 - 360,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    };
  });
  return pieces.map((p, i) => (
    <ConfettiPiece key={i} {...p} duration={1100 + Math.random() * 600} />
  ));
}
```

**Performance rules:**

- Keep animated element counts low: ≤8 floating tokens, ≤6 sparkles,
  ≤6 flashcards, ≤3 stack coins. Anything more burns battery.
- Always animate `transform` (translate, scale, rotate) — never
  `top`/`left`/`width`/`height` (not GPU-accelerated on Android).
- Use `useSharedValue` for the animated values; bind via
  `useAnimatedStyle` to the Animated.View.
- Gate continuous loops with `useFocusEffect` from
  `@react-navigation/native` so backgrounded screens don't burn battery.
- The `cold splash` is a static PNG. No animation. Ever.

---

## 7. Do / don't — at a glance

| Do                                                              | Don't                                                  |
|-----------------------------------------------------------------|--------------------------------------------------------|
| Re-use `PagePay[scheme].mint` for the CTA                       | Inline `#0E7C66` in a `style={{ color: ... }}`         |
| Re-use `PagePay[scheme].mintSoft` for the hero plate            | Reach for a new "soft mint" hex                        |
| Set the wordmark in Space Grotesk 700 Bold                       | Substitute Inter, or use the system default            |
| Cap onboarding at 3 screens                                     | Add a 4th "tell your friends" / permissions screen     |
| Use `mint` for earnings, `signal` for spend                     | Use the same green for both directions                 |
| Use the same monogram in icon, splash, adaptive-foreground, wordmark | Redraw a "marketing" version of the P            |
| Keep the cold splash static                                     | Animate the splash image itself                        |
| Hide `Skip` on the final onboarding screen                      | Leave it on "for completeness"                         |
| Show the dot indicator with one active pill-shaped dot          | Use three identical dots with a separate "current" tag |
| Animate `transform` (translate/scale/rotate) only               | Animate `top`, `left`, `width`, `height`               |
| Replay entrance animations on screen focus                      | Leave loops running on backgrounded screens            |
| Use `useFocusEffect` to gate continuous loops                   | Run infinite keyframes on hidden routes                |

---

## 8. Files for the implementer

### 8.1 Delete the default Expo react-logo placeholders

These 5 files are the default Expo template (React logo on a purple
background) and must be removed before the new brand ships:

```
client/assets/images/react-logo.png          # 6.2 KB   — DELETE
client/assets/images/react-logo@2x.png       # 13.9 KB  — DELETE
client/assets/images/react-logo@3x.png       # 20.7 KB  — DELETE
client/assets/images/partial-react-logo.png  # 5.0 KB   — DELETE
client/assets/images/favicon.png             # 1.1 KB   — DELETE (replace with 48x48 export)
```

To verify, grep the codebase for `react-logo` and `partial-react-logo`
— they should return zero references after the brand is in place.

### 8.2 Replace the icon assets

Export the SVGs in `client/assets/brand/` to PNGs and put them in
`client/assets/images/`, overwriting the default Expo files:

| Source SVG                    | Target file                              | Export size    | Notes |
|-------------------------------|------------------------------------------|----------------|-------|
| `monogram.svg`                | `icon.png`                               | 1024 × 1024    | iOS App Store + Android Play Store |
| `monogram.svg`                | `android-icon-foreground.png`            | 1024 × 1024    | Glyph sized at 432×432 in safe zone |
| `monogram.svg`                | `splash-icon.png`                        | 1024 × 1024    | With `resizeMode: contain` |
| `monochrome.svg`              | `android-icon-monochrome.png`            | 1024 × 1024    | Single-color, transparent bg |
| `wordmark.svg`                | _(no native slot — splash only via `monogram.png`)_ | —        | Used for marketing, not runtime |
| `monogram.svg`                | `favicon.png`                            | 48 × 48        | Web favicon (Expo also generates the rest) |

> **Easiest export path:** open each `.svg` in Figma, set the export
> preset to the target size, export as PNG-24 (lossless) at 2×
> device-pixel ratio for sharpness. Or use `svgexport` /
> `sharp` / `inkscape --export-type=png` from the command line.

### 8.3 Update `client/app.json`

Change the splash + adaptive-icon backgrounds to brand tokens. The
default Expo template ships with `#E6F4FE` (a pale blue) and `#ffffff`
— both wrong for the mint/cream brand.

```jsonc
{
  "expo": {
    "icon": "./assets/images/icon.png",
    "splash": {
      "image": "./assets/images/splash-icon.png",
      "backgroundColor": "#FBFAF6",   // was "#ffffff" (or "#E6F4FE")
      "resizeMode": "contain"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/android-icon-foreground.png",
        "backgroundColor": "#0E7C66"  // was "#ffffff"
      }
    },
    "ios": {
      "icon": "./assets/images/icon.png"
    }
  }
}
```

Then re-run `npx expo prebuild --clean` to regenerate the native
iOS / Android projects with the new assets.

### 8.4 Add the onboarding route

1. Create `client/app/onboarding/_layout.tsx` (a horizontal
   `PagerView` or `Animated.ScrollView` with snap) and three screen
   files: `index.tsx` (Screen 1), `study.tsx` (Screen 2),
   `cashout.tsx` (Screen 3).
2. Gate from `client/app/_layout.tsx` via the
   `onboardingCompleted` preference: when the user has no token and
   the flag is `false`, redirect to `/onboarding` before
   `/(auth)/login` or `/(tabs)`.
3. On Screen 3 "Get started" CTA tap: set the flag and
   `router.replace('/(auth)/register')`.

### 8.5 Implement `SplashOverlay`

Per the Reanimated 4 reference in §5.2. Mount it for the ~250 ms
window between `SplashScreen.hideAsync()` and the first paint of
the real route tree. The overlay must be dismissible the moment the
first real route is ready; it must not block.

No additional design work is required for the 3-onboarding copy;
`.kilo/steering.md:113` is the spec and is satisfied as written.
