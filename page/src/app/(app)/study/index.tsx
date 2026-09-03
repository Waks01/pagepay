import { useState, useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Image,
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
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "@/src/shared/utils/dateFormatter";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import { useAudioPlayer } from "expo-audio";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";

import { apiFetch, API_URL } from "@/src/shared/api/client";
import { pollSowJob } from "@/src/features/study/api";
import {
  useMaterials,
  useUploadSow,
  useUploadSowImage,
  useUploadSowDocument,
  useClaimQuizBonus,
  useGenerateExample,
} from "@/src/features/study/hooks/use-study";
import { useImagePicker } from "@/src/shared/hooks/use-image-picker";
import { useDocumentPicker } from "@/src/shared/hooks/use-document-picker";
import { useCurrentUser } from "@/src/shared/lib/current-user";
import { SowUploadCard } from "@/components/study/SowUploadCard";
import { AssetBrowser } from "@/components/study/AssetBrowser";
import { ProgressDashboard } from "@/components/study/ProgressDashboard";
import { PageHeader } from "@/components/PageHeader";
import { UserAvatar } from "@/components/UserAvatar";
import { Fonts, PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import NotificationBell from "@/components/NotificationBell";
import { SkeletonPage, SkeletonDetailPage } from "@/components/skeletons";
import { PagePaySpinner } from "@/components/PagePaySpinner";
import AudioUnlockModal from "@/components/AudioUnlockModal";
import { cacheAsset, getCachedAsset } from "@/src/features/study/storage";
import { saveLastRoute, getLastRoute } from "@/src/shared/lib/screen-memory";

// Pass the server's actual error message through unchanged so the user
// can see exactly what failed. Only translate when the message is empty
// or looks like a useless fall-through ("Failed", "Upload failed", etc.).
// Categorization by string-substring matching is fragile (it collapses
// real backend `detail` strings into a generic bucket) and is being
// phased out per developer feedback — see study/index.tsx history.
function categorizeError(
  message: string,
  operation: string,
  t: (key: string, params?: Record<string, unknown>) => string,
): string {
  if (message && message.length > 0) {
    return message;
  }
  return t("study.errors.generic", { operation, message: "(no detail)" });
}

type TopicInfo = {
  name: string;
  subtopics: string[];
  key_concepts: string[];
};

type AssetInfo = {
  id: number;
  material_id: number;
  type: string;
  points_to_unlock: number;
  // Optional fields that the backend includes for already-unlocked assets.
  unlocked?: boolean;
  content?: unknown;
};

export function getTopicNames(parsed: Record<string, unknown> | null): string[] {
  if (!parsed) return [];
  const topics = parsed.topics as TopicInfo[] | undefined;
  if (!topics) return [];
  return topics.map((t) => t.name);
}

function getTopicCount(
  parsed: Record<string, unknown> | null,
  topicName: string,
): number {
  if (!parsed) return 0;
  const topics = parsed.topics as TopicInfo[] | undefined;
  if (!topics) return 0;
  const topic = topics.find((t) => t.name === topicName);
  if (!topic) return 0;
  return topic.subtopics.length + topic.key_concepts.length;
}

function getWordCount(text: string | null | undefined): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

type MaterialDetail = {
  id: number;
  title: string;
  exam_type: string | null;
  parsed_structure: Record<string, unknown> | null;
  content: string | null;
  assets: AssetInfo[];
  created_at: string;
};

export default function StudyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const qc = useQueryClient();

  const materialsQ = useMaterials();
  const [selectedMaterialId, setSelectedMaterialId] = useState<number | null>(
    null,
  );
  const [selectedMaterial, setSelectedMaterial] =
    useState<MaterialDetail | null>(null);
  const [unlockedAssets, setUnlockedAssets] = useState<Record<number, unknown>>(
    {},
  );
  const [generatingType, setGeneratingType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const [bonusNotification, setBonusNotification] = useState<string | null>(
    null,
  );
  const [uploadProgress, setUploadProgress] = useState<number | undefined>(
    undefined,
  );
  const [aiProcessing, setAiProcessing] = useState(false);
  const [uploadJustCompleted, setUploadJustCompleted] = useState(false);
  const studySessionIdRef = useRef<number | null>(null);
  const [examType, setExamType] = useState<string | null>(null);
  const [materialLoading, setMaterialLoading] = useState(false);
  const materialFetchIdRef = useRef(0);
  const [generateMode, setGenerateMode] = useState<"topic" | "all">("all");
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [generateCount, setGenerateCount] = useState<number>(15);
  const [showReader, setShowReader] = useState(false);
  const [ttsUrl, setTtsUrl] = useState<string | null>(null);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsLoading, setTtsLoading] = useState(false);
  const player = useAudioPlayer(ttsUrl);
  const [audioUnlockVisible, setAudioUnlockVisible] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [actionMenuVisible, setActionMenuVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editExamType, setEditExamType] = useState<string | null>(null);
  const [shareFormatVisible, setShareFormatVisible] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);

  // Load cached assets on mount
  useEffect(() => {
    let cancelled = false;
    if (selectedMaterial) {
      loadCachedAssets(selectedMaterial.id);
      const begin = async () => {
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
      };
      begin();
      setSelectedTopic(null);
      setGenerateMode("all");
    }

    return () => {
      cancelled = true;
      if (studySessionIdRef.current) {
        const sid = studySessionIdRef.current;
        studySessionIdRef.current = null;
        endStudySession(sid);
      }
    };
  }, [selectedMaterial]);

  // Restore last selected material on mount
  useEffect(() => {
    // Navigation to last route removed to ensure Study tab lands on main index page
  }, []);

  // Persist selected material to route memory
  useEffect(() => {
    if (selectedMaterialId) {
      saveLastRoute(`/study/materials/${selectedMaterialId}`);
    }
  }, [selectedMaterialId]);

  const loadCachedAssets = async (materialId: number) => {
    try {
      if (!selectedMaterial) return;

      for (const asset of selectedMaterial.assets) {
        if (!(asset.id in unlockedAssets)) {
          const cached = await getCachedAsset(asset.id);
          if (cached && cached.materialId === materialId) {
            setUnlockedAssets((prev) => ({
              ...prev,
              [asset.id]: cached.content,
            }));
          }
        }
      }
    } catch (error) {
      if (__DEV__) console.error("Failed to load cached assets:", error);
    }
  };

  const endStudySession = async (sessionId: number) => {
    try {
      const res = await apiFetch("/api/v1/study/session/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });

      if (res.ok) {
        // duration_seconds is returned for analytics; the value is
        // available on the server-side session log.
        await res.json();
      }
    } catch (error) {
      if (__DEV__) console.error("Failed to end study session:", error);
    }
  };

  const handleTtsPress = async () => {
    if (!selectedMaterial?.content) return;
    if (ttsPlaying) {
      player.pause();
      setTtsPlaying(false);
      return;
    }
    if (ttsUrl) {
      player.play();
      setTtsPlaying(true);
      return;
    }

    if (!audioUnlocked) {
      setAudioUnlockVisible(true);
      return;
    }

    try {
      setTtsLoading(true);
      const res = await apiFetch("/api/v1/study/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: selectedMaterial.content,
          voice: "en-US-AriaNeural",
          material_id: selectedMaterial.id,
        }),
      });
      if (!res.ok) {
        if (res.status === 403) {
          setAudioUnlockVisible(true);
          return;
        }
        throw new Error("TTS request failed");
      }
      const data = (await res.json()) as { url: string };
      const fullUrl = data.url.startsWith("http")
        ? data.url
        : `${API_URL}${data.url}`;
      setTtsUrl(fullUrl);
      setTtsPlaying(true);
    } catch (error) {
      if (__DEV__) console.error("TTS failed:", error);
    } finally {
      setTtsLoading(false);
    }
  };

  const handleBack = () => {
    if (studySessionIdRef.current) {
      const sid = studySessionIdRef.current;
      endStudySession(sid);
      studySessionIdRef.current = null;
    }
    setSelectedMaterialId(null);
    setSelectedMaterial(null);
  };

  // Read the user from the global store. The user object is loaded
  // once at app start — no per-screen /me fetch.
  const meQ = useCurrentUser();

  const uploadMutation = useUploadSow();
  const uploadImageMutation = useUploadSowImage();
  const uploadDocumentMutation = useUploadSowDocument();
  const { pickImage, takePhoto } = useImagePicker();
  const { pickDocument } = useDocumentPicker();
  const claimBonusMutation = useClaimQuizBonus();
  const generateExampleMutation = useGenerateExample();

  const handleUploadText = async (text: string, examType: string | null) => {
    setError(null);
    setRetryAction(null);
    setUploadProgress(0);
    try {
      // Client-side validation
      if (text.trim().length < 10) {
        throw new Error(t("study.errors.text_too_short"));
      }
      if (text.length > 50000) {
        throw new Error(t("study.errors.text_too_long"));
      }

      // Text uploads are JSON (not multipart), so there is no wire-level
      // progress to surface. Show a small "in flight" tick to confirm
      // activity, then jump straight to 100 when the response arrives.
      setUploadProgress(50);
      const result = await uploadMutation.mutateAsync({
        text,
        exam_type: examType,
      });
      setSelectedMaterialId(result.material_id);
      const res = await apiFetch(
        `/api/v1/study/materials/${result.material_id}`,
      );
      if (res.ok) {
        setSelectedMaterial(await res.json());
      }
      setUploadProgress(100);
      setTimeout(() => setUploadProgress(undefined), 2000);
    } catch (err) {
      setUploadProgress(undefined);
      const message = err instanceof Error ? err.message : "Upload failed";
      const specificError = categorizeError(message, "upload text", t);
      setError(specificError);
      setRetryAction(() => () => handleUploadText(text, examType));
    }
  };

  // Wire-level progress for file uploads. The XHR fires onprogress with
  // real byte counts; we map that to 0..80% of the bar. 80→99 is the
  // server AI-processing window — the polling endpoint doesn't give us
  // a percentage, so we tick 1% per poll to show the bar advancing
  // while the work is happening. 100 means the follow-up material
  // fetch is done.
  const handleUploadProgress = (loaded: number, total: number) => {
    if (total <= 0) return;
    const pct = Math.min(80, Math.round((loaded / total) * 80));
    setUploadProgress(pct);
  };

  const handlePollTick = () => {
    setUploadProgress((prev) => {
      const current = prev ?? 0;
      return current >= 99 ? current : Math.min(99, current + 1);
    });
  };

  // Shared tail: after the SOW job is completed, fetch the full
  // MaterialDetail so the screen can render the asset browser. The
  // 100% tick is held until this fetch resolves so the success banner
  // only shows when there's actually something to show.
  const finalizeUploadSuccess = async (materialId: number) => {
    setSelectedMaterialId(materialId);
    setUploadJustCompleted(true);
    const res = await apiFetch(`/api/v1/study/materials/${materialId}`);
    if (res.ok) {
      setSelectedMaterial(await res.json());
    }
    setUploadProgress(100);
    qc.invalidateQueries({ queryKey: ["study", "materials"] });
    setTimeout(() => {
      setUploadProgress(undefined);
      setUploadJustCompleted(false);
    }, 3000);
  };

  const handleUploadImage = async (examType: string | null) => {
    setError(null);
    setRetryAction(null);
    setUploadProgress(0);
    try {
      const file = await pickImage();
      if (!file) {
        setUploadProgress(undefined);
        return;
      }

      const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
      if (file.type && !validTypes.includes(file.type.toLowerCase())) {
        throw new Error(t("study.errors.invalid_file_type"));
      }

      setPreviewFile({ uri: file.uri, name: file.name, type: file.type });
      setPreviewVisible(true);
    } catch (err) {
      setUploadProgress(undefined);
      const message = err instanceof Error ? err.message : "Upload failed";
      const specificError = categorizeError(message, "image upload", t);
      setError(specificError);
      setRetryAction(() => () => handleUploadImage(examType));
    }
  };

  const handleTakePhoto = async (examType: string | null) => {
    setError(null);
    setRetryAction(null);
    setUploadProgress(0);
    try {
      const file = await takePhoto();
      if (!file) {
        setUploadProgress(undefined);
        return;
      }
      setPreviewFile({ uri: file.uri, name: file.name, type: file.type });
      setPreviewVisible(true);
    } catch (err) {
      setUploadProgress(undefined);
      const message = err instanceof Error ? err.message : "Upload failed";
      const specificError = categorizeError(message, "photo upload", t);
      setError(specificError);
      setRetryAction(() => () => handleTakePhoto(examType));
    }
  };

  const handleUploadDocument = async (examType: string | null) => {
    setError(null);
    setRetryAction(null);
    setUploadProgress(0);
    try {
      const file = await pickDocument();
      if (!file) {
        setUploadProgress(undefined);
        return;
      }
      setPreviewFile({ uri: file.uri, name: file.name, type: file.type });
      setPreviewVisible(true);
    } catch (err) {
      setUploadProgress(undefined);
      const message = err instanceof Error ? err.message : "Upload failed";
      const specificError = categorizeError(message, "document upload", t);
      setError(specificError);
      setRetryAction(() => () => handleUploadDocument(examType));
    }
  };

  const confirmUpload = async () => {
    if (!previewFile) return;
    setPreviewVisible(false);
    setUploadProgress(0);
    try {
      const isImage = previewFile.type.startsWith("image/");
      const isPdf = previewFile.type === "application/pdf";
      if (isImage) {
        const { job_id } = await uploadImageMutation.mutateAsync({
          file: { uri: previewFile.uri, name: previewFile.name, type: previewFile.type },
          exam_type: examType,
          onProgress: handleUploadProgress,
        });
        setAiProcessing(true);
        setUploadProgress(80);
        const job = await pollSowJob(job_id, handlePollTick);
        setAiProcessing(false);
        if (job.status === "failed" || !job.material_id) {
          throw new Error(job.error || "Image processing failed");
        }
        await finalizeUploadSuccess(job.material_id);
      } else if (isPdf) {
        const { job_id } = await uploadDocumentMutation.mutateAsync({
          file: { uri: previewFile.uri, name: previewFile.name, type: previewFile.type },
          exam_type: examType,
          onProgress: handleUploadProgress,
        });
        setAiProcessing(true);
        setUploadProgress(80);
        const job = await pollSowJob(job_id, handlePollTick);
        setAiProcessing(false);
        if (job.status === "failed" || !job.material_id) {
          throw new Error(job.error || "Document processing failed");
        }
        await finalizeUploadSuccess(job.material_id);
      } else {
        throw new Error("Unsupported file type");
      }
    } catch (err) {
      setUploadProgress(undefined);
      const message = err instanceof Error ? err.message : "Upload failed";
      setError(message);
    } finally {
      setPreviewFile(null);
    }
  };

  const handleQuizComplete = async (assetId: number, score: number) => {
    try {
      const result = await claimBonusMutation.mutateAsync({
        asset_id: assetId,
        score,
      });
      if (result.bonus_awarded) {
        setBonusNotification(`+${result.bonus_points} pts! Score: ${score}%`);
        setTimeout(() => setBonusNotification(null), 4000);
      }
      qc.invalidateQueries({ queryKey: ["me"] });
    } catch {
      // silent fail — bonus is optional
    }
  };

  const handleUnlock = async (assetId: number) => {
    setError(null);
    setRetryAction(null);
    const res = await apiFetch("/api/v1/study/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ asset_id: assetId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      const message = err.detail || "Unlock failed";
      const specificError = categorizeError(message, "unlock", t);
      throw new Error(specificError);
    }
    const data = await res.json();
    if (data.unlocked && data.content) {
      setUnlockedAssets((prev) => ({ ...prev, [assetId]: data.content }));

      // Cache the unlocked asset for offline access
      if (selectedMaterialId) {
        try {
          await cacheAsset(assetId, data.content, selectedMaterialId);
        } catch (error) {
          if (__DEV__) console.error("Failed to cache unlocked asset:", error);
          // Don't throw - caching is optional
        }
      }
    }
    qc.invalidateQueries({ queryKey: ["me"] });
    return data;
  };

  const handleMaterialPress = async (materialId: number) => {
    router.push(`/study/${materialId}`);
  };

  const handleChatPress = (materialId: number) => {
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
      const filename =
        contentDisposition?.match(/filename="?([^"]+)"?/)?.[1] ||
        `material.${format}`;
      const destPath = `${FileSystem.cacheDirectory}${filename}`;

      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(",")[1];
        await FileSystem.writeAsStringAsync(destPath, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(destPath, {
            mimeType:
              res.headers.get("Content-Type") || "application/octet-stream",
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
      const res = await apiFetch(
        `/api/v1/study/materials/${selectedMaterial.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: editTitle.trim(),
            exam_type: editExamType,
          }),
        },
      );
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
      const res = await apiFetch(
        `/api/v1/study/materials/${selectedMaterial.id}`,
        {
          method: "DELETE",
        },
      );
      if (!res.ok) throw new Error("Failed to delete material");
      setSelectedMaterial(null);
      setSelectedMaterialId(null);
      setDeleteConfirmVisible(false);
      qc.invalidateQueries({ queryKey: ["study", "materials"] });
    } catch (err) {
      if (__DEV__) console.error("Delete failed:", err);
    }
  };

  const materials = materialsQ.data ?? [];
  const balance = meQ?.service_credit_balance ?? 0;
  const isLoading = materialsQ.isLoading;
  const totalAssets = selectedMaterial?.assets.length ?? 0;

  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: tokens.paper }}
    >
      {selectedMaterialId != null ? (
        <PageHeader
          title={selectedMaterial?.title ?? t("study.loading_material_title")}
          subtitle={
            selectedMaterial
              ? t("study.assets_generated", { count: totalAssets })
              : t("study.loading_material_subtitle")
          }
          showBack
          onBack={handleBack}
          backgroundColor={tokens.card}
          borderBottomColor={tokens.border}
          tokens={tokens}
          left={
            <View style={styles.headerLeft}>
              <Pressable
                onPress={handleBack}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("common.back")}
                style={({ pressed }) => [
                  styles.headerBackBtn,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Ionicons name="chevron-back" size={22} color={tokens.ink} />
              </Pressable>
              <UserAvatar size={28} />
            </View>
          }
          right={
            <View style={styles.headerRight}>
              <Pressable
                onPress={() => handleChatPress(selectedMaterialId)}
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
                <Ionicons
                  name="chatbubble-ellipses-outline"
                  size={18}
                  color={tokens.ink}
                />
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
                <Ionicons
                  name="ellipsis-vertical"
                  size={18}
                  color={tokens.ink}
                />
              </Pressable>
              <NotificationBell />
            </View>
          }
        />
      ) : (
        <PageHeader
          title={t("study.title")}
          subtitle={t("study.materials_count", { count: materials.length })}
          backgroundColor={tokens.card}
          borderBottomColor={tokens.border}
          tokens={tokens}
          left={<UserAvatar size={28} />}
          right={<NotificationBell />}
        />
      )}
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={materialsQ.isFetching}
            onRefresh={() =>
              qc.invalidateQueries({ queryKey: ["study", "materials"] })
            }
            tintColor={tokens.mint}
          />
        }
      >
        {selectedMaterial && (
          <Animated.View
            entering={FadeInDown.duration(240).springify()}
            style={styles.headerWrap}
          >
            <View
              style={[
                styles.detailHero,
                { backgroundColor: tokens.card, borderColor: tokens.border },
              ]}
            >
              {selectedMaterial.exam_type && (
                <View
                  style={[
                    styles.eyebrowPill,
                    { backgroundColor: tokens.mintSoft },
                  ]}
                >
                  <Ionicons
                    name="ribbon-outline"
                    size={12}
                    color={tokens.mint}
                  />
                  <Text style={[styles.eyebrowText, { color: tokens.mint }]}>
                    {t("study.material_eyebrow", {
                      exam: selectedMaterial.exam_type.toUpperCase(),
                    })}
                  </Text>
                </View>
              )}
              <Text
                style={[
                  styles.heroTitle,
                  {
                    color: tokens.ink,
                    fontFamily: Fonts.editorialSemiBold as string,
                  },
                ]}
              >
                {selectedMaterial.title.replace(/^[A-Z]+ · /, "")}
              </Text>
              <View style={styles.heroMetaRow}>
                <View style={[styles.heroChip, { borderColor: tokens.border }]}>
                  <Ionicons
                    name="list-outline"
                    size={12}
                    color={tokens.inkMuted}
                  />
                  <Text style={[styles.heroChipText, { color: tokens.ink }]}>
                    {t("study.topics_chip", {
                      count: getTopicNames(selectedMaterial.parsed_structure)
                        .length,
                    })}
                  </Text>
                </View>
                <View style={[styles.heroChip, { borderColor: tokens.border }]}>
                  <Ionicons
                    name="albums-outline"
                    size={12}
                    color={tokens.inkMuted}
                  />
                  <Text style={[styles.heroChipText, { color: tokens.ink }]}>
                    {t("study.assets_chip", { count: totalAssets })}
                  </Text>
                </View>
              </View>
            </View>
          </Animated.View>
        )}
        {error && (
          <Animated.View
            entering={FadeIn.duration(180)}
            style={[
              styles.errorBanner,
              {
                backgroundColor: tokens.signalFaint,
                borderColor: tokens.signal,
              },
            ]}
            accessibilityRole="alert"
            accessibilityLabel={`Error: ${error}`}
          >
            <Ionicons
              name="alert-circle-outline"
              size={18}
              color={tokens.signal}
              accessibilityLabel=""
            />
            <Text style={[styles.errorText, { color: tokens.signal }]}>
              {error}
            </Text>
            {retryAction && (
              <TouchableOpacity
                onPress={retryAction}
                style={[styles.retryBtn, { backgroundColor: tokens.signal }]}
                accessibilityRole="button"
                accessibilityLabel={t("study.retry")}
              >
                <Ionicons
                  name="reload-outline"
                  size={14}
                  color="#fff"
                  accessibilityLabel=""
                />
                <Text style={styles.retryText}>{t("study.retry")}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => {
                setError(null);
                setRetryAction(null);
              }}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t("study.dismiss")}
            >
              <Ionicons
                name="close"
                size={16}
                color={tokens.signal}
                accessibilityLabel=""
              />
            </TouchableOpacity>
          </Animated.View>
        )}
        {bonusNotification && (
          <Animated.View
            entering={FadeIn.duration(180)}
            style={[
              styles.bonusBanner,
              { backgroundColor: tokens.mintSoft, borderColor: tokens.mint },
            ]}
            accessibilityRole="alert"
            accessibilityLabel={`Bonus earned: ${bonusNotification}`}
          >
            <Ionicons
              name="trophy-outline"
              size={18}
              color={tokens.mint}
              accessibilityLabel=""
            />
            <Text style={[styles.bonusText, { color: tokens.mint }]}>
              {bonusNotification}
            </Text>
            <TouchableOpacity
              onPress={() => setBonusNotification(null)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Dismiss bonus notification"
            >
              <Ionicons
                name="close"
                size={16}
                color={tokens.mint}
                accessibilityLabel=""
              />
            </TouchableOpacity>
          </Animated.View>
        )}
        <View style={styles.listView}>
          <SowUploadCard
            uploading={
              uploadMutation.isPending ||
              uploadImageMutation.isPending ||
              uploadDocumentMutation.isPending ||
              aiProcessing
            }
            uploadProgress={uploadProgress}
            examType={examType}
            onExamTypeChange={setExamType}
            onUploadText={handleUploadText}
            onUploadImage={handleUploadImage}
            onTakePhoto={handleTakePhoto}
            onUploadDocument={handleUploadDocument}
          />

          <View style={styles.quickActionsRow}>
            <Pressable
              onPress={() => router.push("/study/exam-mode")}
              style={({ pressed }) => [
                styles.quickAction,
                styles.quickActionPrimary,
                { backgroundColor: tokens.mint, opacity: pressed ? 0.85 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t("study.exam_mode_a11y")}
            >
              <Ionicons
                name="school-outline"
                size={20}
                color={tokens.mintText}
              />
              <Text
                style={[styles.quickActionText, { color: tokens.mintText }]}
              >
                {t("study.exam_mode_button")}
              </Text>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={tokens.mintText}
              />
            </Pressable>
            <Pressable
              onPress={() => router.push("/study/srs-dashboard")}
              style={({ pressed }) => [
                styles.quickAction,
                {
                  backgroundColor: tokens.card,
                  borderColor: tokens.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t("study.review_a11y")}
            >
              <Ionicons name="repeat-outline" size={20} color={tokens.mint} />
              <Text style={[styles.quickActionText, { color: tokens.ink }]}>
                {t("study.review_button")}
              </Text>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={tokens.inkMuted}
              />
            </Pressable>
          </View>

          {isLoading ? (
            <View style={styles.stateBlock}>
              <SkeletonPage count={3} header={false} />
            </View>
          ) : materials.length > 0 ? (
            <View style={styles.materialList}>
              <View style={styles.sectionHeaderRow}>
                <Text
                  style={[
                    styles.listTitle,
                    {
                      color: tokens.ink,
                      fontFamily: Fonts.editorialSemiBold as string,
                    },
                  ]}
                >
                  {t("study.your_materials")}
                </Text>
                <Text style={[styles.outlineMeta, { color: tokens.inkMuted }]}>
                  {t("study.active_count", { count: materials.length })}
                </Text>
              </View>
              {materials.map((m, idx) => (
                <Animated.View
                  key={m.id}
                  entering={FadeInDown.delay(idx * 60)
                    .duration(240)
                    .springify()
                    .damping(20)
                    .stiffness(220)}
                >
                  <TouchableOpacity
                    onPress={() => handleMaterialPress(m.id)}
                    activeOpacity={0.7}
                    style={[
                      styles.materialCard,
                      {
                        backgroundColor: tokens.card,
                        borderColor: tokens.border,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={t("study.material_a11y", {
                      title: m.title,
                      exam: m.exam_type || t("study.exam_type_custom"),
                      assets: m.asset_types.join(", "),
                      date: formatDateTime(m.created_at, {
                        includeTime: false,
                      }),
                    })}
                    accessibilityHint={t("study.material_a11y_hint")}
                  >
                    <View
                      style={[
                        styles.materialIcon,
                        { backgroundColor: tokens.mintSoft },
                      ]}
                    >
                      <Ionicons
                        name="book-outline"
                        size={18}
                        color={tokens.mint}
                        accessibilityLabel=""
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        style={[styles.materialTitle, { color: tokens.ink }]}
                        numberOfLines={1}
                      >
                        {m.title}
                      </Text>
                      <Text
                        style={[
                          styles.materialMeta,
                          { color: tokens.inkMuted },
                        ]}
                        numberOfLines={1}
                      >
                        {m.exam_type
                          ? m.exam_type.toUpperCase()
                          : t("study.exam_type_custom")}{" "}
                        · {m.asset_types.join(" · ")}
                      </Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={tokens.inkMuted}
                      accessibilityLabel=""
                    />
                  </TouchableOpacity>
                </Animated.View>
              ))}
            </View>
          ) : (
            <View style={[styles.stateBlock, { borderColor: tokens.border }]}>
              <Ionicons name="school-outline" size={32} color={tokens.mint} />
              <Text style={[styles.stateText, { color: tokens.inkMuted }]}>
                {t("study.upload_first")}
              </Text>
            </View>
          )}
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
          <View
            style={[
              styles.actionMenu,
              { backgroundColor: tokens.card, borderColor: tokens.border },
            ]}
          >
            <TouchableOpacity
              onPress={handleEditPress}
              style={styles.actionMenuItem}
              accessibilityRole="button"
              accessibilityLabel="Edit material"
            >
              <Ionicons name="pencil-outline" size={20} color={tokens.ink} />
              <Text style={[styles.actionMenuText, { color: tokens.ink }]}>
                Edit
              </Text>
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
              <Text style={[styles.actionMenuText, { color: tokens.ink }]}>
                Share
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleDeletePress}
              style={styles.actionMenuItem}
              accessibilityRole="button"
              accessibilityLabel="Delete material"
            >
              <Ionicons name="trash-outline" size={20} color={tokens.signal} />
              <Text style={[styles.actionMenuText, { color: tokens.signal }]}>
                Delete
              </Text>
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
          <View
            style={[
              styles.shareFormatModal,
              { backgroundColor: tokens.card, borderColor: tokens.border },
            ]}
          >
            <Text style={[styles.shareFormatTitle, { color: tokens.ink }]}>
              Share as
            </Text>
            {[
              {
                format: "pdf" as const,
                label: "PDF",
                icon: "document-text-outline",
                desc: "Formatted document",
              },
              {
                format: "docx" as const,
                label: "DOCX",
                icon: "document-outline",
                desc: "Word document",
              },
              {
                format: "txt" as const,
                label: "TXT",
                icon: "document-attach-outline",
                desc: "Plain text",
              },
              {
                format: "image" as const,
                label: "Image",
                icon: "image-outline",
                desc: "PNG image",
              },
            ].map((item) => (
              <TouchableOpacity
                key={item.format}
                onPress={() => handleSharePress(item.format)}
                style={[
                  styles.shareFormatItem,
                  { borderBottomColor: tokens.border },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Share as ${item.label}`}
              >
                <View
                  style={[
                    styles.shareFormatIcon,
                    { backgroundColor: tokens.mintSoft },
                  ]}
                >
                  <Ionicons
                    name={item.icon as any}
                    size={22}
                    color={tokens.mint}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.shareFormatLabel, { color: tokens.ink }]}
                  >
                    {item.label}
                  </Text>
                  <Text
                    style={[styles.shareFormatDesc, { color: tokens.inkMuted }]}
                  >
                    {item.desc}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={tokens.inkMuted}
                />
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
          <View
            style={[
              styles.editModal,
              { backgroundColor: tokens.card, borderColor: tokens.border },
            ]}
          >
            <Text style={[styles.editModalTitle, { color: tokens.ink }]}>
              Edit Material
            </Text>
            <TextInput
              style={[
                styles.editInput,
                {
                  backgroundColor: tokens.paper,
                  borderColor: tokens.border,
                  color: tokens.ink,
                },
              ]}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="Material title"
              placeholderTextColor={tokens.inkFaint}
              autoFocus
            />
            <Text style={[styles.editLabel, { color: tokens.inkMuted }]}>
              Exam Type
            </Text>
            <View style={styles.editExamChips}>
              {["jamb", "waec", "neco", "nabteb", "custom"].map((et) => (
                <TouchableOpacity
                  key={et}
                  onPress={() =>
                    setEditExamType(editExamType === et ? null : et)
                  }
                  style={[
                    styles.editChip,
                    {
                      backgroundColor:
                        editExamType === et ? tokens.mintSoft : tokens.paper2,
                      borderColor:
                        editExamType === et ? tokens.mint : tokens.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.editChipText,
                      {
                        color:
                          editExamType === et ? tokens.mint : tokens.inkMuted,
                      },
                    ]}
                  >
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
                <Text style={[styles.editBtnText, { color: tokens.inkMuted }]}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={handleEditSubmit}
                style={[styles.editBtn, { backgroundColor: tokens.mint }]}
              >
                <Text style={[styles.editBtnText, { color: tokens.mintText }]}>
                  Save
                </Text>
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
          <View
            style={[
              styles.deleteDialog,
              { backgroundColor: tokens.card, borderColor: tokens.border },
            ]}
          >
            <Ionicons name="warning-outline" size={32} color={tokens.signal} />
            <Text style={[styles.deleteTitle, { color: tokens.ink }]}>
              Delete Material?
            </Text>
            <Text style={[styles.deleteMessage, { color: tokens.inkMuted }]}>
              This will permanently delete "{selectedMaterial?.title}" and all
              its generated assets. This action cannot be undone.
            </Text>
            <View style={styles.deleteActions}>
              <Pressable
                onPress={() => setDeleteConfirmVisible(false)}
                style={[styles.deleteBtn, { borderColor: tokens.border }]}
              >
                <Text
                  style={[styles.deleteBtnText, { color: tokens.inkMuted }]}
                >
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={handleDeleteConfirm}
                style={[styles.deleteBtn, { backgroundColor: tokens.signal }]}
              >
                <Text style={[styles.deleteBtnText, { color: "#fff" }]}>
                  Delete
                </Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Pre-upload preview */}
      <Modal
        visible={previewVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setPreviewVisible(false)}
        >
          <View style={[styles.previewModal, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            <Text style={[styles.previewTitle, { color: tokens.ink }]}>
              {t("study.preview_title", "Preview")}
            </Text>
            <Text style={[styles.previewFileName, { color: tokens.inkMuted }]}>
              {previewFile?.name}
            </Text>
            {previewFile?.type?.startsWith("image/") && (
              <Image
                source={{ uri: previewFile.uri }}
                style={styles.previewImage}
                resizeMode="contain"
              />
            )}
            {previewFile?.type === "application/pdf" && (
              <View style={styles.previewPdfPlaceholder}>
                <Ionicons name="document-text-outline" size={48} color={tokens.mint} />
                <Text style={[styles.previewPdfText, { color: tokens.inkMuted }]}>
                  PDF preview will be available after upload
                </Text>
              </View>
            )}
            <View style={styles.previewActions}>
              <Pressable
                onPress={() => setPreviewVisible(false)}
                style={[styles.previewBtn, { borderColor: tokens.border }]}
              >
                <Text style={[styles.previewBtnText, { color: tokens.inkMuted }]}>
                  {t("common.cancel")}
                </Text>
              </Pressable>
              <Pressable
                onPress={confirmUpload}
                style={[styles.previewBtn, { backgroundColor: tokens.mint }]}
              >
                <Text style={[styles.previewBtnText, { color: tokens.mintText }]}>
                  {t("study.upload_confirm", "Upload")}
                </Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 48,
  },
  headerWrap: {
    gap: 14,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerBackBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
  },
  detailHero: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  eyebrowPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  eyebrowText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  heroTitle: {
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.5,
  },
  heroMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  heroChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  heroChipText: {
    fontSize: 11,
    fontWeight: "600",
  },
  chatBtnFull: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 14,
  },
  chatBtnFullText: {
    fontSize: 15,
    fontWeight: "700",
  },
  detailView: {
    gap: 16,
  },
  successBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
  },
  successBannerText: {
    fontSize: 14,
    fontWeight: "600",
  },
  outlineCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 12,
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
  generateBlock: {
    gap: 12,
  },
  genHeading: {
    fontSize: 16,
    letterSpacing: -0.2,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
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
    backgroundColor: "#F3F4F6",
  },
  materialPreviewText: {
    fontSize: 14,
    lineHeight: 21,
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
  readerCloseBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
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
  },
  readerTtsText: {
    fontSize: 13,
    fontWeight: "600",
  },
  readerContent: {
    flex: 1,
    padding: 16,
  },
  readerText: {
    fontSize: 15,
    lineHeight: 24,
  },
  listView: {
    gap: 16,
  },
  quickActionsRow: {
    flexDirection: "row",
    gap: 8,
  },
  quickAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  quickActionPrimary: {
    borderWidth: 0,
  },
  quickActionText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: -0.1,
  },
  materialList: {
    gap: 10,
  },
  listTitle: {
    fontSize: 18,
    letterSpacing: -0.3,
  },
  materialCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  materialIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  materialTitle: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: -0.1,
    marginBottom: 2,
  },
  materialMeta: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
  stateBlock: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 32,
    alignItems: "center",
    gap: 8,
  },
  stateText: {
    fontSize: 13,
    textAlign: "center",
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 8,
  },
  retryText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  bonusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  bonusText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
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
  previewModal: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 16,
  },
  previewTitle: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  previewFileName: {
    fontSize: 13,
  },
  previewImage: {
    width: "100%",
    height: 220,
    borderRadius: 10,
    backgroundColor: "#F3F4F6",
  },
  previewPdfPlaceholder: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 24,
  },
  previewPdfText: {
    fontSize: 13,
    textAlign: "center",
  },
  previewActions: {
    flexDirection: "row",
    gap: 10,
  },
  previewBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1,
  },
  previewBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
});
