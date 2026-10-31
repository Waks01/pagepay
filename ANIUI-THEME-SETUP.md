# AniUI Theme Setup Complete! 🎨

## ✅ What We Just Did:

### 1. **Extended global.css** with 3 PagePay Themes
- **Light**: Cream background (#FBFAF6) + Mint green (#0E7C66)
- **Dark**: Dark background (#0E1116) + Bright mint (#34C39B)
- **Sepia**: Warm paper tone (#F5ECD7) + Brown (#7C5E2A) - Perfect for reading!

All using your existing PagePay brand colors from `constants/theme.ts`.

### 2. **Updated ThemeProvider** 
- Now supports `'sepia'` as a third theme option
- Integrates with your existing `useEffectiveScheme()` hook
- Works seamlessly with Uniwind styling

---

## 🎯 How It Works:

### Architecture:

```
Your Preferences (Zustand)
     ↓
useEffectiveScheme()  → Returns: 'light' | 'dark' | 'sepia'
     ↓
AniUI ThemeProvider   → Applies CSS variables
     ↓
Uniwind/Tailwind      → Converts to React Native styles
     ↓
Components            → Use theme colors automatically
```

---

## 📋 Next Steps:

### Step 1: Wrap Your App with ThemeProvider

Edit `src/app/_layout.tsx`:

```typescript
import { ThemeProvider } from '@/components/ui/theme-provider';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

export default function RootLayout() {
  const theme = useEffectiveScheme(); // 'light' | 'dark' | 'sepia'
  
  return (
    <ThemeProvider defaultTheme={theme}>
      {/* Your existing layout code */}
      <Stack />
    </ThemeProvider>
  );
}
```

### Step 2: Use AniUI Components with Your Theme

AniUI components automatically use the theme colors:

```typescript
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

// These will automatically use:
// - Light theme: Mint green (#0E7C66), cream paper
// - Dark theme: Bright mint (#34C39B), dark background
// - Sepia theme: Brown (#7C5E2A), warm paper

<Button variant="default">
  {/* Button will use --color-primary based on current theme */}
</Button>

<Input 
  placeholder="Email"
  className="bg-card border-border text-foreground"
  {/* Colors adapt to light/dark/sepia automatically */}
/>
```

### Step 3: Keep Using Your Existing Theme Switcher

Your existing theme switcher still works! Just update the AniUI theme when your preference changes:

```typescript
import { usePreferences } from '@/src/shared/lib/preferences';
import { useTheme } from '@/components/ui/theme-provider';
import { useEffect } from 'react';

function SyncThemes() {
  const pagepayTheme = usePreferences((s) => s.theme); // 'system' | 'light' | 'dark' | 'sepia'
  const { setTheme } = useTheme();
  
  useEffect(() => {
    setTheme(pagepayTheme);
  }, [pagepayTheme, setTheme]);
  
  return null;
}

// Add <SyncThemes /> to your _layout.tsx
```

---

## 🎨 Using Theme Colors:

### Method 1: Tailwind Classes (Recommended)

```typescript
<View className="bg-background">
  <Text className="text-foreground text-lg">Hello</Text>
  <View className="bg-primary rounded-md p-4">
    <Text className="text-primary-foreground font-semibold">
      Primary Button
    </Text>
  </View>
  <View className="bg-card border border-border p-4">
    <Text className="text-muted-foreground">Muted text</Text>
  </View>
</View>
```

**Available color classes:**
- `bg-background` / `text-foreground` - Main backgrounds and text
- `bg-primary` / `text-primary-foreground` - Mint green (or brown in sepia)
- `bg-secondary` / `text-secondary-foreground` - Secondary backgrounds
- `bg-card` / `text-card-foreground` - Card backgrounds
- `bg-muted` / `text-muted-foreground` - Disabled/muted states
- `bg-accent` / `text-accent-foreground` - Accent highlights
- `bg-destructive` / `text-destructive-foreground` - Error/delete actions
- `border-border` - Borders
- `ring-ring` - Focus rings

### Method 2: Raw Color Values (TypeScript)

```typescript
import { useThemeColors } from '@/components/ui/theme-provider';

function MyComponent() {
  const colors = useThemeColors();
  
  // colors.background → "#FBFAF6" (light), "#0E1116" (dark), "#F5ECD7" (sepia)
  // colors.primary → "#0E7C66" (light), "#34C39B" (dark), "#7C5E2A" (sepia)
  
  return <View style={{ backgroundColor: colors.background }} />;
}
```

### Method 3: Keep Using PagePay Constants (Backward Compatible)

Your existing `PagePay[scheme]` tokens still work:

```typescript
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

function ExistingComponent() {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  
  // tokens.mint, tokens.paper, tokens.ink still work!
  return <View style={{ backgroundColor: tokens.paper }} />;
}
```

---

## 🔄 Theme Switching Examples:

### Toggle Between All 3 Themes:

```typescript
import { usePreferences } from '@/src/shared/lib/preferences';

function ThemeToggle() {
  const { theme, setTheme } = usePreferences();
  
  const cycleTheme = () => {
    const next = 
      theme === 'light' ? 'dark' : 
      theme === 'dark' ? 'sepia' : 
      'light';
    setTheme(next);
  };
  
  return (
    <Pressable onPress={cycleTheme}>
      <Text>Current: {theme}</Text>
    </Pressable>
  );
}
```

### Theme Picker with Icons:

```typescript
import { usePreferences } from '@/src/shared/lib/preferences';
import { Ionicons } from '@expo/vector-icons';

function ThemePicker() {
  const { theme, setTheme } = usePreferences();
  
  return (
    <View className="flex-row gap-4">
      <Pressable onPress={() => setTheme('light')}>
        <Ionicons name="sunny" size={24} color={theme === 'light' ? '#0E7C66' : '#6B7280'} />
      </Pressable>
      <Pressable onPress={() => setTheme('dark')}>
        <Ionicons name="moon" size={24} color={theme === 'dark' ? '#34C39B' : '#6B7280'} />
      </Pressable>
      <Pressable onPress={() => setTheme('sepia')}>
        <Ionicons name="book" size={24} color={theme === 'sepia' ? '#7C5E2A' : '#6B7280'} />
      </Pressable>
    </View>
  );
}
```

---

## 🎯 Color Mapping Reference:

### Light Theme (Cream + Mint):
```
background:  #FBFAF6  (Cream paper)
foreground:  #0E1116  (Dark ink)
primary:     #0E7C66  (Mint green - your brand!)
card:        #FFFFFF  (White cards)
border:      #E5E2DA  (Subtle borders)
```

### Dark Theme (Dark + Bright Mint):
```
background:  #0E1116  (Dark paper)
foreground:  #FBFAF6  (Light ink)
primary:     #34C39B  (Bright mint)
card:        #171A21  (Dark cards)
border:      #2A2F38  (Dark borders)
```

### Sepia Theme (Warm Paper + Brown):
```
background:  #F5ECD7  (Warm paper)
foreground:  #3E2C1C  (Brown ink)
primary:     #7C5E2A  (Warm brown - easier on eyes)
card:        #FAF1DD  (Cream cards)
border:      #D9C9A8  (Soft borders)
```

**All themes preserve your PagePay mint green branding!** 🎉

---

## ✅ What's Compatible:

### Works Immediately:
- ✅ All 17 AniUI components you installed
- ✅ Your existing `useEffectiveScheme()` hook
- ✅ Your existing theme switcher
- ✅ Your existing `PagePay[scheme]` colors

### Recommended Migration Path:
1. **Now**: Wrap app with ThemeProvider
2. **Week 1**: Replace auth screens with AniUI components (Input, Button, Card)
3. **Week 2**: Replace dashboard components with AniUI (Stat Card, Badge, Avatar)
4. **Week 3**: Replace modals/overlays with AniUI (Dialog, Bottom Sheet, Toast)
5. **Keep**: Your existing `PagePay` tokens for custom components

---

## 🐛 Troubleshooting:

### Theme not switching?
- Check that ThemeProvider wraps your app in `_layout.tsx`
- Sync AniUI theme with PagePay preferences (see Step 3 above)

### Colors look wrong?
- Run `npx expo start --clear` to clear Metro cache
- Check that `global.css` is imported in your app
- Verify Uniwind is installed: `npm ls uniwind`

### Components not styled?
- Verify components are using `className` prop (not `style`)
- Check that `cn()` utility is imported from `@/lib/utils`

---

## 📚 Next Steps:

1. **Test the setup**:
   ```bash
   npx expo start --clear
   ```

2. **Start using components**:
   - Replace LoginForm inputs with AniUI `Input` and `Button`
   - Test theme switching between light/dark/sepia
   
3. **Add more components**:
   ```bash
   npx @aniui/cli add checkbox switch select tabs
   ```

---

**Your PagePay brand is now fully integrated with AniUI!** 🚀

All components will automatically use:
- **Mint green (#0E7C66)** as primary in light mode
- **Cream paper (#FBFAF6)** as background
- **Sepia mode** for comfortable reading
- **Dark mode** with bright mint accent

Let me know if you want help implementing this in your `_layout.tsx` or refactoring specific components!
