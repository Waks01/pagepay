import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  Image,
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
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";

import { apiFetch, API_URL } from "@/src/shared/api/client";
import { Fonts, PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/Skeleton";
import { getCachedMaterialFileUri, cacheMaterialFile } from "@/src/features/study/storage";

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

type PdfPage = {
  page: number;
  total: number;
  image_base64: string;
  width: number;
  height: number;
};

export default function FileViewerScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const materialId = Number(id);
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [isDownloading, setIsDownloading] = useState(false);
  const [cachedFileUri, setCachedFileUri] = useState<string | null>(null);
  const [checkingCache, setCheckingCache] = useState(true);

  const materialQ = useQuery({
    queryKey: ["study", "material", materialId],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/study/materials/${materialId}`);
      if (!res.ok) throw new Error("Failed to load material");
      return res.json() as Promise<MaterialDetail>;
    },
  });

  useEffect(() => {
    let cancelled = false;
    if (materialQ.data?.has_original_file) {
      getCachedMaterialFileUri(materialId, materialQ.data.file_mime_type).then(
        (uri) => {
          if (!cancelled) {
            setCachedFileUri(uri);
            setCheckingCache(false);
          }
        },
      );
    } else {
      setCheckingCache(false);
    }
    return () => {
      cancelled = true;
    };
  }, [materialQ.data?.has_original_file, materialQ.data?.file_mime_type, materialId]);

  useEffect(() => {
    let cancelled = false;
    if (materialQ.data?.has_original_file && !cachedFileUri && !checkingCache) {
      apiFetch(`/api/v1/study/materials/${materialId}/file`)
        .then(async (res) => {
          if (!res.ok) return;
          const blob = await res.blob();
          const reader = new FileReader();
          reader.onloadend = async () => {
            if (cancelled) return;
            const base64 = (reader.result as string).split(",")[1];
            await cacheMaterialFile(
              materialId,
              base64,
              materialQ.data!.file_mime_type || "application/octet-stream",
            );
            const uri = await getCachedMaterialFileUri(materialId, materialQ.data!.file_mime_type);
            if (!cancelled && uri) setCachedFileUri(uri);
          };
          reader.readAsDataURL(blob);
        })
        .catch((err) => {
          if (!cancelled) console.error("Failed to cache file in viewer:", err);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [materialQ.data?.has_original_file, materialId, cachedFileUri, checkingCache]);

  const handleBack = () => {
    router.back();
  };

  const handleDownload = async () => {
    if (!selectedMaterial) return;
    setIsDownloading(true);
    try {
      const ext =
        selectedMaterial.file_mime_type?.split("/")[1]?.split(";")[0] || "bin";
      const filename = `material_${selectedMaterial.id}.${ext}`;
      const destPath = `${FileSystem.cacheDirectory}${filename}`;

      if (cachedFileUri) {
        await FileSystem.copyAsync({
          from: cachedFileUri,
          to: destPath,
        });
      } else {
        const res = await apiFetch(
          `/api/v1/study/materials/${selectedMaterial.id}/file`,
        );
        if (!res.ok) throw new Error("Failed to fetch file");
        const blob = await res.blob();
        const contentDisposition = res.headers.get("Content-Disposition");
        const finalFilename =
          contentDisposition?.match(/filename="?([^"]+)"?/)?.[1] ||
          filename;

        const finalDestPath = `${FileSystem.cacheDirectory}${finalFilename}`;

        const reader = new FileReader();
        reader.onloadend = async () => {
          try {
            const base64 = (reader.result as string).split(",")[1];
            await FileSystem.writeAsStringAsync(finalDestPath, base64, {
              encoding: FileSystem.EncodingType.Base64,
            });
            if (await Sharing.isAvailableAsync()) {
              await Sharing.shareAsync(finalDestPath, {
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
        return;
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(destPath, {
          mimeType: selectedMaterial.file_mime_type || "application/octet-stream",
          dialogTitle: selectedMaterial.title || "File",
        });
      }
    } catch (err) {
      console.error("File viewer fetch failed:", err);
    } finally {
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
        <View style={styles.skeletonContainer}>
          <Skeleton height={240} width="100%" borderRadius={12} marginBottom={12} />
          <Skeleton height={420} width="100%" borderRadius={12} />
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

      <GestureHandlerRootView style={styles.viewerContainer}>
        {isImage && checkingCache && (
          <View style={styles.skeletonContainer}>
            <Skeleton height={420} width="100%" borderRadius={12} />
          </View>
        )}
        {isImage && !checkingCache && (
          <ZoomableImage uri={cachedFileUri || fileUrl} />
        )}

        {isPdf && (
          <View style={styles.pdfContainer}>
            {pagesQ.isLoading ? (
              <View style={styles.pdfSkeletonContainer}>
                <Skeleton height={420} width="100%" borderRadius={12} />
              </View>
            ) : pagesQ.isError ? (
              <View style={styles.center}>
                <Text style={[styles.errorText, { color: "#fff" }]}>
                  Failed to load PDF pages
                </Text>
                <Pressable onPress={() => pagesQ.refetch()} style={styles.retryBtn}>
                  <Text style={styles.retryBtnText}>Retry</Text>
                </Pressable>
              </View>
            ) : (
              <ScrollView
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.pdfScrollContent}
              >
                {(pagesQ.data || []).map((page) => (
                  <ZoomableImage
                    key={page.page}
                    uri={`data:image/png;base64,${page.image_base64}`}
                  />
                ))}
              </ScrollView>
            )}
          </View>
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
      </GestureHandlerRootView>
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
  skeletonContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  pdfSkeletonContainer: {
    padding: 16,
    gap: 12,
  },
  errorText: {
    fontSize: 16,
    fontWeight: "600",
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
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#0E7C66",
  },
  retryBtnText: {
    color: "#0E7C66",
    fontWeight: "600",
    fontSize: 14,
  },
  viewerContainer: {
    flex: 1,
    backgroundColor: "#000",
  },
  pdfContainer: {
    flex: 1,
    backgroundColor: "#000",
  },
  pdfScrollContent: {
    alignItems: "center",
    paddingVertical: 16,
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
