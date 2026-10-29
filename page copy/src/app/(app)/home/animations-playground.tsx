import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { PagePay, Fonts } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import {
  AnimatedPageMark,
  PagePaySpinner,
  AuthScreenEntrance,
  AnimatedSubmitButton,
} from '@/components/animations';

/**
 * Animations Playground - Demo screen for all PagePay animation components.
 *
 * This screen showcases:
 * 1. AnimatedPageMark (all 5 variants)
 * 2. PagePaySpinner
 * 3. AuthScreenEntrance
 * 4. AnimatedSubmitButton (all states)
 *
 * Access via: expo://animations-playground (or add to your router)
 */
export default function AnimationsPlayground() {
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  // AnimatedPageMark variant controls
  const [markVariant, setMarkVariant] = useState<
    'idle' | 'pulse' | 'loading' | 'success' | 'error'
  >('pulse');

  // AnimatedSubmitButton state controls
  const [buttonLoading, setButtonLoading] = useState(false);
  const [buttonSuccess, setButtonSuccess] = useState(false);
  const [buttonError, setButtonError] = useState(false);

  const handleButtonPress = async () => {
    setButtonLoading(true);
    setButtonError(false);
    setButtonSuccess(false);

    // Simulate API call (2s delay)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Randomly succeed or fail for demo
    const shouldSucceed = Math.random() > 0.3;

    if (shouldSucceed) {
      setButtonSuccess(true);
      setTimeout(() => setButtonSuccess(false), 1500);
    } else {
      setButtonError(true);
      setTimeout(() => setButtonError(false), 1500);
    }

    setButtonLoading(false);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tokens.paper }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Ionicons name="chevron-back" size={24} color={tokens.ink} />
        </Pressable>
        <Text style={[styles.title, { color: tokens.ink, fontFamily: Fonts.display }]}>
          Animations
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Section 1: AnimatedPageMark Variants */}
        <View style={[styles.section, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[styles.sectionTitle, { color: tokens.ink, fontFamily: Fonts.display }]}>
            Animated PageMark
          </Text>
          <Text style={[styles.sectionDesc, { color: tokens.inkMuted }]}>
            Brand mark with 5 animation variants. Tap buttons to switch.
          </Text>

          {/* Mark Display */}
          <View style={styles.demoBox}>
            <AnimatedPageMark width={48} height={3} variant={markVariant} />
          </View>

          {/* Variant Buttons */}
          <View style={styles.buttonGrid}>
            {(['idle', 'pulse', 'loading', 'success', 'error'] as const).map(
              (variant) => (
                <Pressable
                  key={variant}
                  onPress={() => setMarkVariant(variant)}
                  style={[
                    styles.smallButton,
                    {
                      backgroundColor:
                        markVariant === variant ? tokens.mint : tokens.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.smallButtonText,
                      {
                        color:
                          markVariant === variant ? '#fff' : tokens.inkMuted,
                      },
                    ]}
                  >
                    {variant}
                  </Text>
                </Pressable>
              )
            )}
          </View>

          <View style={styles.divider} />

          {/* Description */}
          <View style={styles.descBox}>
            <Text style={[styles.desc, { color: tokens.ink }]}>
              <Text style={{ fontWeight: '600' }}>Current:</Text> {markVariant}
            </Text>
            <Text style={[styles.descSmall, { color: tokens.inkMuted }]}>
              {markVariant === 'idle' && 'Static, no animation.'}
              {markVariant === 'pulse' &&
                'Breathing effect (1.0 → 1.05 → 1.0, 1.5s loop)'}
              {markVariant === 'loading' && 'Rotating + pulsing opacity'}
              {markVariant === 'success' && 'Scales up to 1.3x (celebration)'}
              {markVariant === 'error' && 'Flashes red + vibrates (3x shake)'}
            </Text>
          </View>
        </View>

        {/* Section 2: PagePaySpinner */}
        <View style={[styles.section, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[styles.sectionTitle, { color: tokens.ink, fontFamily: Fonts.display }]}>
            PagePay Spinner
          </Text>
          <Text style={[styles.sectionDesc, { color: tokens.inkMuted }]}>
            Branded loading spinner (purple + green + mint).
          </Text>

          {/* Spinner Display */}
          <View style={styles.demoBox}>
            <PagePaySpinner size={64} />
          </View>

          {/* Description */}
          <View style={styles.descBox}>
            <Text style={[styles.desc, { color: tokens.ink }]}>
              <Text style={{ fontWeight: '600' }}>Animation:</Text>
            </Text>
            <Text style={[styles.descSmall, { color: tokens.inkMuted }]}>
              • Outer ring (purple): 360° clockwise in 2s{'\n'}
              • Inner ring (green): 360° counter-clockwise in 2.5s{'\n'}
              • Center dot (mint): Pulses 1.0 → 1.3 → 1.0 in 1.2s
            </Text>
          </View>
        </View>

        {/* Section 3: AuthScreenEntrance */}
        <View style={[styles.section, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[styles.sectionTitle, { color: tokens.ink, fontFamily: Fonts.display }]}>
            Auth Screen Entrance
          </Text>
          <Text style={[styles.sectionDesc, { color: tokens.inkMuted }]}>
            Staggered header animation for auth screens.
          </Text>

          {/* Entrance Animation Display */}
          <View style={[styles.demoBox, { paddingVertical: 20 }]}>
            <AuthScreenEntrance
              title="Welcome to PagePay"
              subtitle="Sign in to read, earn, and learn"
            />
          </View>

          {/* Description */}
          <View style={styles.descBox}>
            <Text style={[styles.desc, { color: tokens.ink }]}>
              <Text style={{ fontWeight: '600' }}>Sequence:</Text>
            </Text>
            <Text style={[styles.descSmall, { color: tokens.inkMuted }]}>
              1. PageMark slides in from left (0-300ms){'\n'}
              2. Title fades in (200-500ms){'\n'}
              3. Subtitle fades in (400-700ms)
            </Text>
          </View>
        </View>

        {/* Section 4: AnimatedSubmitButton */}
        <View style={[styles.section, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[styles.sectionTitle, { color: tokens.ink, fontFamily: Fonts.display }]}>
            Animated Submit Button
          </Text>
          <Text style={[styles.sectionDesc, { color: tokens.inkMuted }]}>
            Smart button with state-based animations. Tap to submit.
          </Text>

          {/* Button Display */}
          <View style={styles.demoBox}>
            <AnimatedSubmitButton
              title="Submit"
              onPress={handleButtonPress}
              isLoading={buttonLoading}
              isSuccess={buttonSuccess}
              isError={buttonError}
            />
          </View>

          {/* Description */}
          <View style={styles.descBox}>
            <Text style={[styles.desc, { color: tokens.ink }]}>
              <Text style={{ fontWeight: '600' }}>States:</Text>
            </Text>
            <Text style={[styles.descSmall, { color: tokens.inkMuted }]}>
              • Idle: Shows text, scales 0.96 on press{'\n'}
              • Loading: Text fades, spinner appears{'\n'}
              • Success: Checkmark appears, green background{'\n'}
              • Error: Flashes red, text returns
            </Text>
          </View>
        </View>

        {/* Section 5: Integration Example */}
        <View style={[styles.section, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[styles.sectionTitle, { color: tokens.ink, fontFamily: Fonts.display }]}>
            Quick Start
          </Text>
          <Text style={[styles.sectionDesc, { color: tokens.inkMuted }]}>
            Copy-paste example for your auth screens.
          </Text>

          <View
            style={[
              styles.codeBlock,
              { backgroundColor: tokens.paper, borderColor: tokens.border },
            ]}
          >
            <Text style={[styles.code, { color: tokens.ink, fontFamily: 'monospace' }]}>
              {`import {
  AuthScreenEntrance,
  AnimatedSubmitButton,
} from '@/components/animations';

<AuthScreenEntrance 
  title="Sign in"
  subtitle="Your subtitle"
/>

<AnimatedSubmitButton 
  title="Submit"
  onPress={handleSubmit}
  isLoading={loading}
  isSuccess={success}
/>`}
            </Text>
          </View>

          <Text style={[styles.descSmall, { color: tokens.inkMuted, marginTop: 12 }]}>
            See ANIMATIONS.md for full documentation.
          </Text>
        </View>

        {/* Footer */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 16,
    paddingBottom: 20,
  },
  section: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  sectionDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  demoBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  buttonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  smallButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: '22%',
    alignItems: 'center',
  },
  smallButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.1)',
    marginVertical: 12,
  },
  descBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.02)',
    gap: 6,
  },
  desc: {
    fontSize: 13,
    fontWeight: '500',
  },
  descSmall: {
    fontSize: 12,
    lineHeight: 18,
  },
  codeBlock: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginVertical: 12,
  },
  code: {
    fontSize: 11,
    lineHeight: 16,
  },
});
