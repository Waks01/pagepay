import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";

import { apiFetch, API_URL } from "@/src/shared/api/client";
import { Fonts, PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { PageHeader } from "@/components/PageHeader";
import AudioUnlockModal from "@/components/AudioUnlockModal";
import { getTopicNames } from "@/src/app/(app)/study";
import { ProgressDashboard } from "@/components/study/ProgressDashboard";

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
  const [audioUnlockVisible, setAudioUnlockVisible] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [actionMenuVisible, setActionMenuVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editExamType, setEditExamType] = useState<string | null>(null);
  const [shareFormatVisible, setShareFormatVisible] = useState(false);
  const [pdfPages, setPdfPages] = useState<Array<{ page: number; total: number; image_base64: string; width: number; height: number }> | null>(null);
  const [loadingPages, setLoadingPages] = useState(false);
  const studySessionIdRef = useRef<number | null>(null);

  const materialQ = useQuery({
    queryKey: ["study", "material", materialId],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/study/materials/${materialId}`);
      if (!res.ok) throw new Error("Failed to load material");
      return res.json() as Promise<MaterialDetail>;
    },
  });

  const progressQ = useQuery({
    queryKey: ["study", "progress", materialId],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/study/materials/${materialId}/progress`);
      if (!res.ok) throw new Error("Failed to load progress");
      return res.json();
    },
    enabled: !!selectedMaterial,
  });

  useEffect(() => {
    if (materialQ.data) {
      setSelectedMaterial(materialQ.data);
    }
  }, [materialQ.data]);

  useEffect(() => {
    let cancelled = false;
    if (selectedMaterial?.file_mime_type === "application/pdf" && selectedMaterial.has_original_file) {
      setLoadingPages(true);
      apiFetch(`/api/v1/study/materials/${selectedMaterial.id}/pages`)
        .then(async (res) => {
          if (!res.ok) throw new Error("Failed to load pages");
          const data = await res.json();
          if (!cancelled) setPdfPages(data.pages || []);
        })
        .catch((err) => {
          if (!cancelled) console.error("Failed to load PDF pages:", err);
        })
        .finally(() => {
          if (!cancelled) setLoadingPages(false);
        });
    } else {
      setPdfPages(null);
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

  const handleTtsPress = useCallback(async () => {
    if (!selectedMaterial?.content) return;
    // TTS logic moved to /reader.tsx
  }, [selectedMaterial]);

  const handleGenerateAsset = async (
    assetType: string,
    count?: number,
    topic?: string | null,
    mode?: "topic" | "all",
  ) => {
    setGeneratingType(assetType);
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
      const destPath = `${FileSystem.cacheDirectory}${filename}`;
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

  const handleUnlock = async () => {
    if (!selectedMaterial) return;
    try {
      const res = await apiFetch(
        `/api/v1/study/materials/${selectedMaterial.id}/unlock-audio`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: "sv" }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unlock failed" }));
        throw new Error(err.detail || "Unlock failed");
      }
      qc.invalidateQueries({ queryKey: ["audio-unlock-status"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      setAudioUnlocked(true);
      setAudioUnlockVisible(false);
    } catch (error) {
      console.error("Audio unlock failed:", error);
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
          {progressQ.data && (
            <Animated.View entering={FadeInDown.duration(240).springify()}>
              <ProgressDashboard
                materialId={materialId}
                totalTopics={progressQ.data.total_topics}
                mastered={progressQ.data.mastered}
                reviewing={progressQ.data.reviewing}
                notStarted={progressQ.data.not_started}
                progress={progressQ.data.progress}
              />
            </Animated.View>
          )}

          {selectedMaterial.has_original_file && selectedMaterial.file_mime_type?.startsWith("image/") && (
            <Animated.View entering={FadeInDown.delay(60).duration(240).springify()}>
              <Image
                source={{ uri: `${API_URL}/api/v1/study/materials/${materialId}/file` }}
                style={styles.materialImage}
                resizeMode="contain"
              />
            </Animated.View>
          )}

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
                  <Image
                    source={{ uri: `${API_URL}/api/v1/study/materials/${selectedMaterial.id}/file` }}
                    style={styles.materialPreviewImage}
                    resizeMode="contain"
                  />
                )}

                {selectedMaterial.file_mime_type === "application/pdf" && (
                  <View>
                    {loadingPages ? (
                      <View style={styles.loadingPages}>
                        <Text style={[styles.loadingPagesText, { color: tokens.inkMuted }]}>
                          Rendering PDF pages…
                        </Text>
                      </View>
                    ) : pdfPages && pdfPages.length > 0 ? (
                      <ScrollView
                        horizontal
                        pagingEnabled
                        showsHorizontalScrollIndicator={false}
                        style={styles.pdfScroll}
                      >
                        {pdfPages.map((page) => (
                          <Image
                            key={page.page}
                            source={{ uri: `data:image/png;base64,${page.image_base64}` }}
                            style={styles.pdfPageImage}
                            resizeMode="contain"
                          />
                        ))}
                      </ScrollView>
                    ) : (
                      <Pressable
                        onPress={() => {
                          const url = `${API_URL}/api/v1/study/materials/${selectedMaterial.id}/file`;
                          Linking.openURL(url);
                        }}
                        style={[styles.openFileBtn, { borderColor: tokens.border }]}
                      >
                        <Ionicons name="document-outline" size={18} color={tokens.mint} />
                        <Text style={[styles.openFileText, { color: tokens.mint }]}>
                          Open PDF
                        </Text>
                      </Pressable>
                    )}
                  </View>
                )}

                {selectedMaterial.file_mime_type && !selectedMaterial.file_mime_type.startsWith("image/") && selectedMaterial.file_mime_type !== "application/pdf" && (
                  <Pressable
                    onPress={() => {
                      const url = `${API_URL}/api/v1/study/materials/${selectedMaterial.id}/file`;
                      Linking.openURL(url);
                    }}
                    style={[styles.openFileBtn, { borderColor: tokens.border }]}
                  >
                    <Ionicons name="document-outline" size={18} color={tokens.mint} />
                    <Text style={[styles.openFileText, { color: tokens.mint }]}>
                      Open File
                    </Text>
                  </Pressable>
                )}
              </View>
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
                <Text
                  style={[styles.materialPreviewText, { color: tokens.ink }]}
                  numberOfLines={6}
                >
                  {selectedMaterial.content}
                </Text>
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
                  onPress={() => setGenerateMode("topic")}
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
                tokens={tokens}
                onPress={() => handleGenerateAsset("mcq", generateCount, selectedTopic, generateMode)}
              />
              <GenerateButton
                label={t("study.generate_flashcards", "Flashcards")}
                icon="layers-outline"
                assetType="flashcard"
                loading={generatingType === "flashcard"}
                tokens={tokens}
                onPress={() => handleGenerateAsset("flashcard", generateCount, selectedTopic, generateMode)}
              />
            </View>
          </Animated.View>

          <AssetBrowser
            assets={selectedMaterial.assets}
            userBalance={0}
            onUnlock={async (assetId) => {
              try {
                const res = await apiFetch(`/api/v1/study/unlock`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ asset_id: assetId, method: "points" }),
                });
                if (!res.ok) {
                  if (res.status === 402) {
                    alert("Insufficient points to unlock this asset.");
                    return;
                  }
                  const err = await res.json().catch(() => ({ detail: "Unlock failed" }));
                  throw new Error(err.detail || "Unlock failed");
                }
                qc.invalidateQueries({ queryKey: ["study", "material", materialId] });
              } catch (err) {
                if (__DEV__) console.error("Asset unlock failed:", err);
              }
            }}
            unlockedAssets={unlockedAssets}
            onQuizComplete={async () => {}}
          />
        </View>
      </ScrollView>

      <AudioUnlockModal
        visible={audioUnlockVisible}
        materialId={selectedMaterial.id}
        materialTitle={selectedMaterial.title}
        contentLength={selectedMaterial.content?.length ?? 0}
        onClose={() => setAudioUnlockVisible(false)}
        onUnlocked={() => {
          setAudioUnlocked(true);
          setAudioUnlockVisible(false);
        }}
      />

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
              {['jamb', 'waec', 'neco', 'nabteb', 'custom'].map((et) => (
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
                    {et.toUpperCase()}
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

function AssetBrowser({
  assets,
  onUnlock,
  unlockedAssets,
  onQuizComplete,
  userBalance,
}: {
  assets: MaterialDetail["assets"];
  onUnlock: (assetId: number) => void;
  unlockedAssets: Record<number, unknown>;
  onQuizComplete: (assetId: number, score: number) => void;
  userBalance: number;
}) {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  if (!assets.length) return null;

  return (
    <View style={styles.assetBrowser}>
      {assets.map((asset) => (
        <View
          key={asset.id}
          style={[styles.assetCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}
        >
          <Text style={[styles.assetTitle, { color: tokens.ink }]}>
            {asset.type.toUpperCase()}
          </Text>
          <Text style={[styles.assetMeta, { color: tokens.inkMuted }]}>
            {asset.points_to_unlock} points to unlock
          </Text>
          {asset.unlocked ? (
            <Pressable
              style={[styles.assetBtn, { backgroundColor: tokens.mint }]}
              onPress={() => onQuizComplete(asset.id, 80)}
            >
              <Text style={[styles.assetBtnText, { color: tokens.mintText }]}>View</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.assetBtn, { borderColor: tokens.border }]}
              onPress={() => onUnlock(asset.id)}
            >
              <Text style={[styles.assetBtnText, { color: tokens.ink }]}>Unlock</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}

function GenerateButton({
  label,
  icon,
  assetType,
  onPress,
  loading,
  tokens,
  full,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  assetType: string;
  onPress: () => void;
  loading: boolean;
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
        <PagePaySpinner size={20} />
      </View>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={loading ? `Generating ${label}` : `Generate ${label}`}
      accessibilityState={{ disabled: loading, busy: loading }}
      accessibilityHint={`Generate new ${label} study materials`}
      style={[
        styles.genBtn,
        full && styles.genBtnFull,
        {
          borderColor: tokens.border,
          backgroundColor: tokens.card,
        },
      ]}
    >
      <Ionicons
        name={icon}
        size={18}
        color={tokens.mint}
        accessibilityLabel=""
      />
      <Text style={[styles.genText, { color: tokens.ink }]} numberOfLines={1}>
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
  materialImage: {
    width: "100%",
    height: 240,
    borderRadius: 12,
    backgroundColor: PagePay.light.paper2,
  },
  loadingPages: {
    paddingVertical: 24,
    alignItems: "center",
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
  assetBrowser: {
    gap: 10,
    marginTop: 8,
  },
  assetCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  assetTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  assetMeta: {
    fontSize: 12,
  },
  assetBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  assetBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },
});
