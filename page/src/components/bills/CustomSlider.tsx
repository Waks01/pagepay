/**
 * CustomSlider - Pure JavaScript slider component
 * No native dependencies, works in any Expo dev client
 *
 * Uses Responder system for direct touch handling
 */

import React, { useRef, useState } from "react";
import {
  View,
  StyleSheet,
  Animated,
  LayoutChangeEvent,
  StyleProp,
  ViewStyle,
  GestureResponderEvent,
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
  const [isDragging, setIsDragging] = useState(false);
  const thumbPosition = useRef(new Animated.Value(0)).current;

  // Convert value to pixel position
  const valueToPosition = (val: number): number => {
    if (sliderWidth === 0) return 0;
    const normalizedValue =
      (val - minimumValue) / (maximumValue - minimumValue);
    return normalizedValue * sliderWidth;
  };

  // Convert pixel position to value
  const positionToValue = (position: number): number => {
    if (sliderWidth === 0) return minimumValue;
    const clampedPosition = Math.max(0, Math.min(sliderWidth, position));
    const normalizedPosition = clampedPosition / sliderWidth;
    const rawValue =
      minimumValue + normalizedPosition * (maximumValue - minimumValue);
    const steppedValue = Math.round(rawValue / step) * step;
    return Math.max(minimumValue, Math.min(maximumValue, steppedValue));
  };

  // Update value and position from touch event
  const updateFromEvent = (event: GestureResponderEvent) => {
    if (disabled || sliderWidth === 0) return;

    const locationX = event.nativeEvent.locationX;
    const newValue = positionToValue(locationX);

    onValueChange(newValue);

    // Update thumb position immediately
    const newPosition = valueToPosition(newValue);
    thumbPosition.setValue(newPosition);
  };

  // Handle touch start
  const handleTouchStart = (event: GestureResponderEvent) => {
    if (disabled) return;
    setIsDragging(true);
    updateFromEvent(event);

    // Haptic feedback
    try {
      const Haptics = require("expo-haptics");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      // Ignore
    }
  };

  // Handle touch move (dragging)
  const handleTouchMove = (event: GestureResponderEvent) => {
    if (disabled) return;
    updateFromEvent(event);
  };

  // Handle touch end
  const handleTouchEnd = () => {
    if (disabled) return;
    setIsDragging(false);

    // Animate to final position
    const finalPosition = valueToPosition(value);
    Animated.spring(thumbPosition, {
      toValue: finalPosition,
      useNativeDriver: false,
      tension: 100,
      friction: 10,
    }).start();
  };

  // Update thumb position when value changes externally
  React.useEffect(() => {
    if (sliderWidth > 0 && !isDragging) {
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
    setSliderWidth(width);

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
        onStartShouldSetResponder={() => !disabled}
        onMoveShouldSetResponder={() => !disabled}
        onResponderGrant={handleTouchStart}
        onResponderMove={handleTouchMove}
        onResponderRelease={handleTouchEnd}
        onResponderTerminate={handleTouchEnd}
      >
        {/* Background track */}
        <View
          style={[styles.track, { backgroundColor: maximumTrackTintColor }]}
        />

        {/* Progress track */}
        <Animated.View
          style={[
            styles.progressTrack,
            { backgroundColor: minimumTrackTintColor, width: progressWidth },
          ]}
        />

        {/* Thumb */}
        <Animated.View
          style={[
            styles.thumb,
            {
              backgroundColor: thumbTintColor,
              opacity: disabled ? 0.5 : 1,
              transform: [
                { translateX: thumbPosition },
                { scale: isDragging ? 1.2 : 1 },
              ],
            },
          ]}
        >
          <View style={styles.thumbInner} />
        </Animated.View>
      </View>
    </View>
  );
}

const THUMB_SIZE = 28;
const TRACK_HEIGHT = 4;

const styles = StyleSheet.create({
  container: {
    height: 40,
    justifyContent: "center",
  },
  trackContainer: {
    height: 40,
    justifyContent: "center",
    position: "relative",
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
    top: (40 - THUMB_SIZE) / 2,
    marginLeft: -THUMB_SIZE / 2,
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
