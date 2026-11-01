/**
 * Test Screen for CustomSlider
 * 
 * Navigate to this screen to test the slider in isolation:
 * - In dev: expo-router will pick this up at /(app)/test-slider
 * - Or manually navigate: router.push('/(app)/test-slider')
 * 
 * DELETE THIS FILE after confirming slider works!
 */

import { useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { CustomSlider } from "@/src/components/bills/CustomSlider";
import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";

export default function TestSliderScreen() {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [value1, setValue1] = useState(50);
  const [value2, setValue2] = useState(25);
  const [value3, setValue3] = useState(75);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.paper }}
      contentContainerStyle={styles.container}
    >
      <Text style={[styles.title, { color: tokens.ink }]}>
        CustomSlider Test 🎨
      </Text>

      <Text style={[styles.subtitle, { color: tokens.inkMuted }]}>
        Pure JavaScript slider - no native rebuild required!
      </Text>

      {/* Test 1: Basic slider */}
      <View style={[styles.card, { backgroundColor: tokens.card }]}>
        <Text style={[styles.cardTitle, { color: tokens.ink }]}>
          Basic Slider
        </Text>
        <Text style={[styles.valueText, { color: tokens.mint }]}>
          Value: {value1.toFixed(0)}%
        </Text>
        <CustomSlider
          value={value1}
          onValueChange={setValue1}
          minimumValue={0}
          maximumValue={100}
          step={1}
          minimumTrackTintColor={tokens.mint}
          maximumTrackTintColor={tokens.border}
          thumbTintColor={tokens.mint}
        />
      </View>

      {/* Test 2: With steps */}
      <View style={[styles.card, { backgroundColor: tokens.card }]}>
        <Text style={[styles.cardTitle, { color: tokens.ink }]}>
          Stepped Slider (10% increments)
        </Text>
        <Text style={[styles.valueText, { color: tokens.mint }]}>
          Value: {value2.toFixed(0)}%
        </Text>
        <CustomSlider
          value={value2}
          onValueChange={setValue2}
          minimumValue={0}
          maximumValue={100}
          step={10}
          minimumTrackTintColor={tokens.mint}
          maximumTrackTintColor={tokens.border}
          thumbTintColor={tokens.mint}
        />
      </View>

      {/* Test 3: Custom range */}
      <View style={[styles.card, { backgroundColor: tokens.card }]}>
        <Text style={[styles.cardTitle, { color: tokens.ink }]}>
          Custom Range (0-500)
        </Text>
        <Text style={[styles.valueText, { color: tokens.mint }]}>
          Value: {value3.toFixed(0)} SV
        </Text>
        <CustomSlider
          value={value3}
          onValueChange={setValue3}
          minimumValue={0}
          maximumValue={500}
          step={5}
          minimumTrackTintColor={tokens.mint}
          maximumTrackTintColor={tokens.border}
          thumbTintColor={tokens.mint}
        />
      </View>

      {/* Test 4: Different colors */}
      <View style={[styles.card, { backgroundColor: tokens.card }]}>
        <Text style={[styles.cardTitle, { color: tokens.ink }]}>
          Custom Colors
        </Text>
        <Text style={[styles.valueText, { color: "#FF6B6B" }]}>
          Value: {50}%
        </Text>
        <CustomSlider
          value={50}
          onValueChange={() => {}}
          minimumValue={0}
          maximumValue={100}
          step={1}
          minimumTrackTintColor="#FF6B6B"
          maximumTrackTintColor="#E0E0E0"
          thumbTintColor="#FF6B6B"
        />
      </View>

      {/* Instructions */}
      <View
        style={[
          styles.infoCard,
          { backgroundColor: tokens.mintSoft, borderColor: tokens.mint },
        ]}
      >
        <Text style={[styles.infoTitle, { color: tokens.mint }]}>
          ✅ Test Instructions
        </Text>
        <Text style={[styles.infoText, { color: tokens.ink }]}>
          1. Drag each slider thumb left and right{"\n"}
          2. Verify values update in real-time{"\n"}
          3. Check smooth animation on release{"\n"}
          4. Test on both Android and iOS if possible{"\n"}
          5. Delete this file after testing!
        </Text>
      </View>

      <View
        style={[
          styles.infoCard,
          { backgroundColor: tokens.blueSoft, borderColor: tokens.blue },
        ]}
      >
        <Text style={[styles.infoTitle, { color: tokens.blue }]}>
          📁 Delete After Testing
        </Text>
        <Text style={[styles.infoText, { color: tokens.ink }]}>
          This is a test screen. Once you've confirmed the slider works, delete:{"\n"}
          {"\n"}
          <Text style={{ fontFamily: "monospace", fontSize: 11 }}>
            page/src/app/(app)/test-slider.tsx
          </Text>
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk_700Bold",
    marginTop: 20,
  },
  subtitle: {
    fontSize: 14,
    marginTop: -12,
    marginBottom: 12,
  },
  card: {
    padding: 20,
    borderRadius: 16,
    gap: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "SpaceGrotesk_700Bold",
  },
  valueText: {
    fontSize: 24,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk_700Bold",
  },
  infoCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 8,
    fontFamily: "SpaceGrotesk_700Bold",
  },
  infoText: {
    fontSize: 14,
    lineHeight: 20,
  },
});
