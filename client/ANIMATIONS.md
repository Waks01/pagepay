# PagePay Animation Components

This guide documents the animated components available for PagePay auth screens and loading states.

---

## Components Overview

### 1. **AnimatedPageMark**
The mint-colored brand mark with multiple animation variants.

**Location:** `components/AnimatedPageMark.tsx`

**Variants:**
- `idle` - Static mark (no animation)
- `pulse` - Breathing effect (1.0 → 1.05 → 1.0 loop, 1.5s)
- `loading` - Rotating + pulsing opacity
- `success` - Scales up 1.3x (celebration moment)
- `error` - Flashes red + vibrates (3x shake)

**Usage:**
```tsx
import { AnimatedPageMark } from '@/components/AnimatedPageMark';

<AnimatedPageMark width={32} height={2} variant="pulse" />
```

**Props:**
- `width` (number) - Width of mark, default: 32
- `height` (number) - Height of mark, default: 2
- `variant` ('idle' | 'pulse' | 'loading' | 'success' | 'error') - Animation type

---

### 2. **PagePaySpinner**
Custom branded spinner using purple (outer ring) + green (inner ring) + mint center dot.

**Location:** `components/PagePaySpinner.tsx`

**Animation:**
- Outer ring rotates clockwise (2s full rotation)
- Inner ring rotates counter-clockwise (2.5s full rotation)
- Center dot pulses (1.0 → 1.3 → 1.0, 1.2s loop)

**Usage:**
```tsx
import { PagePaySpinner } from '@/components/PagePaySpinner';

<PagePaySpinner size={48} />
```

**Props:**
- `size` (number) - Diameter of spinner, default: 48

**Best for:**
- Form submission loading states
- Data fetching spinners
- General "please wait" indicators

---

### 3. **AuthScreenEntrance**
Header animation sequence for auth screens (login/registration).

**Location:** `components/AuthScreenEntrance.tsx`

**Animation Sequence:**
1. PageMark slides in from left + fades (0-300ms)
2. Title fades in (200-500ms)
3. Subtitle fades in (400-700ms)

**Usage:**
```tsx
import { AuthScreenEntrance } from '@/components/AuthScreenEntrance';

<AuthScreenEntrance 
  title="Welcome back"
  subtitle="Sign in to your PagePay account"
/>
```

**Props:**
- `title` (string) - Main heading text
- `subtitle` (string, optional) - Smaller descriptive text

**Best for:**
- Login screen headers
- Registration screen headers
- Onboarding screens

---

### 4. **AnimatedSubmitButton**
Submit button with state-based animations (idle, loading, success, error).

**Location:** `components/AnimatedSubmitButton.tsx`

**States:**
- `idle` - Shows text, ready to press (scale 0.96 on press)
- `loading` - Text fades out, spinner appears
- `success` - Spinner fades, checkmark appears, background confirmed
- `error` - Text shows, button flashes red, reverts after 1s

**Usage:**
```tsx
import { AnimatedSubmitButton } from '@/components/AnimatedSubmitButton';

const [isLoading, setIsLoading] = useState(false);
const [isSuccess, setIsSuccess] = useState(false);

const handleSubmit = async () => {
  setIsLoading(true);
  try {
    // API call
    setIsSuccess(true);
    setTimeout(() => setIsSuccess(false), 1500);
  } catch (err) {
    // Error state handled by parent
  } finally {
    setIsLoading(false);
  }
};

<AnimatedSubmitButton 
  title="Sign in"
  onPress={handleSubmit}
  isLoading={isLoading}
  isSuccess={isSuccess}
/>
```

**Props:**
- `title` (string) - Button text
- `onPress` (function) - Button press handler
- `isLoading` (boolean) - Show spinner state
- `isSuccess` (boolean) - Show checkmark state
- `isError` (boolean) - Show error state (flashes red)
- `disabled` (boolean) - Disable button

**Best for:**
- Form submission buttons
- Login/register buttons
- Any action that provides async feedback

---

## Integration Example: Full Login Screen

```tsx
import { useState } from 'react';
import { View, ScrollView, TextInput } from 'react-native';
import { AuthScreenEntrance, AnimatedSubmitButton, AnimatedPageMark } from '@/components/animations';
import { PagePay } from '@/constants/theme';

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isError, setIsError] = useState(false);

  const handleLogin = async () => {
    setIsLoading(true);
    setIsError(false);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      
      if (res.ok) {
        setIsSuccess(true);
        setTimeout(() => {
          // Navigate to home
        }, 1000);
      } else {
        setIsError(true);
      }
    } catch (err) {
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 24 }}>
      {/* Animated header */}
      <AuthScreenEntrance 
        title="Welcome back"
        subtitle="Sign in to continue reading and earning"
      />

      {/* Form fields */}
      <View style={{ gap: 12 }}>
        <TextInput
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          style={{ padding: 12, borderRadius: 8, borderWidth: 1 }}
        />
        <TextInput
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          style={{ padding: 12, borderRadius: 8, borderWidth: 1 }}
        />
      </View>

      {/* Animated submit button */}
      <AnimatedSubmitButton 
        title="Sign in"
        onPress={handleLogin}
        isLoading={isLoading}
        isSuccess={isSuccess}
        isError={isError}
      />
    </ScrollView>
  );
}
```

---

## Animation Timing Reference

| Component | Animation | Duration | Effect |
|-----------|-----------|----------|--------|
| AnimatedPageMark (pulse) | Scale breathing | 1.5s loop | 1.0 → 1.05 → 1.0 |
| AnimatedPageMark (loading) | Rotate + opacity | 2s + 1.2s | 360° spin + fade |
| AnimatedPageMark (success) | Scale up | 500ms | 1.0 → 1.3 |
| AnimatedPageMark (error) | Shake + color | 200ms × 3 | Scale vibration + red flash |
| PagePaySpinner (outer ring) | Rotation | 2000ms | Full 360° clockwise |
| PagePaySpinner (inner ring) | Rotation | 2500ms | Full 360° counter-clockwise |
| PagePaySpinner (dot) | Scale pulse | 1200ms loop | 1.0 → 1.3 → 1.0 |
| AuthScreenEntrance (mark) | Slide + fade | 300ms | Translate -50 → 0 |
| AuthScreenEntrance (title) | Fade | 200ms delay + 300ms | Opacity 0 → 1 |
| AuthScreenEntrance (subtitle) | Fade | 400ms delay + 300ms | Opacity 0 → 1 |
| AnimatedSubmitButton (press) | Scale | 100ms each | 1.0 → 0.96 → 1.0 |
| AnimatedSubmitButton (state change) | Fade | 200ms | Text/spinner/checkmark swap |

---

## Color Reference

- **Primary (Green/Mint):** `#00B894` (from PagePay theme)
- **Secondary (Purple):** `#6C5CE7` (from PagePay theme)
- **Error (Red/Signal):** Inherited from `PagePay[scheme].signal`

All colors automatically adapt to light/dark mode via `useEffectiveScheme()`.

---

## Performance Notes

- All animations use **Reanimated 3** for 60fps performance
- Animations run on the UI thread (not JavaScript thread)
- Safe to use multiple animations simultaneously
- No layout thrashing or jank during animations

---

## Next Steps

1. Integrate **AuthScreenEntrance** into your login/registration screens
2. Replace submit buttons with **AnimatedSubmitButton**
3. Use **PagePaySpinner** for data fetching states
4. Use **AnimatedPageMark** variants for form validation feedback

Questions? Check component files for inline documentation.
