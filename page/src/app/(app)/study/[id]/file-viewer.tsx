import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { WebView } from "react-native-webview";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";

import { apiFetch, API_URL } from "@/src/shared/api/client";
import { Fonts, PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { PageHeader } from "@/components/PageHeader";

type MaterialDetail = {
  id: number;
  title: string;
  exam_type: string | null;
  content: string | null;
  file_mime_type: string | null;
  has_original_file: boolean;
  parsed_structure: Record<string, unknown> | null;
  assets: Array<{
    id: number;
    material_id: number;
    type: string;
    points_to_unlock: number;
    created_at: string;
    unlocked?: boolean;
    content?: unknown;
  }>;
  created_at: string;
};

export default function FileViewerScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const materialId = Number(id);
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [isDownloading, setIsDownloading] = useState(false);

  const materialQ = useQuery({
    queryKey: ["study", "material", materialId],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/study/materials/${materialId}`);
      if (!res.ok) throw new Error("Failed to load material");
      return res.json() as Promise<MaterialDetail>;
    },
  });

  const selectedMaterial = materialQ.data;

  const handleBack = () => {
    router.back();
  };

  const handleDownload = async () => {
    if (!selectedMaterial) return;
    setIsDownloading(true);
    try {
      const res = await apiFetch(
        `/api/v1/study/materials/${selectedMaterial.id}/file`,
      );
      if (!res.ok) throw new Error("Failed to fetch file");
      const blob = await res.blob();
      const contentDisposition = res.headers.get("Content-Disposition");
      const filename =
        contentDisposition?.match(/filename="?([^"]+)"?/)?.[1] ||
        `material_${selectedMaterial.id}`;

      const ext =
        selectedMaterial.file_mime_type?.split("/")[1]?.split(";")[0] || "bin";
      const destPath = `${FileSystem.cacheDirectory}${filename}.${ext}`;

      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64 = (reader.result as string).split(",")[1];
          await FileSystem.writeAsStringAsync(destPath, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(destPath, {
              mimeType: selectedMaterial.file_mime_type || "application/octet-stream",
              dialogTitle: selectedMaterial.title || "File",
            });
          }
        } catch (err) {
          console.error("File viewer download/share failed:", err);
        } finally {
          setIsDownloading(false);
        }
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      console.error("File viewer fetch failed:", err);
      setIsDownloading(false);
    }
  };

  if (!selectedMaterial) {
    return (
      <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: "#000" }}>
        <PageHeader
          title={t("study.loading_material_title", "Loading…")}
          showBack
          onBack={handleBack}
          backgroundColor="#000"
          borderBottomColor="#333"
          tokens={tokens}
        />
        <View style={styles.center}>
          <Text style={[styles.loadingText, { color: "#fff" }]}>
            {t("study.loading_material_title", "Loading…")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!selectedMaterial.has_original_file) {
    return (
      <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: "#000" }}>
        <PageHeader
          title={selectedMaterial.title}
          showBack
          onBack={handleBack}
          backgroundColor="#000"
          borderBottomColor="#333"
          tokens={tokens}
        />
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: "#fff" }]}>
            Original file not available
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const isImage = selectedMaterial.file_mime_type?.startsWith("image/");
  const isPdf = selectedMaterial.file_mime_type === "application/pdf";
  const fileUrl = `${API_URL}/api/v1/study/materials/${selectedMaterial.id}/file`;

  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: "#000" }}>
      <PageHeader
        title={selectedMaterial.title}
        showBack
        onBack={handleBack}
        backgroundColor="#000"
        borderBottomColor="#333"
        tokens={tokens}
        right={
          <Pressable
            onPress={handleDownload}
            disabled={isDownloading}
            style={styles.headerAction}
          >
            <Ionicons
              name={isDownloading ? "download-outline" : "share-outline"}
              size={18}
              color="#fff"
            />
          </Pressable>
        }
      />

      <View style={styles.viewerContainer}>
        {isImage && (
          <ZoomableImage uri={fileUrl} />
        )}

        {isPdf && (
          <WebView
            source={{ uri: fileUrl }}
            style={styles.webview}
            startInLoadingState
            scalesPageToFit
            originWhitelist={["*"]}
          />
        )}

        {!isImage && !isPdf && (
          <View style={styles.center}>
            <Text style={[styles.errorText, { color: "#fff" }]}>
              Preview not available for this file type
            </Text>
            <Pressable onPress={handleDownload} style={styles.downloadBtn}>
              <Text style={styles.downloadBtnText}>Download / Share</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function ZoomableImage({ uri }: { uri: string }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const reset = useCallback(() => {
    scale.value = withSpring(1);
    savedScale.value = 1;
    translateX.value = withSpring(0);
    translateY.value = withSpring(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, []);

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

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        runOnJS(reset)();
      } else {
        scale.value = withSpring(2);
        savedScale.value = 2;
      }
    });

  const composed = Gesture.Simultaneous(pinchGesture, panGesture, doubleTap);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { scale: scale.value },
      ],
    };
  });

  return (
    <GestureDetector gesture={composed}>
      <View style={styles.zoomContainer}>
        <Animated.Image
          source={{ uri }}
          style={[styles.zoomImage, animatedStyle]}
          resizeMode="contain"
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  loadingText: {
    fontSize: 16,
  },
  errorText: {
    fontSize: 16,
    textAlign: "center",
  },
  downloadBtn: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#0E7C66",
  },
  downloadBtnText: {
    color: "#fff",
    fontWeight: "600",
  },
  viewerContainer: {
    flex: 1,
    backgroundColor: "#000",
  },
  webview: {
    flex: 1,
    backgroundColor: "#000",
  },
  headerAction: {
    padding: 8,
  },
  zoomContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  zoomImage: {
    width: "100%",
    height: "100%",
  },
});
