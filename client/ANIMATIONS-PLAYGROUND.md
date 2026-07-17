# Animations Playground

A dedicated demo screen showcasing all PagePay animation components.

## Access

The playground is available at:
```
app/animations-playground.tsx
```

### To View

**Option 1: Direct URL (if Expo Router is configured)**
```
expo://animations-playground
```

**Option 2: Add to your app navigation**
In your main navigation or a dev screen, add:
```tsx
import AnimationsPlayground from '@/app/animations-playground';

// Or use router:
router.push('/animations-playground');
```

**Option 3: Temporary route during development**
The file is already in `app/` so it should auto-route if you're using Expo Router file-based routing.

## What You'll See

### 1. **Animated PageMark Section**
- Live demo of the mint brand mark
- 5 interactive buttons to switch variants:
  - `idle` - No animation
  - `pulse` - Breathing effect
  - `loading` - Rotate + fade
  - `success` - Scale up
  - `error` - Flash + vibrate
- Description of current variant

### 2. **PagePaySpinner Section**
- Live 64x64 branded spinner
- Animation breakdown:
  - Outer ring (purple) rotating clockwise
  - Inner ring (green) counter-clockwise
  - Center dot pulsing
- Perfect for understanding the spinner composition

### 3. **AuthScreenEntrance Section**
- Live header animation
- Shows title + subtitle entrance sequence
- Demonstrates staggered animation timing

### 4. **AnimatedSubmitButton Section**
- Interactive button you can tap
- Auto-simulates success/error (70% success, 30% fail)
- Shows all states in action:
  - Idle (tap to submit)
  - Loading (2s delay with spinner)
  - Success (checkmark appears)
  - Error (red flash, then back)

### 5. **Quick Start Section**
- Copy-paste code example
- Shows basic integration pattern
- Points to full documentation

## Interactive Testing

### AnimatedPageMark
Tap each variant button to see the animation live.

### AnimatedSubmitButton
Tap "Submit" button to trigger:
1. Loading state (spinner appears for 2s)
2. Random success or error outcome
3. Automatic reset after 1.5s

Test multiple times to see different outcomes.

## Mobile Testing

**On Android/iOS emulator or device:**

```bash
npm start
# Then press 'a' for Android or 'i' for iOS
```

Navigate to the animations playground from your app's navigation or access directly if using Expo Router.

## Making Changes

The playground auto-updates. Edit component files and see changes instantly (with fast refresh).

**To test animation timing changes:**
1. Edit the duration in the component (e.g., `AnimatedPageMark.tsx`)
2. Save the file
3. See changes immediately in the playground

## Component File Locations

- `components/AnimatedPageMark.tsx` - Brand mark animations
- `components/PagePaySpinner.tsx` - Branded spinner
- `components/AuthScreenEntrance.tsx` - Screen header animation
- `components/AnimatedSubmitButton.tsx` - Smart submit button

## Exporting for Actual Use

Once you're happy with the animations:

**1. Integrate into auth screens:**
```tsx
import { AuthScreenEntrance, AnimatedSubmitButton } from '@/components/animations';

// In your login screen
<AuthScreenEntrance title="Sign in" subtitle="Welcome back" />
<AnimatedSubmitButton title="Sign in" onPress={handleLogin} isLoading={loading} />
```

**2. Use spinner for loading states:**
```tsx
import { PagePaySpinner } from '@/components/animations';

{isLoading ? <PagePaySpinner size={48} /> : <Content />}
```

**3. Use PageMark for feedback:**
```tsx
import { AnimatedPageMark } from '@/components/animations';

{isSuccess && <AnimatedPageMark variant="success" />}
{isError && <AnimatedPageMark variant="error" />}
```

## Tips

- All animations are **60fps smooth** (Reanimated handles timing)
- Colors automatically adapt to **dark/light mode**
- **No dependencies added** (uses existing Reanimated)
- Safe to use **multiple animations together**

## Next Steps

1. Explore animations in the playground
2. Use ANIMATIONS.md as reference
3. Integrate into auth screens
4. Customize timing/colors as needed

Enjoy! 🎬
