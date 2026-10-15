import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image as ExpoImage } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Sharing from "expo-sharing";
// Legacy helpers only — the root `expo-file-system` export throws when
// these are called (see use-document-picker.ts for the full note).
import * as FileSystem from "expo-file-system/legacy";

import { apiFetch, API_URL } from "@/src/shared/api/client";
import { EXAM_TYPE_KEYS } from "@/src/shared/lib/exam-types";
import { cacheDirectory } from "@/src/shared/lib/file-paths";
import { getToken } from "@/src/shared/lib/storage";
import { Fonts, PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { useCurrentUser } from "@/src/shared/lib/current-user";
import { PageHeader } from "@/components/PageHeader";
import { getTopicNames } from "@/src/app/(app)/study";
import { ProgressDashboard } from "@/components/study/ProgressDashboard";
import { AssetBrowser } from "@/components/study/AssetBrowser";
import { cacheAsset, getCachedAsset } from "@/src/features/study/storage";
import { useClaimQuizBonus } from "@/src/features/study/hooks/use-study";
import { Skeleton } from "@/components/Skeleton";

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

export default function MaterialDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const materialId = Number(id);
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const qc = useQueryClient();

  const [selectedMaterial, setSelectedMaterial] = useState<MaterialDetail | null>(null);
  const [unlockedAssets, setUnlockedAssets] = useState<Record<number, unknown>>({});
  const [generateMode, setGenerateMode] = useState<"topic" | "all">("all");
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [generateCount, setGenerateCount] = useState<number>(15);
  const [generatingType, setGeneratingType] = useState<string | null>(null);
  const [actionMenuVisible, setActionMenuVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editExamType, setEditExamType] = useState<string | null>(null);
  const [shareFormatVisible, setShareFormatVisible] = useState(false);
  const [pdfPages, setPdfPages] = useState<Array<{ page: number; total: number; image_base64: string; width: number; height: number }> | null>(null);
  const [loadingPages, setLoadingPages] = useState(false);
  const [pdfPagesError, setPdfPagesError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const studySessionIdRef = useRef<number | null>(null);
  /**
   * Headers for loading `/materials/{id}/file` inline. That endpoint is
   * auth-gated, and RN's `<Image>` cannot send an Authorization header, so
   * expo-image is used instead. `null` means the token hasn't resolved yet.
   */
  const [fileAuthHeaders, setFileAuthHeaders] = useState<Record<string, string> | null>(null);
  const [filePreviewFailed, setFilePreviewFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getToken().then((token) => {
      if (cancelled) return;
      setFileAuthHeaders(token ? { Authorization: `Bearer ${token}` } : {});
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const renderPreviewBlocks = (
    material: MaterialDetail,
    tokens: any,
  ) => {
    if (!material.parsed_structure) {
      return (
        <Text
          style={[styles.materialPreviewText, { color: tokens.ink }]}
          numberOfLines={6}
        >
          {material.content}
        </Text>
      );
    }

    try {
      const parsed = JSON.parse(
        JSON.stringify(material.parsed_structure),
      ) as { content_blocks?: any[] };
      const blocks = parsed?.content_blocks;

      if (!Array.isArray(blocks) || blocks.length === 0) {
        return (
          <Text
            style={[styles.materialPreviewText, { color: tokens.ink }]}
            numberOfLines={6}
          >
            {material.content}
          </Text>
        );
      }

      const preview = blocks.slice(0, 3);
      return preview.map((block, idx) => {
        if (block.type === "heading") {
          const level = block.level || 1;
          const fontSize = level <= 2 ? 15 : 13;
          const fontWeight = level <= 2 ? "600" : "500";
          return (
            <Text
              key={idx}
              style={[
                styles.materialPreviewText,
                {
                  fontSize,
                  fontWeight,
                  color: tokens.ink,
                  marginBottom: 4,
                },
              ]}
            >
              {block.text}
            </Text>
          );
        }

        if (block.type === "body") {
          return (
            <Text
              key={idx}
              style={[
                styles.materialPreviewText,
                { color: tokens.inkMuted, marginBottom: 4 },
              ]}
              numberOfLines={2}
            >
              {block.text}
            </Text>
          );
        }

        if (block.type === "list" || block.type === "numbered_list") {
          const isNumbered = block.type === "numbered_list";
          return (
            <View key={idx} style={{ gap: 2, marginBottom: 4 }}>
              {(block.items || []).slice(0, 3).map((item: string, i: number) => (
                <Text
                  key={i}
                  style={[
                    styles.materialPreviewText,
                    { color: tokens.inkMuted, fontSize: 12 },
                  ]}
                  numberOfLines={1}
                >
                  {isNumbered ? `${i + 1}.` : "\u2022"} {item}
                </Text>
              ))}
            </View>
          );
        }

        return null;
      });
    } catch (e) {
      if (__DEV__) {
        console.error("Failed to render preview blocks:", e);
      }
      return (
        <Text
          style={[styles.materialPreviewText, { color: tokens.ink }]}
          numberOfLines={6}
        >
          {material.content}
        </Text>
      );
    }
  };

  const materialQ = useQuery({
    queryKey: ["study", "material", materialId],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/study/materials/${materialId}`);
      if (!res.ok) throw new Error("Failed to load material");
      return res.json() as Promise<MaterialDetail>;
    },
  });

  const currentUser = useCurrentUser();
  const claimQuizBonus = useClaimQuizBonus();

  // Hydrate already-unlocked assets from the offline cache so quizzes
  // stay available without re-paying for them after a restart.
  useEffect(() => {
    let cancelled = false;
    if (!selectedMaterial) return;
    (async () => {
      for (const asset of selectedMaterial.assets) {
        const cached = await getCachedAsset(asset.id);
        if (cached && cached.materialId === selectedMaterial.id && !cancelled) {
          setUnlockedAssets((prev) => ({ ...prev, [asset.id]: cached.content }));
        }
      }
    })().catch((err) => {
      if (__DEV__) console.error("Failed to load cached assets:", err);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedMaterial?.id]);

  const handleAssetUnlock = async (assetId: number, method: "sv" | "cashable") => {
    setError(null);
    const res = await apiFetch("/api/v1/study/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ asset_id: assetId, method }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Unlock failed" }));
      throw new Error(err.detail || "Unlock failed");
    }
    const data = await res.json();
    if (data.unlocked && data.content) {
      setUnlockedAssets((prev) => ({ ...prev, [assetId]: data.content }));
      try {
        await cacheAsset(assetId, data.content, materialId);
      } catch (err) {
        // Caching is best-effort — an unlock the server confirmed must
        // not be reported as failed because the offline write failed.
        if (__DEV__) console.error("Failed to cache unlocked asset:", err);
      }
    }
    qc.invalidateQueries({ queryKey: ["me"] });
    return data;
  };

  const handleQuizComplete = async (assetId: number, score: number) => {
    // The bonus and the progress roll-up are server-side rewards — a
    // failed claim must not block the student from seeing their score,
    // so this surfaces nothing and the AssetBrowser still records the
    // completed attempt locally.
    try {
      await claimQuizBonus.mutateAsync({ asset_id: assetId, score });
    } catch (err) {
      if (__DEV__) console.error("Quiz bonus claim failed:", err);
    }
  };

  useEffect(() => {
    if (materialQ.data) {
      setSelectedMaterial(materialQ.data);
      setFilePreviewFailed(false);
    }
  }, [materialQ.data]);

  useEffect(() => {
    let cancelled = false;
    if (selectedMaterial?.file_mime_type === "application/pdf" && selectedMaterial.has_original_file) {
      setLoadingPages(true);
      setPdfPagesError(null);
      apiFetch(`/api/v1/study/materials/${selectedMaterial.id}/pages`)
        .then(async (res) => {
          if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: "Failed to load pages" }));
            throw new Error(err.detail || "Failed to load pages");
          }
          const data = await res.json();
          if (!cancelled) setPdfPages(data.pages || []);
        })
        .catch((err) => {
          if (!cancelled) {
            console.error("Failed to load PDF pages:", err);
            setPdfPagesError(err.message || "Failed to load PDF pages");
          }
        })
        .finally(() => {
          if (!cancelled) setLoadingPages(false);
        });
    } else {
      setPdfPages(null);
      setPdfPagesError(null);
    }
    return () => {
      cancelled = true;
    };
  }, [selectedMaterial?.id, selectedMaterial?.file_mime_type, selectedMaterial?.has_original_file]);

  useEffect(() => {
    let cancelled = false;
    if (selectedMaterial) {
      (async () => {
        try {
          const res = await apiFetch("/api/v1/study/session/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ material_id: selectedMaterial.id }),
          });
          if (cancelled || !res.ok) return;
          const data = await res.json();
          if (cancelled) return;
          studySessionIdRef.current = data.session_id;
        } catch (error) {
          if (__DEV__) console.error("Failed to start study session:", error);
        }
      })();
    }
    return () => {
      cancelled = true;
      if (studySessionIdRef.current) {
        const sid = studySessionIdRef.current;
        studySessionIdRef.current = null;
        (async () => {
          try {
            await apiFetch("/api/v1/study/session/end", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ session_id: sid }),
            });
          } catch {}
        })();
      }
    };
  }, [selectedMaterial]);

  const handleGenerateAsset = async (
    assetType: string,
    count?: number,
    topic?: string | null,
    mode?: "topic" | "all",
  ) => {
    if (!selectedMaterial?.parsed_structure) {
      setError(t("study.errors.no_parsed_structure", "Material has no parsed structure. Re-upload or try again."));
      return;
    }
    if (mode === "topic" && !topic) {
      // Defense in depth: the backend requires a topic name in topic mode,
      // so failing here with an actionable message beats a 400 round-trip.
      setError(t("study.errors.select_topic", "Select a topic to generate from."));
      return;
    }

    // Generation is charged up front, so confirm the price before spending.
    // Premium generates free, matching its free unlocks.
    const isPremium = currentUser && currentUser.tier !== 'free';
    if (!isPremium) {
      const price = assetType === "video" ? 200 : 50;
      const balance = currentUser?.service_credit_balance ?? 0;
      const label =
        assetType === "mcq"
          ? "MCQs"
          : assetType === "flashcard"
            ? "flashcards"
            : assetType === "video"
              ? "video script"
              : assetType;
      const proceed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          `Generate ${label}`,
          `This costs ${price} SV. You have ${balance}.`,
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: `Use ${price} SV`, onPress: () => resolve(true) },
          ],
        );
      });
      if (!proceed) return;
    }

    setGeneratingType(assetType);
    setError(null);
    try {
      const res = await apiFetch("/api/v1/study/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          material_id: materialId,
          asset_type: assetType,
          count: count ?? (mode === "topic" ? 15 : 20),
          topic: topic ?? null,
          mode: mode ?? "all",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Generation failed" }));
        throw new Error(err.detail || "Generation failed");
      }
      qc.invalidateQueries({ queryKey: ["study", "material", materialId] });
      qc.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      if (__DEV__) console.error("Generation failed:", err);
    } finally {
      setGeneratingType(null);
    }
  };

  const handleChatPress = () => {
    router.push(`/study/chat/${materialId}`);
  };

  const handleEditPress = () => {
    if (!selectedMaterial) return;
    setEditTitle(selectedMaterial.title.replace(/^[A-Z]+ · /, ""));
    setEditExamType(selectedMaterial.exam_type);
    setActionMenuVisible(false);
    setEditModalVisible(true);
  };

  const handleDeletePress = () => {
    setActionMenuVisible(false);
    setDeleteConfirmVisible(true);
  };

  const handleSharePress = async (format: "pdf" | "docx" | "txt" | "image") => {
    if (!selectedMaterial) return;
    setShareFormatVisible(false);
    try {
      const res = await apiFetch(
        `/api/v1/study/materials/${selectedMaterial.id}/export?format=${format}`,
      );
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const contentDisposition = res.headers.get("Content-Disposition");
      const filename = contentDisposition?.match(/filename="?([^"]+)"?/)?.[1] || `material.${format}`;
      const destPath = `${cacheDirectory}${filename}`;
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(",")[1];
        await FileSystem.writeAsStringAsync(destPath, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(destPath, {
            mimeType: res.headers.get("Content-Type") || "application/octet-stream",
            dialogTitle: selectedMaterial.title,
          });
        }
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      if (__DEV__) console.error("Share failed:", err);
    }
  };

  const handleEditSubmit = async () => {
    if (!selectedMaterial || !editTitle.trim()) return;
    try {
      const res = await apiFetch(`/api/v1/study/materials/${selectedMaterial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle.trim(),
          exam_type: editExamType,
        }),
      });
      if (!res.ok) throw new Error("Failed to update material");
      const updated = await res.json();
      setSelectedMaterial(updated);
      setEditModalVisible(false);
      qc.invalidateQueries({ queryKey: ["study", "materials"] });
    } catch (err) {
      if (__DEV__) console.error("Edit failed:", err);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!selectedMaterial) return;
    try {
      const res = await apiFetch(`/api/v1/study/materials/${selectedMaterial.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete material");
      router.back();
      qc.invalidateQueries({ queryKey: ["study", "materials"] });
    } catch (err) {
      if (__DEV__) console.error("Delete failed:", err);
    }
  };

  if (materialQ.isLoading) {
    return (
      <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: tokens.paper }}>
        <PageHeader
          title={t("study.loading_material_title", "Loading material…")}
          subtitle={t("study.loading_material_subtitle", "Please wait while we fetch your material")}
          showBack
          onBack={() => router.back()}
          backgroundColor={tokens.card}
          borderBottomColor={tokens.border}
          tokens={tokens}
        />
        <View style={styles.loadingState}>
          <Text style={[styles.loadingText, { color: tokens.inkMuted }]}>
            {t("study.loading_material_title", "Loading material…")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!selectedMaterial) {
    return (
      <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: tokens.paper }}>
        <PageHeader
          title="Material"
          showBack
          onBack={() => router.back()}
          backgroundColor={tokens.card}
          borderBottomColor={tokens.border}
          tokens={tokens}
        />
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: tokens.signal }]}>
            Material not found
          </Text>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={[styles.backBtnText, { color: tokens.mint }]}>
              {t("common.go_back", "Go Back")}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const topicNames = getTopicNames(selectedMaterial.parsed_structure);

  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: tokens.paper }}>
      <PageHeader
        title={selectedMaterial.title}
        showBack
        onBack={() => router.back()}
        backgroundColor={tokens.card}
        borderBottomColor={tokens.border}
        tokens={tokens}
        right={
          <View style={styles.headerRight}>
            <Pressable
              onPress={handleChatPress}
              accessibilityRole="button"
              accessibilityLabel={t("study.chat_ai")}
              style={({ pressed }) => [
                styles.headerIconBtn,
                {
                  borderColor: tokens.border,
                  backgroundColor: tokens.card,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={tokens.ink} />
            </Pressable>
            <Pressable
              onPress={() => setActionMenuVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Material actions"
              style={({ pressed }) => [
                styles.headerIconBtn,
                {
                  borderColor: tokens.border,
                  backgroundColor: tokens.card,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name="ellipsis-vertical" size={18} color={tokens.ink} />
            </Pressable>
          </View>
        }
      />

      {error && (
        <View
          style={[
            styles.errorBanner,
            { backgroundColor: tokens.signalSoft, borderColor: tokens.signal },
          ]}
        >
          <Ionicons name="alert-circle" size={16} color={tokens.signal} />
          <Text style={[styles.errorBannerText, { color: tokens.signal }]}>
            {error}
          </Text>
          <Pressable onPress={() => setError(null)} hitSlop={8}>
            <Ionicons name="close" size={16} color={tokens.signal} />
          </Pressable>
        </View>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={materialQ.isRefetching}
            onRefresh={() => materialQ.refetch()}
            tintColor={tokens.mint}
          />
        }
      >
        <View style={styles.detailView}>
          <Animated.View entering={FadeInDown.duration(240).springify()}>
            <ProgressDashboard materialId={materialId} />
          </Animated.View>

          {selectedMaterial.parsed_structure && topicNames.length > 0 && (
            <Animated.View
              entering={FadeInDown.delay(60).duration(240).springify()}
            >
              <View
                style={[
                  styles.outlineCard,
                  { backgroundColor: tokens.card, borderColor: tokens.border },
                ]}
              >
                <View style={styles.sectionHeaderRow}>
                  <Text
                    style={[
                      styles.outlineTitle,
                      { color: tokens.ink, fontFamily: Fonts.editorialSemiBold as string },
                    ]}
                  >
                    {t("study.topics_covered")}
                  </Text>
                  <Text style={[styles.outlineMeta, { color: tokens.inkMuted }]}>
                    {t("study.topics_total", { count: topicNames.length })}
                  </Text>
                </View>
                <View style={styles.outlineList}>
                  {topicNames.map((topic, idx) => (
                    <View key={idx} style={styles.outlineItem}>
                      <Text style={[styles.outlineNum, { color: tokens.inkFaint }]}>
                        {String(idx + 1).padStart(2, "0")}
                      </Text>
                      <View style={[styles.outlineDot, { backgroundColor: tokens.mint }]} />
                      <Text style={[styles.outlineText, { color: tokens.ink }]}>
                        {String(topic)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            </Animated.View>
          )}

          {selectedMaterial.has_original_file && (
            <Animated.View
              entering={FadeInDown.delay(80).duration(240).springify()}
            >
              <Pressable
                onPress={() =>
                  router.push(`/study/${materialId}/file-viewer`)
                }
              >
                <View
                  style={[
                    styles.materialPreviewCard,
                    { backgroundColor: tokens.card, borderColor: tokens.border },
                  ]}
                >
                  <View style={styles.sectionHeaderRow}>
                    <Text
                      style={[
                        styles.outlineTitle,
                        { color: tokens.ink, fontFamily: Fonts.editorialSemiBold as string },
                      ]}
                    >
                      {t("study.original_file_title", "Original File")}
                    </Text>
                    <Text style={[styles.outlineMeta, { color: tokens.inkMuted }]}>
                      {selectedMaterial.file_mime_type?.split("/")[1]?.toUpperCase()}
                    </Text>
                  </View>

                  {selectedMaterial.file_mime_type?.startsWith("image/") && (
                    filePreviewFailed ? (
                      <View
                        style={[
                          styles.filePreviewFallback,
                          { borderColor: tokens.border, backgroundColor: tokens.paper2 },
                        ]}
                      >
                        <Ionicons name="image-outline" size={26} color={tokens.inkMuted} />
                        <Text style={[styles.filePreviewFallbackText, { color: tokens.inkMuted }]}>
                          {t("study.preview_unavailable", "Preview unavailable")}
                        </Text>
                      </View>
                    ) : fileAuthHeaders ? (
                      <ExpoImage
                        source={{
                          uri: `${API_URL}/api/v1/study/materials/${selectedMaterial.id}/file`,
                          headers: fileAuthHeaders,
                        }}
                        style={styles.materialPreviewImage}
                        contentFit="contain"
                        transition={150}
                        onError={() => setFilePreviewFailed(true)}
                      />
                    ) : (
                      <View style={styles.materialPreviewImage} />
                    )
                  )}

                  {selectedMaterial.file_mime_type === "application/pdf" && (
                    <View>
                      {loadingPages ? (
                        <View style={styles.loadingPages}>
                          <Skeleton height={420} width="100%" borderRadius={12} />
                        </View>
                      ) : pdfPagesError ? (
                        <Pressable
                          onPress={() => {
                            setPdfPagesError(null);
                            setLoadingPages(true);
                            apiFetch(`/api/v1/study/materials/${selectedMaterial.id}/pages`)
                              .then(async (res) => {
                                if (!res.ok) {
                                  const err = await res.json().catch(() => ({ detail: "Failed to load pages" }));
                                  throw new Error(err.detail || "Failed to load pages");
                                }
                                const data = await res.json();
                                setPdfPages(data.pages || []);
                                setPdfPagesError(null);
                              })
                              .catch((err) => {
                                console.error("Retry PDF pages failed:", err);
                                setPdfPagesError(err.message || "Failed to load PDF pages");
                              })
                              .finally(() => {
                                setLoadingPages(false);
                              });
                          }}
                          style={[styles.openFileBtn, { borderColor: tokens.border }]}
                        >
                          <Ionicons name="refresh-outline" size={18} color={tokens.mint} />
                          <Text style={[styles.openFileText, { color: tokens.mint }]}>
                            Retry loading pages
                          </Text>
                        </Pressable>
                      ) : pdfPages && pdfPages.length > 0 ? (
                        // FlatList, not ScrollView.map: a paging ScrollView
                        // mounts and decodes every page of the document at
                        // once, which is what kills the process on large PDFs.
                        <FlatList
                          horizontal
                          pagingEnabled
                          showsHorizontalScrollIndicator={false}
                          style={styles.pdfScroll}
                          data={pdfPages}
                          keyExtractor={(page) => String(page.page)}
                          initialNumToRender={2}
                          maxToRenderPerBatch={2}
                          windowSize={3}
                          removeClippedSubviews
                          renderItem={({ item: page }) => (
                            <Image
                              source={{ uri: `data:image/jpeg;base64,${page.image_base64}` }}
                              style={styles.pdfPageImage}
                              resizeMode="contain"
                            />
                          )}
                        />
                      ) : (
                        <Pressable
                          onPress={() =>
                            router.push(`/study/${materialId}/file-viewer`)
                          }
                          style={[styles.openFileBtn, { borderColor: tokens.border }]}
                        >
                          <Ionicons name="document-outline" size={18} color={tokens.mint} />
                          <Text style={[styles.openFileText, { color: tokens.mint }]}>
                            Tap to open PDF
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  )}

                  {selectedMaterial.file_mime_type && !selectedMaterial.file_mime_type.startsWith("image/") && selectedMaterial.file_mime_type !== "application/pdf" && (
                    <View style={[styles.openFileBtn, { borderColor: tokens.border }]}>
                      <Ionicons name="document-outline" size={18} color={tokens.mint} />
                      <Text style={[styles.openFileText, { color: tokens.mint }]}>
                        Tap to open file
                      </Text>
                    </View>
                  )}
                </View>
              </Pressable>
            </Animated.View>
          )}

          {selectedMaterial.content && (
            <Animated.View
              entering={FadeInDown.delay(120).duration(240).springify()}
            >
              <View
                style={[
                  styles.materialPreviewCard,
                  { backgroundColor: tokens.card, borderColor: tokens.border },
                ]}
              >
                <View style={styles.sectionHeaderRow}>
                  <Text
                    style={[
                      styles.outlineTitle,
                      { color: tokens.ink, fontFamily: Fonts.editorialSemiBold as string },
                    ]}
                  >
                    {t("study.material_preview_title")}
                  </Text>
                  <Text style={[styles.outlineMeta, { color: tokens.inkMuted }]}>
                    {t("study.material_preview_meta", {
                      words: selectedMaterial.content.split(/\s+/).filter(Boolean).length,
                    })}
                  </Text>
                </View>
                <View style={styles.materialPreviewStack}>
                  {renderPreviewBlocks(selectedMaterial, tokens)}
                </View>
                <Pressable
                  onPress={() => router.push(`/study/${materialId}/reader`)}
                  style={({ pressed }) => [
                    styles.readBtn,
                    {
                      backgroundColor: tokens.mint,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t("study.read_material_a11y")}
                >
                  <Ionicons name="book-outline" size={18} color={tokens.mintText} />
                  <Text style={[styles.readBtnText, { color: tokens.mintText }]}>
                    {t("study.read_material")}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={tokens.mintText} />
                </Pressable>
              </View>
            </Animated.View>
          )}

          <Animated.View
            entering={FadeInDown.delay(180).duration(240).springify()}
            style={styles.generateBlock}
          >
            <View style={styles.sectionHeaderRow}>
              <Text
                style={[
                  styles.outlineTitle,
                  { color: tokens.ink, fontFamily: Fonts.editorialSemiBold as string },
                ]}
              >
                {t("study.generate_assets_title", "Generate AI Study Assets")}
              </Text>
            </View>

            <View style={styles.generateOptions}>
              <Text style={[styles.generateOptionsLabel, { color: tokens.inkMuted }]}>
                {t("study.generate_mode_label", "Generation Mode")}
              </Text>
              <View style={styles.modeSelector}>
                <TouchableOpacity
                  onPress={() => {
                    setGenerateMode("all");
                    setSelectedTopic(null);
                  }}
                  style={[
                    styles.modeBtn,
                    {
                      backgroundColor: generateMode === "all" ? tokens.mintSoft : tokens.paper,
                      borderColor: generateMode === "all" ? tokens.mint : tokens.border,
                    },
                  ]}
                >
                  <Text style={[styles.modeBtnText, { color: generateMode === "all" ? tokens.mint : tokens.ink }]}>
                    {t("study.mode_all", "All Topics")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setGenerateMode("topic");
                    // Entering topic mode must never leave the material
                    // without a selection — the backend rejects topic-mode
                    // generation without a topic name (400), so default to
                    // the first topic instead of letting the user fire a
                    // request that can only fail.
                    setSelectedTopic((prev) => prev ?? topicNames[0] ?? null);
                  }}
                  style={[
                    styles.modeBtn,
                    {
                      backgroundColor: generateMode === "topic" ? tokens.mintSoft : tokens.paper,
                      borderColor: generateMode === "topic" ? tokens.mint : tokens.border,
                    },
                  ]}
                >
                  <Text style={[styles.modeBtnText, { color: generateMode === "topic" ? tokens.mint : tokens.ink }]}>
                    {t("study.mode_topic", "Specific Topic")}
                  </Text>
                </TouchableOpacity>
              </View>

              {generateMode === "topic" && topicNames.length > 0 && (
                <View style={styles.topicSelector}>
                  <Text style={[styles.topicSelectorLabel, { color: tokens.inkMuted }]}>
                    {t("study.select_topic", "Select Topic")}
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.topicChips}>
                    {topicNames.map((topic, idx) => (
                      <TouchableOpacity
                        key={idx}
                        onPress={() => setSelectedTopic(topic)}
                        style={[
                          styles.topicChip,
                          {
                            backgroundColor: selectedTopic === topic ? tokens.mintSoft : tokens.paper,
                            borderColor: selectedTopic === topic ? tokens.mint : tokens.border,
                          },
                        ]}
                      >
                        <Text style={[styles.topicChipText, { color: selectedTopic === topic ? tokens.mint : tokens.ink }]}>
                          {topic}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            <View style={styles.generateRow}>
              <GenerateButton
                label={t("study.generate_mcq", "MCQs")}
                icon="list-outline"
                assetType="mcq"
                loading={generatingType === "mcq"}
                disabled={!selectedMaterial?.parsed_structure || (generateMode === "topic" && !selectedTopic)}
                tokens={tokens}
                onPress={() => handleGenerateAsset("mcq", generateCount, selectedTopic, generateMode)}
              />
              <GenerateButton
                label={t("study.generate_flashcards", "Flashcards")}
                icon="layers-outline"
                assetType="flashcard"
                loading={generatingType === "flashcard"}
                disabled={!selectedMaterial?.parsed_structure || (generateMode === "topic" && !selectedTopic)}
                tokens={tokens}
                onPress={() => handleGenerateAsset("flashcard", generateCount, selectedTopic, generateMode)}
              />
            </View>
          </Animated.View>

          <AssetBrowser
            assets={selectedMaterial.assets}
            userBalance={currentUser?.service_credit_balance ?? 0}
            cashableBalance={currentUser?.cashable_balance ?? 0}
            onUnlock={handleAssetUnlock}
            unlockedAssets={unlockedAssets}
            onQuizComplete={handleQuizComplete}
          />
        </View>
      </ScrollView>

      {/* Action Menu */}
      <Modal
        visible={actionMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setActionMenuVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setActionMenuVisible(false)}
        >
          <View style={[styles.actionMenu, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            <TouchableOpacity
              onPress={handleEditPress}
              style={styles.actionMenuItem}
              accessibilityRole="button"
              accessibilityLabel="Edit material"
            >
              <Ionicons name="pencil-outline" size={20} color={tokens.ink} />
              <Text style={[styles.actionMenuText, { color: tokens.ink }]}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setActionMenuVisible(false);
                setShareFormatVisible(true);
              }}
              style={styles.actionMenuItem}
              accessibilityRole="button"
              accessibilityLabel="Share material"
            >
              <Ionicons name="share-outline" size={20} color={tokens.ink} />
              <Text style={[styles.actionMenuText, { color: tokens.ink }]}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleDeletePress}
              style={styles.actionMenuItem}
              accessibilityRole="button"
              accessibilityLabel="Delete material"
            >
              <Ionicons name="trash-outline" size={20} color={tokens.signal} />
              <Text style={[styles.actionMenuText, { color: tokens.signal }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Share Format Picker */}
      <Modal
        visible={shareFormatVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setShareFormatVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShareFormatVisible(false)}
        >
          <View style={[styles.shareFormatModal, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            <Text style={[styles.shareFormatTitle, { color: tokens.ink }]}>Share as</Text>
            {([
              { format: "pdf" as const, label: "PDF", icon: "document-text-outline", desc: "Formatted document" },
              { format: "docx" as const, label: "DOCX", icon: "document-outline", desc: "Word document" },
              { format: "txt" as const, label: "TXT", icon: "document-attach-outline", desc: "Plain text" },
              { format: "image" as const, label: "Image", icon: "image-outline", desc: "PNG image" },
            ]).map((item) => (
              <TouchableOpacity
                key={item.format}
                onPress={() => handleSharePress(item.format)}
                style={[styles.shareFormatItem, { borderBottomColor: tokens.border }]}
                accessibilityRole="button"
                accessibilityLabel={`Share as ${item.label}`}
              >
                <View style={[styles.shareFormatIcon, { backgroundColor: tokens.mintSoft }]}>
                  <Ionicons name={item.icon as any} size={22} color={tokens.mint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.shareFormatLabel, { color: tokens.ink }]}>{item.label}</Text>
                  <Text style={[styles.shareFormatDesc, { color: tokens.inkMuted }]}>{item.desc}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={tokens.inkMuted} />
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Edit Modal */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.editModal, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            <Text style={[styles.editModalTitle, { color: tokens.ink }]}>Edit Material</Text>
            <TextInput
              style={[styles.editInput, { backgroundColor: tokens.paper, borderColor: tokens.border, color: tokens.ink }]}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="Material title"
              placeholderTextColor={tokens.inkFaint}
              autoFocus
            />
            <Text style={[styles.editLabel, { color: tokens.inkMuted }]}>Exam Type</Text>
            <View style={styles.editExamChips}>
              {EXAM_TYPE_KEYS.map((et) => (
                <TouchableOpacity
                  key={et}
                  onPress={() => setEditExamType(editExamType === et ? null : et)}
                  style={[
                    styles.editChip,
                    {
                      backgroundColor: editExamType === et ? tokens.mintSoft : tokens.paper2,
                      borderColor: editExamType === et ? tokens.mint : tokens.border,
                    },
                  ]}
                >
                  <Text style={[styles.editChipText, { color: editExamType === et ? tokens.mint : tokens.inkMuted }]}>
                    {t(`study.sow_upload.exam_types.${et}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.editActions}>
              <Pressable
                onPress={() => setEditModalVisible(false)}
                style={[styles.editBtn, { borderColor: tokens.border }]}
              >
                <Text style={[styles.editBtnText, { color: tokens.inkMuted }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleEditSubmit}
                style={[styles.editBtn, { backgroundColor: tokens.mint }]}
              >
                <Text style={[styles.editBtnText, { color: tokens.mintText }]}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete Confirmation */}
      <Modal
        visible={deleteConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteConfirmVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setDeleteConfirmVisible(false)}
        >
          <View style={[styles.deleteDialog, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            <Ionicons name="warning-outline" size={32} color={tokens.signal} />
            <Text style={[styles.deleteTitle, { color: tokens.ink }]}>Delete Material?</Text>
            <Text style={[styles.deleteMessage, { color: tokens.inkMuted }]}>
              This will permanently delete "{selectedMaterial?.title}" and all its generated assets. This action cannot be undone.
            </Text>
            <View style={styles.deleteActions}>
              <Pressable
                onPress={() => setDeleteConfirmVisible(false)}
                style={[styles.deleteBtn, { borderColor: tokens.border }]}
              >
                <Text style={[styles.deleteBtnText, { color: tokens.inkMuted }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleDeleteConfirm}
                style={[styles.deleteBtn, { backgroundColor: tokens.signal }]}
              >
                <Text style={[styles.deleteBtnText, { color: "#fff" }]}>Delete</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function GenerateButton({
  label,
  icon,
  assetType,
  onPress,
  loading,
  disabled,
  tokens,
  full,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  assetType: string;
  onPress: () => void;
  loading: boolean;
  disabled?: boolean;
  tokens: (typeof PagePay)["light"];
  full?: boolean;
}) {
  if (loading) {
    return (
      <View
        style={[
          styles.genBtn,
          full && styles.genBtnFull,
          {
            borderColor: tokens.border,
            backgroundColor: tokens.paper,
          },
        ]}
      >
        <ActivityIndicator size="small" color={tokens.mint} />
      </View>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={loading || disabled}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={loading ? `Generating ${label}` : `Generate ${label}`}
      accessibilityState={{ disabled: loading || disabled, busy: loading }}
      accessibilityHint={`Generate new ${label} study materials`}
      style={[
        styles.genBtn,
        full && styles.genBtnFull,
        {
          borderColor: tokens.border,
          backgroundColor: disabled ? tokens.paper : tokens.card,
        },
      ]}
    >
      <Ionicons
        name={icon}
        size={18}
        color={disabled ? tokens.inkMuted : tokens.mint}
        accessibilityLabel=""
      />
      <Text style={[styles.genText, { color: disabled ? tokens.inkMuted : tokens.ink }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 48,
  },
  generateBlock: {
    gap: 12,
  },
  genHeading: {
    fontSize: 16,
    letterSpacing: -0.2,
  },
  generateRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  genBtn: {
    flex: 1,
    minWidth: 90,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  genBtnFull: {
    flexBasis: "100%",
  },
  genBtnShimmer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  genText: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  generateOptions: {
    gap: 10,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  generateOptionsLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  modeSelector: {
    flexDirection: "row",
    gap: 8,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  modeBtnText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  topicSelector: {
    gap: 8,
  },
  topicSelectorLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  topicChips: {
    flexDirection: "row",
    gap: 6,
  },
  topicChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  topicChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  loadingState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  loadingText: {
    fontSize: 14,
    textAlign: "center",
  },
  errorState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 16,
  },
  errorText: {
    fontSize: 16,
    fontWeight: "600",
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
  },
  backBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PagePay.light.mint,
  },
  backBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
  detailView: {
    gap: 16,
    paddingTop: 8,
  },
  loadingPages: {
    paddingVertical: 24,
    paddingHorizontal: 16,
    gap: 12,
  },
  loadingPagesText: {
    fontSize: 13,
  },
  pdfScroll: {
    marginTop: 8,
  },
  pdfPageImage: {
    width: 320,
    height: 420,
    borderRadius: 8,
    backgroundColor: PagePay.light.paper2,
    marginRight: 12,
  },
  openFileBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
  },
  openFileText: {
    fontSize: 14,
    fontWeight: "600",
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
  },
  outlineTitle: {
    fontSize: 16,
    letterSpacing: -0.2,
  },
  outlineMeta: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  outlineList: {
    gap: 8,
    marginTop: 8,
  },
  outlineItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  outlineNum: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    width: 22,
  },
  outlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  outlineText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
  },
  outlineCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  materialPreviewCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  materialPreviewImage: {
    width: "100%",
    height: 220,
    borderRadius: 10,
  },
  filePreviewFallback: {
    width: "100%",
    height: 220,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  filePreviewFallbackText: {
    fontSize: 12,
    fontFamily: Fonts.sans as string,
  },
  materialPreviewStack: {
    gap: 4,
  },
  materialPreviewText: {
    fontSize: 14,
    lineHeight: 21,
  },
  readBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
  },
  readBtnText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: -0.1,
  },
  readerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  readerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
  },
  readerHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  readerTtsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: PagePay.light.mint,
  },
  readerTtsText: {
    fontSize: 13,
    fontWeight: "600",
  },
  readerCloseBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  readerContent: {
    flex: 1,
    padding: 16,
  },
  readerText: {
    fontSize: 15,
    lineHeight: 24,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    zIndex: 9999,
    elevation: 9999,
  },
  actionMenu: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  actionMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionMenuText: {
    fontSize: 15,
    fontWeight: "600",
  },
  editModal: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 16,
  },
  editModalTitle: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  editInput: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  editLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  editExamChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  editChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  editChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  editActions: {
    flexDirection: "row",
    gap: 10,
  },
  editBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1,
  },
  editBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
  deleteDialog: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    gap: 16,
    alignItems: "center",
  },
  deleteTitle: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  deleteMessage: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  deleteActions: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  deleteBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1,
  },
  deleteBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
  shareFormatModal: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  shareFormatTitle: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.2,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  shareFormatItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  shareFormatIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  shareFormatLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  shareFormatDesc: {
    fontSize: 12,
    marginTop: 2,
  },
});
