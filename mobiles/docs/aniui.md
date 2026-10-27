# AniUI Documentation

Complete guide for using AniUI - Beautiful React Native components. Copy. Paste. Ship.

## Table of Contents
- [Overview](#overview)
- [Installation](#installation)
- [CLI Commands](#cli-commands)
- [Theming](#theming)
- [Dark Mode](#dark-mode)
- [Theme Provider](#theme-provider)
- [Component List](#component-list)
- [Usage Patterns](#usage-patterns)
- [Best Practices](#best-practices)

## Overview

AniUI is a collection of 150+ reusable components for React Native, built with:
- **Uniwind** (recommended) or **NativeWind** (Tailwind CSS for React Native)
- **rn-primitives** for accessibility
- **TypeScript** with strict mode
- **class-variance-authority (cva)** for variants
- **lucide-react-native** for icons

Key features:
- You own the code - components are copied as source files, not npm dependencies
- Accessible with proper ARIA roles and keyboard navigation
- Dark mode support via CSS variables
- Fully customizable with Tailwind classes
- Works with Expo SDK 53+ and bare React Native CLI 0.76+

## Installation

### Quick Setup (Recommended)

1. Create a React Native project:
`ash
# Expo
npx create-expo-app@latest my-app
cd my-app

# Bare RN
npx @react-native-community/cli init MyApp
cd MyApp
`

2. Initialize AniUI:
`ash
npx @aniui/cli init

# Or with specific styling engine
npx @aniui/cli init --style uniwind
`

The CLI will:
- Detect project type (Expo/Bare RN), SDK version, package manager
- Ask for styling engine (NativeWind or Uniwind), theme preset, TypeScript preference
- Install dependencies (nativewind/uniwind, tailwindcss, reanimated, cva, clsx, etc.)
- Create config files (metro.config.js, babel.config.js, tailwind.config.js, global.css)
- Create lib/utils.ts and components/ui/ directory

3. Import global.css in your app entry:
`	sx
// app/_layout.tsx or App.tsx
import "./global.css";
// ... rest
`

4. Add components and start:
`ash
npx @aniui/cli add button text input card
npx expo start -c
`

### Overlay Components Setup

Components using @rn-primitives (Dialog, Popover, Select, Bottom Sheet, etc.) need PortalHost in root layout:

`	sx
import { PortalHost } from "@rn-primitives/portal";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack />
      <PortalHost />
    </GestureHandlerRootView>
  );
}
`

## CLI Commands

| Command | Description | Usage |
| --- | --- | --- |
| init | Initialize AniUI in project | 
px @aniui/cli init |
| dd | Add components to project | 
px @aniui/cli add button card dialog |
| dd-block | Add pre-built screen templates | 
px @aniui/cli add-block login signup |
| 	heme | Switch theme presets | 
px @aniui/cli theme |
| generate | Generate screen with AI (requires ANTHROPIC_API_KEY) | 
px @aniui/cli generate \"login page\" |
| mcp | Output MCP config for AI tools | 
px @aniui/cli mcp |
| doctor | Diagnose setup issues | 
px @aniui/cli doctor |
| status | Check installed components and updates | 
px @aniui/cli status |
| diff | Show diff between local and upstream | 
px @aniui/cli diff button |
| update | Update components (with merge strategies) | 
px @aniui/cli update button |

## Theming

### How It Works
AniUI uses CSS custom properties in global.css mapped to Tailwind classes. Colors use HSL format without hsl() wrapper for opacity modifiers.

### Color Tokens
| Token | Classes | Purpose |
| --- | --- | --- |
| --background | g-background, 	ext-foreground | Page background |
| --primary | g-primary, 	ext-primary-foreground | Buttons, links, primary actions |
| --secondary | g-secondary, 	ext-secondary-foreground | Secondary actions |
| --muted | g-muted, 	ext-muted-foreground | Subtle backgrounds, helper text |
| --accent | g-accent, 	ext-accent-foreground | Highlights, hover states |
| --destructive | g-destructive, 	ext-destructive-foreground | Errors, delete actions |
| --card | g-card, 	ext-card-foreground | Card surfaces |
| --border | order-border | Borders, dividers |
| --input | g-input | Input backgrounds |

### Theme Presets
Available via 
px @aniui/cli theme:
- **Default** - Neutral light/dark
- **Blue** - Primary: #3B82F6
- **Green** - Primary: #22C55E
- **Orange** - Primary: #F97316
- **Rose** - Primary: #F43F5E

### Custom Theming
Edit global.css:
`css
:root {
  --primary: 262 83% 58%;          /* purple */
  --primary-foreground: 0 0% 100%;
}
.dark {
  --primary: 262 83% 68%;
  --primary-foreground: 0 0% 100%;
}
`

Values are in HSL format (hue saturation% lightness%) without hsl() wrapper.

### Adding Custom Tokens
1. Define in global.css for light and dark:
`css
:root {
  --success: 142 76% 36%;
  --success-foreground: 0 0% 100%;
}
.dark {
  --success: 142 76% 46%;
  --success-foreground: 0 0% 100%;
}
`

2. Map in 	ailwind.config.js:
`js
theme: {
  extend: {
    colors: {
      success: {
        DEFAULT: "hsl(var(--success))",
        foreground: "hsl(var(--success-foreground))",
      },
    },
  },
}
`

3. Use: <View className=\"bg-success\"><Text className=\"text-success-foreground\">...</Text></View>

## Dark Mode

AniUI supports dark mode via CSS variables. Toggle using className=\"dark\" on root or use theme switching.

## Component List

### Buttons
- Button, FAB, Social Button, Flexi Button, Save Button, Spin Button

### Foundation
- Animate, Aspect Ratio, Badge, Card, Direction Provider, Gradient, Kbd, Keyboard View, Labeled Separator, Safe Area, Separator, Text

### Forms & Inputs
**Text Inputs:** Input, Textarea, Password Input, Masked Input, Phone Input, Number Input, Search Bar, Input OTP, Input Group, Field, Label, Form

**Selection Controls:** Checkbox, Radio Group, Switch, Toggle, Toggle Group, Segmented Control, Slider, Rating, Stepper, Chip

**Pickers:** Date Picker, Time Picker, Date & Time Picker, Calendar, Select, Combobox, AutoComplete, File Picker

### Feedback & Status
- Alert, Banner, Connection Banner, Empty State, Progress, Progress Steps, Status Indicator, Toast

### Overlays & Menus
**Dialogs & Sheets:** Dialog, Alert Dialog, Bottom Sheet, Drawer, Action Sheet, Tray

**Menus:** Dropdown Menu, Context Menu, Command Menu, Unfold Menu, Fan Menu

**Popovers & Tooltips:** Popover, Tooltip, Hover Card, Gooey Popover

**Panels:** Action Rail, Split View, Expandable View

### Navigation
**Tab & Bottom Navigation:** Tab Bar, Tabs, Curved Bottom Tabs, Animated Tabs, App Dock

**Structure:** Accordion, Breadcrumb, Collapsible, Header, Animated Header ScrollView, Menubar, Pagination, Sidebar

### Data Display & Media
- Avatar, Avatar Group, Data Table, Grid, Image, Image Gallery, Infinite List, List, Price, Refresh Control, Stat Card, Table, Timeline

### Carousels
- Carousel, 3D Carousel, Parallax Carousel, Circular Carousel, Carousel Scale, Carousel Tilt, Vertical Flow Carousel, Vertical Page Carousel

### Loaders
- Skeleton, Spinner, Shimmer, Loader

### UI Pieces
**Cards & Tickets:** Event Ticket, Receipt Card, Coupon, Polaroid, Profile Card, Photo Stack, Book Page

**Identity & Social:** Barcode Badge, Verified Badge, QR Code, Number Counter

### Motion & Effects
- Flip Card, Marquee, Hamburger, Theme Switch, Matched Geometry, Stacked Chips, Filling Stack, Animated Input Bar, Arc List, Morph Fab, Gooey Search Tabs

### Chat & AI
- Chat Bubble, Prompt Input, Streaming Text, Typing Indicator, Waveform

### Gestures & Actions
- Slide to Confirm, Swipe Deck, Swipeable List Item

### Charts
- Area Chart, Bar Chart, Line Chart, Pie Chart, Radar Chart, Radial Chart, Tooltip

### Blocks (Pre-built Screens)
- Login, Sign Up, Forgot Password, Home Screen, Bottom Tabs, Drawer Navigation, Profile, Settings, Onboarding, Chat, Product List, Product Detail, Notifications, Pricing, Search

## Usage Patterns

### Basic Component Usage
`	sx
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

export default function Screen() {
  return (
    <Button onPress={() => console.log("Pressed")}>
      <Text>Click Me</Text>
    </Button>
  );
}
`

### Using Variants
`	sx
<Button variant="destructive" size="lg">
  <Text>Delete</Text>
</Button>
`

### Composing Components
`	sx
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function LoginCard() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Login</CardTitle>
      </CardHeader>
      <CardContent className="gap-4">
        <View className="gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" placeholder="email@example.com" />
        </View>
        <Button>
          <Text>Sign In</Text>
        </Button>
      </CardContent>
    </Card>
  );
}
`

## Best Practices

1. **Use CLI to add components** - 
px @aniui/cli add [component] ensures dependencies are handled
2. **Own and customize** - Edit components directly in components/ui/ to fit your needs
3. **Use semantic tokens** - Prefer g-primary over hardcoded colors for theme consistency
4. **Add PortalHost for overlays** - Required for Dialog, Popover, Select, Bottom Sheet, etc.
5. **Run doctor on issues** - Use 
px @aniui/cli doctor to debug setup problems
6. **Clear cache on style issues** - 
px expo start -c resolves most styling issues
7. **Check component docs** - Each component may have specific dependencies (e.g., Skeleton needs reanimated)
8. **Use blocks for speed** - 
px @aniui/cli add-block [block] for pre-built screens

## Resources
- Website: [https://www.aniui.dev](https://www.aniui.dev)
- Docs: [https://www.aniui.dev/docs](https://www.aniui.dev/docs)
- Components: [https://www.aniui.dev/docs/components](https://www.aniui.dev/docs/components)
- GitHub: [https://github.com/anishlp7/aniui](https://github.com/anishlp7/aniui)
