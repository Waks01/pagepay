# Language Translation Setup (ML Kit - Free & Offline)

## Overview
Using **Google ML Kit Translation** for on-device, offline translation:
- ✅ 100% Free (no API key required)
- ✅ Offline support (after model download)
- ✅ Supports: English, Yoruba, Hausa, Igbo
- ⚠️ Pidgin not supported (fallback to English)

## Installation

```bash
cd client
npm install react-native-mlkit-translate
npx pod-install # iOS only
```

## Supported Languages
- **English (en)** - Default, no download needed
- **Yoruba (yo)** - ML Kit supported
- **Hausa (ha)** - ML Kit supported  
- **Igbo (ig)** - ML Kit supported
- **Pidgin (pcm)** - Not supported, uses English fallback

## How It Works

### 1. First Time Use
- User selects language in Profile → Language
- App prompts to download language model (~15MB)
- Model downloads once, cached on device
- Translation works offline after download

### 2. Translation Flow
```
English text → ML Kit Translate (on-device) → Translated text
```

### 3. Caching
- Translations are cached in memory
- No re-translation for repeated strings
- Cache cleared on app restart

## Usage in Components

```tsx
import { useTranslation } from '@/src/lib/i18n';

function MyComponent() {
  const [text, isLoading] = useTranslation('Hello, welcome to PagePay!');
  
  return <Text>{text}</Text>;
}
```

## Files Created
1. `client/src/lib/translator.ts` - ML Kit wrapper
2. `client/src/lib/i18n.ts` - Translation system with cache
3. Updated `client/app/(tabs)/profile.tsx` - Language selection with download prompt

## Next Steps
1. Install package: `npm install react-native-mlkit-translate`
2. Rebuild dev client: `npx expo run:android`
3. Test language selection in Profile
4. Download a language model and test offline

## Limitations
- Pidgin (Nigerian English creole) not in ML Kit
- Translation quality: Good but not perfect
- First translation may be slow (model initialization)
- Each language model: 10-30MB storage

## Future Improvements
- Add Pidgin custom dictionary
- Pre-translate common strings at build time
- Add language model management screen
- Show download progress bar
