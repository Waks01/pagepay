import { useState, useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import { useAudioPlayer } from "expo-audio";

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
import { SkeletonPage } from "@/components/skeletons";
import { PagePaySpinner } from "@/components/PagePaySpinner";
import AudioUnlockModal from "@/components/AudioUnlockModal";
import { cacheAsset, getCachedAsset } from "@/src/features/study/storage";
import { saveLastRoute, getLastRoute } from "@/src/shared/lib/screen-memory";

// Error categorization helper
function categorizeError(
  message: string,
  operation: string,
  t: (key: string, params?: Record<string, unknown>) => string,
): string {
  if (message.includes("Network") || message.includes("fetch")) {
    return t("study.errors.server_starting");
  }
  if (message.includes("401") || message.includes("Unauthorized")) {
    return t("study.errors.session_expired");
  }
  if (
    message.includes("413") ||
    message.includes("too large") ||
    message.includes("size")
  ) {
    return t("study.errors.file_too_large");
  }
  if (
    message.includes("format") ||
    message.includes("type") ||
    message.includes("invalid")
  ) {
    return t("study.errors.invalid_format");
  }
  if (message.includes("quota") || message.includes("limit")) {
    return t("study.errors.rate_limit");
  }
  if (message.includes("500") || message.includes("Internal")) {
    return t("study.errors.server_error");
  }
  return t("study.errors.generic", { operation, message });
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
};

function getTopicNames(parsed: Record<string, unknown> | null): string[] {
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
  const [studySessionId, setStudySessionId] = useState<number | null>(null);
  const [studyDuration, setStudyDuration] = useState<number>(0);
  const studySessionIdRef = useRef<number | null>(null);
  const [examType, setExamType] = useState<string | null>(null);
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

  // Load cached assets on mount
  useEffect(() => {
    if (selectedMaterial) {
      loadCachedAssets(selectedMaterial.id);
      startStudySession(selectedMaterial.id);
    }

    return () => {
      if (studySessionIdRef.current) {
        const sid = studySessionIdRef.current;
        endStudySession(sid);
        studySessionIdRef.current = null;
        setStudySessionId(null);
      }
    };
  }, [selectedMaterial]);

  // Restore last selected material on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await getLastRoute();
      if (saved && saved.startsWith("/study/materials/")) {
        const id = Number(saved.split("/").pop());
        if (!cancelled && !isNaN(id)) {
          handleMaterialPress(id);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
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

  const startStudySession = async (materialId: number) => {
    try {
      const res = await apiFetch("/api/v1/study/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ material_id: materialId }),
      });

      if (res.ok) {
        const data = await res.json();
        setStudySessionId(data.session_id);
        studySessionIdRef.current = data.session_id;
      }
    } catch (error) {
      if (__DEV__) console.error("Failed to start study session:", error);
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
        const data = await res.json();
        setStudyDuration(data.duration_seconds);
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
      setStudySessionId(null);
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
    setUploadProgress((prev) => (prev >= 99 ? prev : Math.min(99, prev + 1)));
  };

  // Shared tail: after the SOW job is completed, fetch the full
  // MaterialDetail so the screen can render the asset browser. The
  // 100% tick is held until this fetch resolves so the success banner
  // only shows when there's actually something to show.
  const finalizeUploadSuccess = async (materialId: number) => {
    setSelectedMaterialId(materialId);
    const res = await apiFetch(`/api/v1/study/materials/${materialId}`);
    if (res.ok) {
      setSelectedMaterial(await res.json());
    }
    setUploadProgress(100);
    setTimeout(() => setUploadProgress(undefined), 2000);
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

      // Validate file type
      const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
      if (file.type && !validTypes.includes(file.type.toLowerCase())) {
        throw new Error(t("study.errors.invalid_file_type"));
      }

      const { job_id } = await uploadImageMutation.mutateAsync({
        file: { uri: file.uri, name: file.name, type: file.type },
        exam_type: examType,
        onProgress: handleUploadProgress,
      });
      // Wire phase done; server now runs OCR + SOW AI parse. Poll the
      // job and tick 80→99 monotonically while we wait.
      setUploadProgress(80);
      const job = await pollSowJob(job_id, handlePollTick);
      if (job.status === "failed" || !job.material_id) {
        throw new Error(job.error || "Image processing failed");
      }
      await finalizeUploadSuccess(job.material_id);
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
      const { job_id } = await uploadImageMutation.mutateAsync({
        file: { uri: file.uri, name: file.name, type: file.type },
        exam_type: examType,
        onProgress: handleUploadProgress,
      });
      setUploadProgress(80);
      const job = await pollSowJob(job_id, handlePollTick);
      if (job.status === "failed" || !job.material_id) {
        throw new Error(job.error || "Photo processing failed");
      }
      await finalizeUploadSuccess(job.material_id);
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

      // Client-side file validation
      const validTypes = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
      ];
      if (file.type && !validTypes.includes(file.type.toLowerCase())) {
        throw new Error(t("study.errors.invalid_format"));
      }

      // Validate file extension as fallback
      const validExtensions = [".pdf", ".docx", ".doc"];
      const hasValidExtension = validExtensions.some((ext) =>
        file.name.toLowerCase().endsWith(ext),
      );
      if (!hasValidExtension) {
        throw new Error(t("study.errors.invalid_format"));
      }

      const { job_id } = await uploadDocumentMutation.mutateAsync({
        file: { uri: file.uri, name: file.name, type: file.type },
        exam_type: examType,
        onProgress: handleUploadProgress,
      });
      setUploadProgress(80);
      const job = await pollSowJob(job_id, handlePollTick);
      if (job.status === "failed" || !job.material_id) {
        throw new Error(job.error || "Document processing failed");
      }
      await finalizeUploadSuccess(job.material_id);
    } catch (err) {
      setUploadProgress(undefined);
      const message = err instanceof Error ? err.message : "Upload failed";
      const specificError = categorizeError(message, "document upload", t);
      setError(specificError);
      setRetryAction(() => () => handleUploadDocument(examType));
    }
  };

  const handleGenerateAsset = async (
    materialId: number,
    assetType: string,
    count?: number,
    topic?: string | null,
    mode?: "topic" | "all",
  ) => {
    setGeneratingType(assetType);
    setError(null);
    setRetryAction(null);
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
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || "Generation failed");
      }
      const detailRes = await apiFetch(`/api/v1/study/materials/${materialId}`);
      if (detailRes.ok) {
        setSelectedMaterial(await detailRes.json());
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Generation failed";
      const specificError = categorizeError(
        message,
        `${assetType} generation`,
        t,
      );
      setError(specificError);
      setRetryAction(
        () => () =>
          handleGenerateAsset(materialId, assetType, count, topic, mode),
      );
    } finally {
      setGeneratingType(null);
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

  const handleUnlock = async (assetId: number, method: "points" | "ad") => {
    setError(null);
    setRetryAction(null);
    const res = await apiFetch("/api/v1/study/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ asset_id: assetId, method }),
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
    setSelectedMaterialId(materialId);
    const res = await apiFetch(`/api/v1/study/materials/${materialId}`);
    if (res.ok) {
      const materialData = await res.json();
      setSelectedMaterial(materialData);

      // Load already unlocked assets from backend response
      const unlockedFromBackend: Record<number, unknown> = {};
      for (const asset of materialData.assets) {
        if (asset.unlocked && asset.content) {
          unlockedFromBackend[asset.id] = asset.content;
        }
      }
      setUnlockedAssets(unlockedFromBackend);
    } else {
      const data = await res.json().catch(() => ({}));
      setSelectedMaterial(null);
      setError(
        typeof data?.detail === "string"
          ? data.detail
          : "Failed to load material.",
      );
    }
  };

  const handleChatPress = (materialId: number) => {
    router.push(`/study/chat/${materialId}`);
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
      {selectedMaterial ? (
        <PageHeader
          title={selectedMaterial.title}
          subtitle={t("study.assets_generated", { count: totalAssets })}
          showBack
          onBack={handleBack}
          backgroundColor={tokens.card}
          borderBottomColor={tokens.border}
          tokens={tokens}
          right={
            <Pressable
              onPress={() => handleChatPress(selectedMaterial.id)}
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
          }
        />
      ) : (
        <PageHeader
          title={t("study.title")}
          subtitle={`${materials.length} ${materials.length === 1 ? "material" : "materials"}`}
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
          <View style={styles.headerWrap}>
            <Animated.View entering={FadeInDown.duration(240).springify()}>
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
                      MATERIAL · {selectedMaterial.exam_type.toUpperCase()}
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
                  <View
                    style={[styles.heroChip, { borderColor: tokens.border }]}
                  >
                    <Ionicons
                      name="list-outline"
                      size={12}
                      color={tokens.inkMuted}
                    />
                    <Text style={[styles.heroChipText, { color: tokens.ink }]}>
                      {getTopicNames(selectedMaterial.parsed_structure).length}{" "}
                      topics
                    </Text>
                  </View>
                  <View
                    style={[styles.heroChip, { borderColor: tokens.border }]}
                  >
                    <Ionicons
                      name="albums-outline"
                      size={12}
                      color={tokens.inkMuted}
                    />
                    <Text style={[styles.heroChipText, { color: tokens.ink }]}>
                      {totalAssets} assets
                    </Text>
                  </View>
                </View>
              </View>
            </Animated.View>

            <Pressable
              onPress={() => handleChatPress(selectedMaterial.id)}
              style={({ pressed }) => [
                styles.chatBtnFull,
                { backgroundColor: tokens.mint, opacity: pressed ? 0.85 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t("study.chat_ai")}
            >
              <Ionicons
                name="chatbubble-ellipses"
                size={18}
                color={tokens.mintText}
              />
              <Text
                style={[styles.chatBtnFullText, { color: tokens.mintText }]}
              >
                {t("study.chat_ai")}
              </Text>
            </Pressable>
          </View>
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

        {selectedMaterial ? (
          <View style={styles.detailView}>
            {selectedMaterial.parsed_structure && (
              <Animated.View
                entering={FadeInDown.delay(120).duration(240).springify()}
              >
                <View
                  style={[
                    styles.outlineCard,
                    {
                      backgroundColor: tokens.card,
                      borderColor: tokens.border,
                    },
                  ]}
                >
                  <View style={styles.sectionHeaderRow}>
                    <Text
                      style={[
                        styles.outlineTitle,
                        {
                          color: tokens.ink,
                          fontFamily: Fonts.editorialSemiBold as string,
                        },
                      ]}
                    >
                      {t("study.topics_covered")}
                    </Text>
                    <Text
                      style={[styles.outlineMeta, { color: tokens.inkMuted }]}
                    >
                      {getTopicNames(selectedMaterial.parsed_structure).length}{" "}
                      total
                    </Text>
                  </View>
                  <View style={styles.outlineList}>
                    {((
                      selectedMaterial.parsed_structure as Record<
                        string,
                        unknown
                      >
                    ).topics as Array<Record<string, unknown>> | undefined) &&
                      Array.isArray(
                        (
                          selectedMaterial.parsed_structure as Record<
                            string,
                            unknown
                          >
                        ).topics,
                      ) &&
                      (
                        (
                          selectedMaterial.parsed_structure as Record<
                            string,
                            unknown
                          >
                        ).topics as Array<Record<string, unknown>>
                      ).map((topic: Record<string, unknown>, idx: number) => (
                        <View key={idx} style={styles.outlineItem}>
                          <Text
                            style={[
                              styles.outlineNum,
                              { color: tokens.inkFaint },
                            ]}
                          >
                            {String(idx + 1).padStart(2, "0")}
                          </Text>
                          <View
                            style={[
                              styles.outlineDot,
                              { backgroundColor: tokens.mint },
                            ]}
                          />
                          <Text
                            style={[styles.outlineText, { color: tokens.ink }]}
                          >
                            {String(topic.name)}
                          </Text>
                        </View>
                      ))}
                  </View>
                </View>
              </Animated.View>
            )}

            {selectedMaterial.content && (
              <Pressable
                onPress={() => setShowReader(true)}
                style={({ pressed }) => [
                  styles.readBtn,
                  {
                    backgroundColor: tokens.paper,
                    borderColor: tokens.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Ionicons name="book-outline" size={18} color={tokens.mint} />
                <Text style={[styles.readBtnText, { color: tokens.ink }]}>
                  Read Material
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={tokens.inkMuted}
                />
              </Pressable>
            )}

            {showReader && selectedMaterial.content && (
              <View
                style={[
                  styles.readerOverlay,
                  { backgroundColor: tokens.paper },
                ]}
              >
                <View
                  style={[
                    styles.readerHeader,
                    { borderBottomColor: tokens.border },
                  ]}
                >
                  <Text style={[styles.readerTitle, { color: tokens.ink }]}>
                    {selectedMaterial.title}
                  </Text>
                  <View style={styles.readerHeaderActions}>
                    <TouchableOpacity
                      onPress={handleTtsPress}
                      disabled={ttsLoading}
                      style={styles.readerTtsBtn}
                    >
                      <Ionicons
                        name={ttsPlaying ? "pause" : "play"}
                        size={20}
                        color={tokens.mint}
                      />
                      <Text
                        style={[styles.readerTtsText, { color: tokens.mint }]}
                      >
                        {ttsLoading
                          ? t("common.loading")
                          : ttsPlaying
                            ? t("study.tts.pause")
                            : t("study.tts.listen")}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        player.pause();
                        setTtsPlaying(false);
                        setShowReader(false);
                      }}
                      style={styles.readerCloseBtn}
                    >
                      <Ionicons name="close" size={22} color={tokens.ink} />
                    </TouchableOpacity>
                  </View>
                </View>
                <ScrollView style={styles.readerContent}>
                  <Text style={[styles.readerText, { color: tokens.ink }]}>
                    {selectedMaterial.content}
                  </Text>
                </ScrollView>
              </View>
            )}

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

            <AssetBrowser
              assets={selectedMaterial.assets}
              userBalance={balance}
              onUnlock={handleUnlock}
              unlockedAssets={unlockedAssets}
              onQuizComplete={handleQuizComplete}
            />

            {selectedMaterial.id && (
              <ProgressDashboard
                materialId={selectedMaterial.id}
                totalTopics={
                  getTopicNames(selectedMaterial?.parsed_structure ?? null)
                    .length
                }
                mastered={0}
                reviewing={0}
                notStarted={
                  getTopicNames(selectedMaterial?.parsed_structure ?? null)
                    .length
                }
              />
            )}

            <View style={styles.generateBlock}>
              <View style={styles.sectionHeaderRow}>
                <Text
                  style={[
                    styles.genHeading,
                    {
                      color: tokens.ink,
                      fontFamily: Fonts.editorialSemiBold as string,
                    },
                  ]}
                >
                  Generate
                </Text>
                <Text style={[styles.outlineMeta, { color: tokens.inkMuted }]}>
                  {generateMode === "topic" ? "15 / topic" : "20 / material"}
                </Text>
              </View>
              <View style={styles.generateRow}>
                <GenerateButton
                  label={t("study.generate.mcqs")}
                  icon="help-circle-outline"
                  assetType="mcq"
                  onPress={() => {
                    const count = generateMode === "topic" ? 15 : 20;
                    handleGenerateAsset(
                      selectedMaterial.id,
                      "mcq",
                      count,
                      selectedTopic,
                      generateMode,
                    );
                  }}
                  loading={generatingType === "mcq"}
                  tokens={tokens}
                />
                <GenerateButton
                  label={t("study.generate.flashcards")}
                  icon="albums-outline"
                  assetType="flashcard"
                  onPress={() => {
                    const count = generateMode === "topic" ? 15 : 20;
                    handleGenerateAsset(
                      selectedMaterial.id,
                      "flashcard",
                      count,
                      selectedTopic,
                      generateMode,
                    );
                  }}
                  loading={generatingType === "flashcard"}
                  tokens={tokens}
                />
                <GenerateButton
                  label={t("study.generate.essays")}
                  icon="document-text-outline"
                  assetType="essay"
                  onPress={() => {
                    const count = generateMode === "topic" ? 15 : 20;
                    handleGenerateAsset(
                      selectedMaterial.id,
                      "essay",
                      count,
                      selectedTopic,
                      generateMode,
                    );
                  }}
                  loading={generatingType === "essay"}
                  tokens={tokens}
                />
              </View>

              <View style={styles.generateRow}>
                <GenerateButton
                  label="Diagram"
                  icon="git-branch-outline"
                  assetType="diagram"
                  onPress={() =>
                    handleGenerateAsset(
                      selectedMaterial.id,
                      "diagram",
                      1,
                      selectedTopic,
                      generateMode,
                    )
                  }
                  loading={generatingType === "diagram"}
                  tokens={tokens}
                />
                <GenerateButton
                  label="Video"
                  icon="play-circle-outline"
                  assetType="video"
                  onPress={() =>
                    handleGenerateAsset(
                      selectedMaterial.id,
                      "video",
                      1,
                      selectedTopic,
                      generateMode,
                    )
                  }
                  loading={generatingType === "video"}
                  tokens={tokens}
                />
              </View>

              <View style={styles.generateRow}>
                <GenerateButton
                  label="Try It Yourself"
                  icon="create-outline"
                  assetType="example"
                  onPress={() => {
                    generateExampleMutation.mutate({
                      material_id: selectedMaterial.id,
                      topic: selectedTopic,
                      mode: generateMode,
                      education_level: "secondary",
                      subject_hints: "general",
                    });
                  }}
                  loading={generateExampleMutation.isPending}
                  tokens={tokens}
                  full
                />
              </View>

              <View
                style={[
                  styles.generateOptions,
                  { borderTopColor: tokens.border },
                ]}
              >
                <Text
                  style={[
                    styles.generateOptionsLabel,
                    { color: tokens.inkMuted },
                  ]}
                >
                  Generation Mode
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
                        backgroundColor:
                          generateMode === "all" ? tokens.mint : tokens.card,
                        borderColor:
                          generateMode === "all" ? tokens.mint : tokens.border,
                      },
                    ]}
                    accessibilityRole="button"
                  >
                    <Text
                      style={[
                        styles.modeBtnText,
                        {
                          color:
                            generateMode === "all"
                              ? tokens.mintText
                              : tokens.ink,
                        },
                      ]}
                    >
                      All Topics · 20
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setGenerateMode("topic")}
                    style={[
                      styles.modeBtn,
                      {
                        backgroundColor:
                          generateMode === "topic" ? tokens.mint : tokens.card,
                        borderColor:
                          generateMode === "topic"
                            ? tokens.mint
                            : tokens.border,
                      },
                    ]}
                    accessibilityRole="button"
                  >
                    <Text
                      style={[
                        styles.modeBtnText,
                        {
                          color:
                            generateMode === "topic"
                              ? tokens.mintText
                              : tokens.ink,
                        },
                      ]}
                    >
                      By Topic · 15
                    </Text>
                  </TouchableOpacity>
                </View>

                {generateMode === "topic" && (
                  <View style={styles.topicSelector}>
                    <Text
                      style={[
                        styles.topicSelectorLabel,
                        { color: tokens.inkMuted },
                      ]}
                    >
                      Select Topic
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.topicChips}
                    >
                      {getTopicNames(
                        selectedMaterial?.parsed_structure ?? null,
                      ).map((topicName) => (
                        <TouchableOpacity
                          key={topicName}
                          onPress={() => setSelectedTopic(topicName)}
                          style={[
                            styles.topicChip,
                            {
                              backgroundColor:
                                selectedTopic === topicName
                                  ? tokens.mint
                                  : tokens.card,
                              borderColor:
                                selectedTopic === topicName
                                  ? tokens.mint
                                  : tokens.border,
                            },
                          ]}
                          accessibilityRole="button"
                        >
                          <Text
                            style={[
                              styles.topicChipText,
                              {
                                color:
                                  selectedTopic === topicName
                                    ? tokens.mintText
                                    : tokens.ink,
                              },
                            ]}
                          >
                            {topicName}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.listView}>
            <SowUploadCard
              uploading={
                uploadMutation.isPending ||
                uploadImageMutation.isPending ||
                uploadDocumentMutation.isPending
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
                accessibilityLabel="Start exam mode"
              >
                <Ionicons
                  name="school-outline"
                  size={20}
                  color={tokens.mintText}
                />
                <Text
                  style={[styles.quickActionText, { color: tokens.mintText }]}
                >
                  Exam Mode
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
                accessibilityLabel="Review dashboard"
              >
                <Ionicons name="repeat-outline" size={20} color={tokens.mint} />
                <Text style={[styles.quickActionText, { color: tokens.ink }]}>
                  Review
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
                  <Text
                    style={[styles.outlineMeta, { color: tokens.inkMuted }]}
                  >
                    {materials.length} active
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
                      accessibilityLabel={`${m.title}, ${m.exam_type || "custom"}, ${m.asset_types.join(", ")}, created ${new Date(m.created_at).toLocaleDateString()}`}
                      accessibilityHint="Open this study material"
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
                          {m.exam_type ? m.exam_type.toUpperCase() : "CUSTOM"} ·{" "}
                          {m.asset_types.join(" · ")}
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
        )}
      </ScrollView>
    </SafeAreaView>
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
    fontWeight: "600",
  },
  readerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
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
});
