# AniUI - Comprehensive Research Report

**Report Date:** October 30, 2026  
**Project:** PagePay  
**Official Website:** https://aniui.dev/  
**GitHub:** https://github.com/anishlp7/aniui

---

## Executive Summary

AniUI is a shadcn/ui-inspired component library for React Native. Unlike traditional npm packages, **AniUI copies component source files directly into your project** via CLI, giving you complete ownership and unlimited customization. With 148+ production-ready components, Uniwind styling (2-3x faster than NativeWind), and strict TypeScript, AniUI is perfect for building beautiful mobile apps.

### Key Benefits:
- ✅ **148+ components** - Advanced animations, carousels, charts, payment UI
- ✅ **You own the code** - No black-box dependencies, modify anything
- ✅ **2-3x faster** - Uniwind styling (default on Expo SDK 55+)
- ✅ **Free & Open Source** - MIT licensed
- ✅ **Accessibility-first** - Built on rn-primitives
- ✅ **TypeScript-strict** - Full type safety

---

## Installation & Setup

### Quick Start

```bash
# 1. Initialize AniUI in your project
npx @aniui/cli init

# 2. Add specific components
npx @aniui/cli add button card input

# 3. Install dependencies
npx expo install

# 4. Build (if you added native dependencies)
npx expo run:ios  # or android
```

### What Happens During Init

- Sets up **Uniwind** (Expo SDK 55+) or NativeWind (older versions)
- Creates `global.css` with theme variables
- Adds `lib/utils.ts` with the `cn()` helper
- Installs required dependencies
- Creates `.aniui.json` config file

---

## Core Concepts

### 1. Copy-Paste Approach

Unlike traditional libraries, AniUI components are **copied into your project**:

```
your-project/
├── components/
│   └── ui/           # ← AniUI components live here
│       ├── button.tsx
│       ├── card.tsx
│       └── input.tsx
└── lib/
    └── utils.ts      # ← Utility functions
```

**Benefits:**
- Edit any component directly
- No version conflicts or breaking changes
- Delete unused components
- Full transparency

### 2. Uniwind Styling (Fast!)

**Performance comparison** (rendering 2000+ views on iOS):
- Uniwind: **81ms** ⚡
- NativeWind 4: 197ms
- NativeWind 5: 258ms

Uniwind is built for Tailwind v4, CSS-first, no Babel transform.

### 3. Theme System

Themes are defined in `global.css`:

```css
@theme {
  --radius: 0.5rem;
}

@layer theme {
  :root {
    @variant light {
      --color-primary: hsl(240 5.9% 10%);
      --color-background: hsl(0 0% 100%);
      /* ... */
    }
    
    @variant dark {
      --color-primary: hsl(0 0% 98%);
      --color-background: hsl(240 10% 3.9%);
      /* ... */
    }
  }
}
```

Customize colors, spacing, typography globally.

---

## Component Library (148+ Components)

### Essential Components

#### **Forms & Input**
- `input` - Text input with variants
- `password-input` - Password with show/hide toggle & strength indicator
- `masked-input` - Auto-format for credit cards, phones, dates
- `input-otp` - OTP verification with individual cells
- `phone-input` - Phone number with country code selector
- `checkbox` - Checkbox with states
- `radio-group` - Radio buttons
- `switch` - Toggle switch
- `select` - Dropdown select
- `combobox` - Searchable select with multi-select
- `slider` - Draggable range slider
- `textarea` - Multi-line input

#### **Buttons & Actions**
- `button` - Primary button (5 variants, 3 sizes)
- `fab` - Floating action button
- `toggle` - Two-state toggle button
- `slide-to-confirm` - Slide-to-pay/confirm with spring-back
- `save-button` - State-machine button (idle → loading → success)

#### **Layout**
- `card` - Card with Header/Title/Content/Footer
- `separator` - Horizontal/vertical divider
- `accordion` - Expand/collapse sections
- `collapsible` - Animated show/hide
- `tabs` - Tab navigation with indicator
- `grid` - FlatList-based grid

#### **Overlays & Dialogs**
- `dialog` - Modal with fade + scale
- `alert-dialog` - Confirmation dialog
- `bottom-sheet` - Slide-up sheet
- `toast` - Notification with auto-dismiss
- `popover` - Contextual overlay
- `dropdown-menu` - Context menu
- `tooltip` - Fade-in tooltip

#### **Display**
- `text` - Typography (h1-h4, p, lead, large, small, muted)
- `avatar` - Image with fallback initials
- `avatar-group` - Overlapping avatar stack
- `badge` - Status indicator
- `alert` - Alert with variants
- `banner` - Full-width notification
- `stat-card` - KPI display with trend
- `empty-state` - Placeholder for empty lists

#### **Navigation**
- `header` - Navigation header
- `tabs` - Tab navigation
- `tab-bar` - Bottom tab bar
- `curved-bottom-tabs` - Animated curved notch tabs
- `breadcrumb` - Navigation trail
- `sidebar` - Collapsible side navigation

#### **Feedback & Loading**
- `progress` - Progress bar
- `spinner` - Loading spinner
- `skeleton` - Loading placeholder
- `shimmer` - Sweep/pulse loading
- `loader` - Bouncing dots or comet ring

#### **Payment-Specific Components**
- `masked-input` - Credit card formatting
- `input-otp` - Verification codes
- `slide-to-confirm` - Payment confirmation
- `qr-code` - Scannable QR codes
- `receipt-card` - Tilted receipt with torn edge
- `coupon` - Promo coupon with tear-line
- `price` - Formatted currency display

### Advanced Components

#### **Charts (Skia-based)**
- `area-chart` - Area chart with scrub tooltip
- `bar-chart` - Bar chart with staggered animation
- `line-chart` - Line chart with crosshair
- `pie-chart` - Pie/donut with slice push-out
- `radar-chart` - Radar/spider chart
- `radial-chart` - Concentric progress rings

#### **Carousels (7 types)**
- `carousel` - Horizontal with pagination dots
- `carousel-3d` - Cylinder with perspective
- `carousel-circular` - Coverflow with blur
- `carousel-parallax` - Parallax with haptics
- `carousel-scale` - Center-focused zoom
- `carousel-tilt` - Z-axis fan rotation
- `vertical-flow-carousel` - Tap-to-focus with tilt
- `vertical-page-carousel` - Full-bleed vertical pager

#### **Gooey/Morph Animations**
- `morph-fab` - Radial FAB with blob-merge
- `gooey-popover` - Morph trigger into content
- `gooey-search-tabs` - Morphing pill between search/tabs

#### **3D & Interactive**
- `flip-card` - 3D card flip
- `book-page` - Book with spine gradient
- `polaroid` - Photo with press-lift spring
- `photo-stack` - Overlapping stacked photos
- `swipe-deck` - Tinder-style swipeable stack
- `mobile-dock` - Fisheye magnification dock

#### **Specialized**
- `chat-bubble` - Sent/received message bubbles
- `prompt-input` - ChatGPT/Claude-style composer
- `streaming-text` - Typewriter with cursor
- `waveform` - Audio waveform bars
- `marquee` - Infinite horizontal ticker
- `rolling-counter` - Odometer-style counter

---

## Usage Examples

### Basic Button

```typescript
import { Button } from '@/components/ui/button';

<Button 
  variant="default"  // default | destructive | outline | secondary | ghost
  size="lg"          // sm | md | lg
  onPress={() => console.log('Pressed')}
>
  Get Started
</Button>
```

### Input with Password

```typescript
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';

<Input 
  placeholder="Email"
  value={email}
  onChangeText={setEmail}
/>

<PasswordInput
  placeholder="Password"
  value={password}
  onChangeText={setPassword}
  showStrength={true}  // Shows strength bar
/>
```

### Card Layout

```typescript
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

<Card>
  <CardHeader>
    <CardTitle>Welcome Back</CardTitle>
  </CardHeader>
  <CardContent>
    <Text>Your account is ready</Text>
  </CardContent>
  <CardFooter>
    <Button>Continue</Button>
  </CardFooter>
</Card>
```

### Payment Confirmation

```typescript
import { SlideToConfirm } from '@/components/ui/slide-to-confirm';

<SlideToConfirm
  onConfirm={handlePayment}
  text="Slide to Pay $99.99"
  successText="Payment Confirmed!"
/>
```

### OTP Input

```typescript
import { InputOTP } from '@/components/ui/input-otp';

<InputOTP
  length={6}
  value={otp}
  onChange={setOtp}
/>
```

### Toast Notifications

```typescript
import { toast } from '@/components/ui/toast';

// Success
toast.success('Payment successful!');

// Error
toast.error('Payment failed');

// Info
toast.info('Processing payment...');
```

---

## Customization

### Modifying Components

Since you own the code, customize freely:

```typescript
// Edit components/ui/button.tsx directly
export function Button({ variant = 'default', ...props }) {
  return (
    <Pressable
      className={cn(
        'rounded-lg px-4 py-2',
        variant === 'default' && 'bg-primary',
        variant === 'custom' && 'bg-brand-purple', // Add your variant
      )}
      {...props}
    />
  );
}
```

### Theming

Edit `global.css` to match your brand:

```css
@variant light {
  --color-primary: hsl(158 72% 34%);      /* PagePay green */
  --color-background: hsl(42 47% 98%);     /* Cream background */
  --color-accent: hsl(158 72% 44%);        /* Accent green */
}
```

---

## Integration with PagePay

### Recommended Components for PagePay

**Authentication:**
- `input` - Email/username
- `password-input` - Password with strength
- `input-otp` - Verification codes
- `button` - CTAs
- `card` - Container layouts

**Payments:**
- `masked-input` - Credit card/phone formatting
- `slide-to-confirm` - Payment confirmation
- `input-otp` - 2FA/verification
- `receipt-card` - Transaction receipts
- `qr-code` - Payment codes

**Dashboard:**
- `stat-card` - Balance, transactions, stats
- `area-chart` / `bar-chart` - Spending analytics
- `avatar` - User profile
- `badge` - Notifications
- `tabs` - Navigation

**UX:**
- `toast` - Feedback notifications
- `bottom-sheet` - Action menus
- `alert-dialog` - Confirmations
- `skeleton` - Loading states
- `empty-state` - No data placeholders

### Migration Strategy

1. **Start small** - Replace one component at a time
2. **Test thoroughly** - Use existing logic, just upgrade UI
3. **Customize** - Edit components to match PagePay brand
4. **Remove old** - Delete replaced custom components

---

## Performance Tips

1. **Only add what you need** - Don't use `--all` flag
2. **Lazy load heavy components** - Import on demand
3. **Optimize images** - Use proper formats
4. **Virtualize lists** - Use FlatList for long lists
5. **Memoize expensive renders** - Use React.memo

---

## Resources

- **Documentation:** https://aniui.dev/
- **GitHub:** https://github.com/anishlp7/aniui
- **Pro Templates:** https://pro.aniui.dev/
- **Academy:** https://academy.aniui.dev/
- **Uniwind Docs:** https://uniwind.dev/

---

## What's Next (Roadmap)

### Coming Soon: Foldable UI
- Adaptive components for foldable devices
- Apple Duo & Samsung foldable support
- Auto reflow when device opens/closes

---

## Quick Reference

### Essential Commands

```bash
# Initialize
npx @aniui/cli init

# Add components
npx @aniui/cli add button card input

# Force NativeWind instead of Uniwind
npx @aniui/cli init --style nativewind
```

### Import Pattern

```typescript
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
```

### Utility Function

```typescript
import { cn } from '@/lib/utils';

// Merge Tailwind classes
<View className={cn('flex-1 p-4', isActive && 'bg-primary')} />
```

---

## Conclusion

AniUI provides a modern, performant, and flexible approach to building React Native UIs. For PagePay, it offers professional payment components, beautiful animations, and full customization without vendor lock-in.

**Your PagePay Setup:**
- ✅ AniUI initialized with Uniwind
- ✅ 17 components installed
- ✅ Theme configured
- ✅ Ready to use

**Next:** Start using components in your screens and customize to match PagePay branding!

---

*Content rephrased for compliance with licensing restrictions. Sources: aniui.dev, github.com/anishlp7/aniui, uniwind.dev*
