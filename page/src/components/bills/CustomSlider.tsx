/**
 * CustomSlider - Pure JavaScript slider component
 * No native dependencies, works in any Expo dev client
 * 
 * Drop-in replacement for @react-native-community/slider
 */

import React, { useRef, useState } from "react";
import {
  View,
  StyleSheet,
  PanResponder,
  Animated,
  LayoutChangeEvent,
  StyleProp,
  ViewStyle,
} from "react-native";

interface CustomSliderProps {
  value: number;
  onValueChange: (value: number) => void;
  minimumValue?: number;
  maximumValue?: number;
  step?: number;
  minimumTrackTintColor?: string;
  maximumTrackTintColor?: string;
  thumbTintColor?: string;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}

export function CustomSlider({
  value,
  onValueChange,
  minimumValue = 0,
  maximumValue = 100,
  step = 1,
  minimumTrackTintColor = "#0E7C66",
  maximumTrackTintColor = "#E5E5E5",
  thumbTintColor = "#0E7C66",
  style,
  disabled = false,
}: CustomSliderProps) {
  const [sliderWidth, setSliderWidth] = useState(0);
  const thumbPosition = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: () => {
        // User started touching - add haptic feedback if available
        try {
          const Haptics = require("expo-haptics");
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch {
          // Haptics not available, ignore
        }
      },
      onPanResponderMove: (_, gestureState) => {
        if (disabled) return;
        
        // Calculate new position
        let newPosition = gestureState.dx + valueToPosition(value);
        
        // Clamp to slider bounds
        newPosition = Math.max(0, Math.min(sliderWidth, newPosition));
        
        // Update thumb position
        thumbPosition.setValue(newPosition);
        
        // Calculate and emit new value
        const newValue = positionToValue(newPosition);
        const steppedValue = Math.round(newValue / step) * step;
        const clampedValue = Math.max(
          minimumValue,
          Math.min(maximumValue, steppedValue),
        );
        
        onValueChange(clampedValue);
      },
      onPanResponderRelease: () => {
        // Animation to snap to final position (optional smooth animation)
        const finalPosition = valueToPosition(value);
        Animated.spring(thumbPosition, {
          toValue: finalPosition,
          useNativeDriver: false,
          tension: 100,
          friction: 10,
        }).start();
      },
    }),
  ).current;

  // Convert value (0-100) to pixel position
  const valueToPosition = (val: number): number => {
    const normalizedValue = (val - minimumValue) / (maximumValue - minimumValue);
    return normalizedValue * sliderWidth;
  };

  // Convert pixel position to value (0-100)
  const positionToValue = (position: number): number => {
    const normalizedPosition = position / sliderWidth;
    return minimumValue + normalizedPosition * (maximumValue - minimumValue);
  };

  // Update thumb position when value changes externally
  React.useEffect(() => {
    if (sliderWidth > 0) {
      const newPosition = valueToPosition(value);
      Animated.timing(thumbPosition, {
        toValue: newPosition,
        duration: 100,
        useNativeDriver: false,
      }).start();
    }
  }, [value, sliderWidth]);

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setSliderWidth(width - THUMB_SIZE); // Subtract thumb size to prevent overflow
    
    // Initialize thumb position
    const initialPosition = valueToPosition(value);
    thumbPosition.setValue(initialPosition);
  };

  const progressWidth = thumbPosition.interpolate({
    inputRange: [0, sliderWidth || 1],
    outputRange: ["0%", "100%"],
    extrapolate: "clamp",
  });

  return (
    <View style={[styles.container, style]}>
      <View
        style={styles.trackContainer}
        onLayout={handleLayout}
      >
        {/* Background track (unfilled) */}
        <View
          style={[
            styles.track,
            { backgroundColor: maximumTrackTintColor },
          ]}
        />

        {/* Progress track (filled) */}
        <Animated.View
          style={[
            styles.progressTrack,
            {
              backgroundColor: minimumTrackTintColor,
              width: progressWidth,
            },
          ]}
        />

        {/* Thumb (draggable handle) */}
        <Animated.View
          style={[
            styles.thumb,
            {
              backgroundColor: thumbTintColor,
              transform: [{ translateX: thumbPosition }],
              opacity: disabled ? 0.5 : 1,
            },
          ]}
          {...panResponder.panHandlers}
        >
          {/* Inner shadow for depth */}
          <View style={styles.thumbInner} />
        </Animated.View>
      </View>
    </View>
  );
}

const THUMB_SIZE = 24;
const TRACK_HEIGHT = 4;

const styles = StyleSheet.create({
  container: {
    height: 40,
    justifyContent: "center",
  },
  trackContainer: {
    height: TRACK_HEIGHT,
    position: "relative",
    justifyContent: "center",
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    position: "absolute",
    left: 0,
    right: 0,
  },
  progressTrack: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    position: "absolute",
    left: 0,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    position: "absolute",
    top: -10, // Center vertically on track
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    justifyContent: "center",
    alignItems: "center",
  },
  thumbInner: {
    width: THUMB_SIZE - 8,
    height: THUMB_SIZE - 8,
    borderRadius: (THUMB_SIZE - 8) / 2,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
  },
});
