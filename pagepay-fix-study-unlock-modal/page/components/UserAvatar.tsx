import React, { useState } from "react";
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  Image,
  View,
  Modal,
  Pressable,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useCurrentUser } from "@/src/shared/lib/current-user";
import { initials } from "@/src/shared/lib/display-name";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { PagePay } from "@/constants/theme";

type UserAvatarProps = {
  size?: number;
  onPress?: () => void;
  showLightbox?: boolean;
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

export const UserAvatar = React.memo(function UserAvatar({
  size = 32,
  onPress,
  showLightbox = false,
}: UserAvatarProps) {
  const router = useRouter();
  const user = useCurrentUser();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const [lightboxVisible, setLightboxVisible] = useState(false);

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else if (showLightbox && user?.avatar_url) {
      setLightboxVisible(true);
    } else {
      router.push("/profile");
    }
  };

  const userInitials = user ? initials(user) : "?";
  const hasAvatar = user?.avatar_url;

  return (
    <>
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Go to profile"
        style={[
          styles.container,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
          },
        ]}
      >
        {hasAvatar ? (
          <Image
            source={{ uri: user.avatar_url }}
            style={[
              styles.avatar,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
              },
            ]}
          />
        ) : (
          <View
            style={[
              styles.fallback,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: tokens.mintSoft,
              },
            ]}
          >
            <Text
              style={[
                styles.initials,
                {
                  color: tokens.mint,
                  fontSize: size * 0.4,
                  fontFamily: "SpaceGrotesk_700Bold",
                },
              ]}
            >
              {userInitials}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {showLightbox && hasAvatar && (
        <ImageLightbox
          visible={lightboxVisible}
          imageUri={user.avatar_url}
          onClose={() => setLightboxVisible(false)}
          tokens={tokens}
        />
      )}
    </>
  );
});

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
  },
  avatar: {
    resizeMode: "cover",
  },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    letterSpacing: -0.5,
  },
});

type ImageLightboxProps = {
  visible: boolean;
  imageUri: string;
  onClose: () => void;
  tokens: (typeof PagePay)["light"];
};

function ImageLightbox({
  visible,
  imageUri,
  onClose,
  tokens,
}: ImageLightboxProps) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = savedScale.value * e.scale;
    })
    .onEnd(() => {
      if (scale.value < 1) {
        scale.value = withSpring(1);
        savedScale.value = 1;
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else if (scale.value > 4) {
        scale.value = withSpring(4);
        savedScale.value = 4;
      } else {
        savedScale.value = scale.value;
      }
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withSpring(1);
        savedScale.value = 1;
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        scale.value = withSpring(2);
        savedScale.value = 2;
      }
    });

  const composed = Gesture.Simultaneous(
    doubleTapGesture,
    Gesture.Simultaneous(pinchGesture, panGesture),
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const handleClose = () => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={lightboxStyles.container}>
        <Pressable
          style={[
            lightboxStyles.closeButton,
            { backgroundColor: "rgba(0, 0, 0, 0.6)" },
          ]}
          onPress={handleClose}
        >
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>

        <GestureDetector gesture={composed}>
          <Animated.View style={[lightboxStyles.imageContainer, animatedStyle]}>
            <Image
              source={{ uri: imageUri }}
              style={lightboxStyles.image}
              resizeMode="contain"
            />
          </Animated.View>
        </GestureDetector>

        <View style={lightboxStyles.instructions}>
          <Text style={lightboxStyles.instructionsText}>
            Pinch to zoom • Double tap to reset
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const lightboxStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  closeButton: {
    position: "absolute",
    top: 50,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  imageContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: "center",
    alignItems: "center",
  },
  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.8,
  },
  instructions: {
    position: "absolute",
    bottom: 50,
    alignSelf: "center",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  instructionsText: {
    color: "#fff",
    fontSize: 12,
    fontFamily: "SpaceGrotesk_400Regular",
  },
});
