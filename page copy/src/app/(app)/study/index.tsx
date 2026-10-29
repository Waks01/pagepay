import { useState, useRef } from "react";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  FlatList,
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
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { PinchGestureHandler } from "react-native-gesture-handler";
import {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "@/src/shared/utils/dateFormatter";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";

import { apiFetch, apiUpload } from "@/src/shared/api/client";
import { getExamTypeLabel } from "@/src/shared/lib/exam-types";
import { pollSowJob, type SowJobStatus, type EducationLevel } from "@/src/features/study/api";
import {
  useMaterials,
  useUploadSow,
  useUploadSowImage,
  useUploadSowImages,
  useUploadSowDocument,
  useClaimQuizBonus,
  useGenerateExample,
} from "@/src/features/study/hooks/use-study";
import { useImagePicker } from "@/src/shared/hooks/use-image-picker";
import { useDocumentPicker } from "@/src/shared/hooks/use-document-picker";
import { useCurrentUser } from "@/src/shared/lib/current-user";
import { SowUploadCard } from "@/components/study/SowUploadCard";
import { PagePayBanner } from "@/src/components/ads/PagePayBanner";
import { NativeAdCard } from "@/src/components/ads/NativeAdCard";
import { PageHeader } from "@/components/PageHeader";
import { UserAvatar } from "@/components/UserAvatar";
import { Fonts, PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import NotificationBell from "@/components/NotificationBell";
import { SkeletonPage } from "@/components/skeletons";
import { Skeleton as SkeletonBase } from "@/components/Skeleton";

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

/**
 * Translate a failed upload job's error code into something a human can
 * act on. Job errors arrive as backend category codes
 * (`pdf_has_no_text_layer`, `empty_extracted_text`, …), so showing them
 * raw tells the user nothing.
 */
function describeUploadError(
  code: string | null | undefined,
  t: (key: string, params?: Record<string, unknown>) => string,
): string | null {
  if (!code) return null;
  const key = `study.sow_upload.errors.${code}`;
  const message = t(key, { defaultValue: "" });
  return message || null;
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
  const [uploadStage, setUploadStage] = useState<string | null>(null);
  const [aiProcessing, setAiProcessing] = useState(false);

  // Progress and its stage label move together — clearing one without
  // the other leaves a stale label next to a fresh bar.
  const resetUploadProgress = () => {
    setUploadProgress(0);
    setUploadStage(null);
  };
  const clearUploadProgress = () => {
    setUploadProgress(undefined);
    setUploadStage(null);
  };
  const [uploadJustCompleted, setUploadJustCompleted] = useState(false);
  const [examType, setExamType] = useState<string | null>(null);
  /**
   * How deep the explanation and the narration are pitched. "primary"
   * is the default: a student who uploads a syllabus wants it explained
   * the way a good teacher would, not the way a paper is written.
   */
  const [educationLevel, setEducationLevel] = useState<EducationLevel>("primary");
  const [materialLoading, setMaterialLoading] = useState(false);
  const materialFetchIdRef = useRef(0);
  const [generateMode, setGenerateMode] = useState<"topic" | "all">("all");
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [generateCount, setGenerateCount] = useState<number>(15);
  const [previewFile, setPreviewFile] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [previewFiles, setPreviewFiles] = useState<Array<{ uri: string; name: string; type: string }>>([]);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const [pdfPreviewPages, setPdfPreviewPages] = useState<Array<{ page: number; total: number; image_base64: string; width: number; height: number }> | null>(null);
  const [pdfTruncated, setPdfTruncated] = useState(false);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const viewerWidth = useWindowDimensions().width;
  const previewIndex = Math.max(
    0,
    previewFiles.findIndex((f) => f.uri === previewFile?.uri),
  );

  // Read the user from the global store. The user object is loaded
  // once at app start — no per-screen /me fetch.
  const meQ = useCurrentUser();

  const uploadMutation = useUploadSow();
  const uploadImageMutation = useUploadSowImage();
  const uploadImagesMutation = useUploadSowImages();
  const uploadDocumentMutation = useUploadSowDocument();
  const { pickImage, pickImages, takePhoto } = useImagePicker();
  const { pickDocument } = useDocumentPicker();
  const claimBonusMutation = useClaimQuizBonus();
  const generateExampleMutation = useGenerateExample();

  const handleUploadText = async (text: string, examType: string | null) => {
    setError(null);
    setRetryAction(null);
    resetUploadProgress();
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
        education_level: educationLevel,
      });
      // Navigate to the dedicated material detail screen. The Study
      // screen intentionally holds no inline detail view — everything
      // material-specific lives on /study/{id}.
      router.replace(`/study/${result.material_id}`);
      setUploadProgress(100);
      setTimeout(clearUploadProgress, 2000);
    } catch (err) {
      clearUploadProgress();
      const message = err instanceof Error ? err.message : "Upload failed";
      const specificError = categorizeError(message, "upload text", t);
      setError(specificError);
      setRetryAction(() => () => handleUploadText(text, examType));
    }
  };

  // The server reports real progress (0-100) plus a stage code as each
  // step completes — reading pages, parsing with the model, saving. Use
  // those instead of guessing, so the bar reflects actual work and the
  // label says what is happening. The 0-80 window is the wire upload
  // (real byte counts from XHR); 80-100 is the server's window.
  const handleUploadProgress = (loaded: number, total: number) => {
    if (total <= 0) return;
    const pct = Math.min(80, Math.round((loaded / total) * 80));
    setUploadProgress(pct);
  };

  const handlePollTick = (status?: SowJobStatus) => {
    if (status && typeof status.progress === "number") {
      setUploadProgress(Math.max(80, Math.min(99, status.progress)));
      if (status.stage) setUploadStage(status.stage);
      return;
    }
    setUploadProgress((prev) => {
      const current = prev ?? 0;
      return current >= 99 ? current : Math.min(99, current + 1);
    });
  };

  // Shared tail: after the SOW job is completed, hand off to the
  // dedicated material detail screen. The 100% tick is shown here so
  // the success banner renders before the handoff.
  const finalizeUploadSuccess = async (materialId: number) => {
    setUploadJustCompleted(true);
    setUploadProgress(100);
    qc.invalidateQueries({ queryKey: ["study", "materials"] });
    setTimeout(() => {
      clearUploadProgress();
      setUploadJustCompleted(false);
    }, 3000);
    router.replace(`/study/${materialId}`);
  };

  const handleUploadImage = async (examType: string | null) => {
    console.log("[study/index] handleUploadImage START", { examType });
    setError(null);
    setRetryAction(null);
    resetUploadProgress();
    try {
      const files = await pickImages();
      if (!files || files.length === 0) {
        console.log("[study/index] handleUploadImage CANCELED");
        clearUploadProgress();
        return;
      }
      const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
      const valid = files.filter((f) => !f.type || validTypes.includes(f.type.toLowerCase()));
      if (valid.length === 0) {
        throw new Error(t("study.errors.invalid_file_type"));
      }
      console.log("[study/index] handleUploadImage PREVIEW", valid);
      setPreviewFiles(valid);
      setPreviewFile(valid[0]);
      setPreviewVisible(true);
    } catch (err) {
      console.log("[study/index] handleUploadImage ERROR", err);
      clearUploadProgress();
      const message = err instanceof Error ? err.message : "Upload failed";
      const specificError = categorizeError(message, "image upload", t);
      setError(specificError);
      setRetryAction(() => () => handleUploadImage(examType));
    }
  };

  const handleTakePhoto = async (examType: string | null) => {
    console.log("[study/index] handleTakePhoto START", { examType });
    setError(null);
    setRetryAction(null);
    resetUploadProgress();
    try {
      const file = await takePhoto();
      if (!file) {
        console.log("[study/index] handleTakePhoto CANCELED");
        clearUploadProgress();
        return;
      }
      console.log("[study/index] handleTakePhoto PREVIEW", file);
      setPreviewFiles([file]);
      setPreviewFile(file);
      setPreviewVisible(true);
    } catch (err) {
      console.log("[study/index] handleTakePhoto ERROR", err);
      clearUploadProgress();
      const message = err instanceof Error ? err.message : "Upload failed";
      const specificError = categorizeError(message, "photo upload", t);
      setError(specificError);
      setRetryAction(() => () => handleTakePhoto(examType));
    }
  };

  const handleUploadDocument = async (examType: string | null) => {
    console.log("[study/index] handleUploadDocument START", { examType });
    setError(null);
    setRetryAction(null);
    resetUploadProgress();
    try {
      const file = await pickDocument();
      if (!file) {
        console.log("[study/index] handleUploadDocument CANCELED");
        clearUploadProgress();
        return;
      }
      console.log("[study/index] handleUploadDocument PREVIEW", file);
      setPreviewFiles([file]);
      setPreviewFile({ uri: file.uri, name: file.name, type: file.type });

      if (file.type === "application/pdf") {
        setPdfPreviewLoading(true);
        setPdfPreviewPages(null);
        setPdfTruncated(false);
        setPdfTotalPages(0);
          setSelectedPages([]);
        try {
          const form = new FormData();
          form.append("file", {
            uri: file.uri,
            name: file.name,
            type: file.type,
          } as any);
          const uploadResult = await apiUpload("/api/v1/study/sow/preview-pdf", form as any);
          if (!uploadResult.ok) {
            const err = await uploadResult.json().catch(() => ({ detail: "Failed to preview PDF" }));
            throw new Error(err.detail || "Failed to preview PDF");
          }
          const data = await uploadResult.json();
          const pages = data.pages || [];
          setPdfPreviewPages(pages);
          setSelectedPages(pages.map((p: any) => p.page));
          // The server caps the preview at a page limit; surface it so
          // the user knows the rest of the document still uploads.
          setPdfTruncated(Boolean(data.truncated));
          setPdfTotalPages(Number(data.total ?? pages.length));
        } catch (err) {
          console.error("[study/index] PDF preview failed:", err);
          setError(err instanceof Error ? err.message : "Failed to preview PDF");
          setRetryAction(() => () => handleUploadDocument(examType));
        } finally {
          setPdfPreviewLoading(false);
        }
      }

      setPreviewVisible(true);
    } catch (err) {
      console.log("[study/index] handleUploadDocument ERROR", err);
      clearUploadProgress();
      const message = err instanceof Error ? err.message : "Upload failed";
      const specificError = categorizeError(message, "document upload", t);
      setError(specificError);
      setRetryAction(() => () => handleUploadDocument(examType));
    }
  };

  const confirmUpload = async () => {
    console.log("[study/index] confirmUpload START", { previewFile, count: previewFiles.length });
    if (!previewFile) return;
    setPreviewVisible(false);
    resetUploadProgress();
    try {
      const isImage = previewFile.type.startsWith("image/");
      const isPdf = previewFile.type === "application/pdf";
      console.log("[study/index] confirmUpload routing", { isImage, isPdf });
      if (isImage) {
        // Every selected image is a page of ONE material. Uploading
        // them one at a time and navigating to the first result left
        // the rest of the student's document on the floor — the app
        // went to the first material and never came back for the
        // others.
        const filesToUpload =
          previewFiles.length > 1 ? previewFiles : [previewFile];
        // The stage is set before the request so the bar says
        // something even if the browser never reports a total length.
        setUploadStage("uploading");
        const { job_id } = await uploadImagesMutation.mutateAsync({
          files: filesToUpload,
          exam_type: examType,
          onProgress: handleUploadProgress,
          education_level: educationLevel,
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
        console.log("[study/index] confirmUpload calling uploadSowDocument");
        const selectedPagesArray = pdfPreviewPages
          ? [...selectedPages].sort((a, b) => a - b)
          : undefined;
        if (pdfPreviewPages && (!selectedPagesArray || selectedPagesArray.length === 0)) {
          throw new Error("Please select at least one page to upload");
        }
        const { job_id } = await uploadDocumentMutation.mutateAsync({
          file: { uri: previewFile.uri, name: previewFile.name, type: previewFile.type },
          exam_type: examType,
          selected_pages: selectedPagesArray,
          onProgress: handleUploadProgress,
          education_level: educationLevel,
        });
        setAiProcessing(true);
        setUploadProgress(80);
        const job = await pollSowJob(job_id, handlePollTick);
        setAiProcessing(false);
        if (job.status === "failed" || !job.material_id) {
          throw new Error(
            describeUploadError(job.error, t) || "Document processing failed",
          );
        }
        await finalizeUploadSuccess(job.material_id);
      } else {
        throw new Error("Unsupported file type");
      }
    } catch (err) {
      clearUploadProgress();
      const message = err instanceof Error ? err.message : "Upload failed";
      setError(message);
    } finally {
      setPreviewFile(null);
      setPreviewFiles([]);
    }
  };

  const handleQuizComplete = async (assetId: number, score: number) => {
    try {
      const result = await claimBonusMutation.mutateAsync({
        asset_id: assetId,
        score,
      });
      if (result.bonus_awarded) {
        setBonusNotification(`+${result.bonus_points} SV! Score: ${score}%`);
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
    }
    qc.invalidateQueries({ queryKey: ["me"] });
    return data;
  };

  const handleMaterialPress = async (materialId: number) => {
    router.push(`/study/${materialId}`);
  };

  const materials = materialsQ.data ?? [];
  const balance = meQ?.service_credit_balance ?? 0;
  const isLoading = materialsQ.isLoading;

  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: tokens.paper }}
    >
      <PageHeader
        title={t("study.title")}
        subtitle={t("study.materials_count", { count: materials.length })}
        backgroundColor={tokens.card}
        borderBottomColor={tokens.border}
        tokens={tokens}
        left={<UserAvatar size={28} />}
        right={<NotificationBell />}
      />
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
              uploadImagesMutation.isPending ||
              uploadDocumentMutation.isPending ||
              aiProcessing
            }
            uploadProgress={uploadProgress}
            uploadStage={uploadStage}
            examType={examType}
            onExamTypeChange={setExamType}
            educationLevel={educationLevel}
            onEducationLevelChange={setEducationLevel}
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
                        {getExamTypeLabel(m.exam_type).toUpperCase()}{" "}
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

          {/* Ads. Only on the list screen - never inside a reading or
              exam flow, where an ad interrupts the thing the student
              came to do. */}
          {materials.length > 0 ? (
            <>
              <NativeAdCard style={styles.adCard} />
              <PagePayBanner style={styles.adBanner} />
            </>
          ) : null}
        </View>
      </ScrollView>


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
          <Pressable
            style={[styles.previewModal, { backgroundColor: tokens.card, borderColor: tokens.border }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.previewTitle, { color: tokens.ink }]}>
              {t("study.preview_title", "Preview")}
            </Text>
            <Text style={[styles.previewFileName, { color: tokens.inkMuted }]}>
              {previewFile?.name}
            </Text>
            {previewFiles.length > 1 && (
              <View style={styles.previewThumbs}>
                {previewFiles.map((f, idx) => (
                  <View key={idx} style={styles.previewThumbWrap}>
                    <Pressable
                      onPress={() => setPreviewFile(f)}
                      onLongPress={() => {
                        if (previewFiles.length <= 1) return;
                        setPreviewFiles((prev) => prev.filter((_, i) => i !== idx));
                        setPreviewFile((prev) => {
                          if (!prev) return null;
                          const remaining = previewFiles.filter((_, i) => i !== idx);
                          return remaining.length > 0 ? remaining[0] : null;
                        });
                      }}
                      style={[styles.previewThumb, previewFile?.uri === f.uri && { borderColor: tokens.mint, borderWidth: 2 }]}
                    >
                      <Image source={{ uri: f.uri }} style={styles.previewThumbImg} resizeMode="cover" />
                      <Pressable
                        onPress={() => {
                          if (previewFiles.length <= 1) return;
                          setPreviewFiles((prev) => prev.filter((_, i) => i !== idx));
                          setPreviewFile((prev) => {
                            if (!prev) return null;
                            const remaining = previewFiles.filter((_, i) => i !== idx);
                            return remaining.length > 0 ? remaining[0] : null;
                          });
                        }}
                        style={styles.previewThumbRemove}
                        hitSlop={4}
                      >
                        <Ionicons name="close-circle" size={18} color="#fff" />
                      </Pressable>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
            {previewFile?.type?.startsWith("image/") && (
              <Pressable onPress={() => setImageViewerVisible(true)}>
                <Image
                  source={{ uri: previewFile.uri }}
                  style={styles.previewImage}
                  resizeMode="contain"
                />
              </Pressable>
            )}
            {previewFile?.type === "application/pdf" && (
              <View style={styles.previewPdfContainer}>
                {pdfPreviewLoading ? (
                  <View style={styles.loadingPages}>
                    <SkeletonBase height={420} width="100%" borderRadius={12} />
                  </View>
                ) : pdfPreviewPages && pdfPreviewPages.length > 0 ? (
                  // FlatList, not ScrollView.map: a paging ScrollView
                  // mounts and decodes every page at once (the old crash),
                  // while FlatList only keeps a small window alive.
                  <FlatList
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    style={styles.pdfScroll}
                    data={pdfPreviewPages}
                    keyExtractor={(page) => String(page.page)}
                    initialNumToRender={2}
                    maxToRenderPerBatch={2}
                    windowSize={3}
                    removeClippedSubviews
                    renderItem={({ item: page }) => {
                      const isSelected = selectedPages.includes(page.page);
                      return (
                        <Pressable
                          onPress={() => {
                            setSelectedPages((prev) => {
                              if (prev.includes(page.page)) {
                                return prev.filter((p) => p !== page.page);
                              }
                              return [...prev, page.page];
                            });
                          }}
                          style={styles.pdfPageItem}
                        >
                          <Image
                            source={{ uri: `data:image/jpeg;base64,${page.image_base64}` }}
                            style={styles.pdfPageImage}
                            resizeMode="contain"
                          />
                          <View style={[styles.pdfPageCheck, { backgroundColor: isSelected ? tokens.mint : "rgba(0,0,0,0.4)" }]}>
                            <Text style={[styles.pdfPageCheckText, { color: "#fff" }]}>
                              Page {page.page}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    }}
                  />
                ) : (
                  <View style={styles.previewPdfPlaceholder}>
                    <Ionicons name="document-text-outline" size={48} color={tokens.mint} />
                    <Text style={[styles.previewPdfText, { color: tokens.inkMuted }]}>
                      PDF preview will be available after upload
                    </Text>
                  </View>
                )}
                {!pdfPreviewLoading && pdfTruncated && (
                  <View style={styles.pdfTruncatedNote}>
                    <Ionicons name="information-circle-outline" size={14} color={tokens.inkMuted} />
                    <Text style={[styles.pdfTruncatedText, { color: tokens.inkMuted }]}>
                      {t("study.sow_upload.pdf_preview_truncated", {
                        count: pdfTotalPages,
                        defaultValue:
                          "Showing the first {{count}} pages. Tick the pages you want and upload.",
                      })}
                    </Text>
                  </View>
                )}
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
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={imageViewerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setImageViewerVisible(false)}
      >
        <Pressable
          style={styles.imageViewerOverlay}
          onPress={() => setImageViewerVisible(false)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{ width: "100%", flex: 1 }}
          >
            {/* A gallery, not a single image. The student picked
                several pages and the viewer has to let them see all of
                them — showing one at a time with no way forward meant
                the other pages were invisible. */}
            <FlatList
              data={previewFiles}
              horizontal
              pagingEnabled
              keyExtractor={(item, index) => `${item.uri}-${index}`}
              initialScrollIndex={previewIndex}
              getItemLayout={(_, index) => ({
                length: viewerWidth,
                offset: viewerWidth * index,
                index,
              })}
              onMomentumScrollEnd={(event) => {
                const index = Math.round(
                  event.nativeEvent.contentOffset.x / viewerWidth,
                );
                const next = previewFiles[index];
                if (next) setPreviewFile(next);
              }}
              renderItem={({ item }) => (
                <PinchGestureHandler
                  onGestureEvent={(e) => {
                    scale.value = Math.max(1, e.nativeEvent.scale);
                  }}
                  onEnded={() => {
                    if (scale.value < 1.1) {
                      scale.value = withSpring(1);
                    }
                  }}
                >
                  <Animated.View style={styles.imageViewerWrap}>
                    <Animated.Image
                      source={{ uri: item.uri }}
                      style={[styles.imageViewerImage, animatedStyle]}
                      resizeMode="contain"
                    />
                  </Animated.View>
                </PinchGestureHandler>
              )}
            />
            {previewFiles.length > 1 && (
              <View style={styles.imageViewerCounterWrap} pointerEvents="none">
                <Text style={styles.imageViewerCounter}>
                  {previewIndex + 1} of {previewFiles.length}
                </Text>
              </View>
            )}
            <Pressable
              style={styles.imageViewerClose}
              onPress={() => setImageViewerVisible(false)}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={32} color="#fff" />
            </Pressable>
          </Pressable>
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

  outlineMeta: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },

  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
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

  adCard: {
    marginTop: 16,
  },
  adBanner: {
    marginTop: 12,
    marginBottom: 8,
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

  previewThumbs: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },

  previewThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    overflow: "hidden",
  },

  previewThumbImg: {
    width: "100%",
    height: "100%",
  },

  previewPdfPlaceholder: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 24,
  },

  previewPdfContainer: {
    maxHeight: 420,
  },

  loadingPages: {
    paddingVertical: 12,
  },

  pdfScroll: {
    width: "100%",
  },

  pdfPageItem: {
    width: 280,
    marginRight: 12,
  },

  pdfPageImage: {
    width: 280,
    height: 360,
    borderRadius: 10,
    backgroundColor: "#F3F4F6",
  },

  pdfPageCheck: {
    position: "absolute",
    bottom: 8,
    left: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },

  pdfPageCheckText: {
    fontSize: 12,
    fontWeight: "700",
  },

  previewPdfText: {
    fontSize: 13,
    textAlign: "center",
  },
  pdfTruncatedNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 8,
  },
  pdfTruncatedText: {
    fontSize: 11,
    flex: 1,
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

  previewThumbWrap: {
    position: "relative",
  },

  previewThumbRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 10,
    padding: 1,
  },

  imageViewerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
  },

  imageViewerWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  imageViewerImage: {
    width: "100%",
    height: "100%",
  },

  imageViewerClose: {
    position: "absolute",
    top: 48,
    right: 16,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 20,
    padding: 4,
  },

  imageViewerCounterWrap: {
    position: "absolute",
    bottom: 40,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },

  imageViewerCounter: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
});
