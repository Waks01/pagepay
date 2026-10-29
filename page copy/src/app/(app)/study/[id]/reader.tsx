import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Alert,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useQuery } from "@tanstack/react-query";

import { apiFetch, API_URL } from "@/src/shared/api/client";
import { PageHeader } from "@/components/PageHeader";
import { SpecialBlockCard } from "@/components/study/SpecialBlockCard";
import { RichText } from "@/components/study/RichText";
import { StudyAudioPlayer } from "@/src/components/study/StudyAudioPlayer";
import AudioUnlockModal from "@/components/AudioUnlockModal";
import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import {
  fetchMaterialFigures,
  fetchMaterialPages,
  type MaterialFigure,
  type MaterialPage,
} from "@/src/features/study/api";

type ContentBlock =
  | { type: "heading"; text: string; level: number }
  | { type: "body"; text: string }
  | {
      type: "list";
      style: "bullet" | "numbered";
      items: string[];
    }
  | { type: "numbered_list"; items: string[] }
  | { type: "tip"; label?: string; text: string }
  | { type: "warning"; label?: string; text: string }
  | { type: "calculation"; label?: string; steps: string[] }
  | { type: "code"; language?: string; text: string }
  | { type: "quote"; text: string; attribution?: string }
  | { type: "formula"; text: string; description?: string }
  | { type: "statement"; label?: string; text: string }
  | { type: "definition"; term?: string; text: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | {
      type: "figure";
      figure_index?: number;
      page?: number;
      caption?: string;
      text?: string;
      description?: string;
    }
  | { type: "recap"; items: string[] };

type MaterialDetail = {
  id: number;
  title: string;
  content: string | null;
  parsed_structure: Record<string, unknown> | null;
  explanation_structure?: Record<string, unknown> | null;
  page_count?: number;
  figure_count?: number;
};

type ReaderMode = "original" | "explained";

const SPECIAL_BLOCK_TYPES = new Set([
  "tip",
  "warning",
  "calculation",
  "code",
  "quote",
  "formula",
  "statement",
  "definition",
  "table",
]);

function blocksOf(structure: unknown): ContentBlock[] {
  if (!structure || typeof structure !== "object") return [];
  const source = structure as {
    content_blocks?: unknown;
    blocks?: unknown;
  };
  const list = source.blocks ?? source.content_blocks;
  return Array.isArray(list) ? (list as ContentBlock[]) : [];
}

export default function MaterialReaderScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const materialId = Number(id);
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [ttsUrl, setTtsUrl] = useState<string | null>(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const player = useAudioPlayer(ttsUrl);
  const audioStatus = useAudioPlayerStatus(player);
  const [audioUnlockVisible, setAudioUnlockVisible] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  /** Mirrors `audioUnlocked` so callbacks always read the current value. */
  const audioUnlockedRef = useRef(false);

  const [mode, setMode] = useState<ReaderMode>("explained");

  /** Guards against re-calling play() on every status tick. */
  const startedUrlRef = useRef<string | null>(null);

  // Start playback automatically once the audio source has loaded.
  useEffect(() => {
    if (ttsUrl && startedUrlRef.current !== ttsUrl && audioStatus.isLoaded) {
      startedUrlRef.current = ttsUrl;
      void player.play();
    }
  }, [ttsUrl, audioStatus.isLoaded, player]);

  const materialQ = useQuery({
    queryKey: ["study", "material", materialId],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/study/materials/${materialId}`);
      if (!res.ok) throw new Error("Failed to load material");
      return res.json() as Promise<MaterialDetail>;
    },
  });

  const pagesQ = useQuery({
    queryKey: ["study", "material", materialId, "page-images"],
    queryFn: () => fetchMaterialPages(materialId),
  });

  const figuresQ = useQuery({
    queryKey: ["study", "material", materialId, "figures"],
    queryFn: () => fetchMaterialFigures(materialId),
    enabled: mode === "explained",
  });

  const figuresByIndex = useMemo(() => {
    const map = new Map<number, MaterialFigure>();
    for (const figure of figuresQ.data ?? []) {
      map.set(figure.figure_index, figure);
    }
    return map;
  }, [figuresQ.data]);

  /**
   * The page a figure was found on.
   *
   * A photo of a textbook page has no geometry to cut a diagram out of,
   * so the whole photo is the figure. When the figure has no crop of
   * its own the page is shown instead — the diagram is still visible,
   * which is the whole point.
   */
  const pageImageFor = useCallback(
    (page: number): string | null => {
      const match = (pagesQ.data ?? []).find((p) => p.page === page);
      return match?.image_url ?? null;
    },
    [pagesQ.data],
  );

  const handleTtsPress = useCallback(async () => {
    const content = materialQ.data?.content;
    if (!content) return;

    // Audio already loaded — toggle playback.
    if (ttsUrl) {
      if (audioStatus.playing) player.pause();
      else void player.play();
      return;
    }

    if (!audioUnlockedRef.current) {
      setAudioUnlockVisible(true);
      return;
    }

    setTtsLoading(true);
    try {
      const res = await apiFetch(`/api/v1/study/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: content,
          material_id: materialId,
        }),
      });

      if (!res.ok) {
        if (res.status === 403) {
          setAudioUnlockVisible(true);
          return;
        }
        throw new Error("TTS failed");
      }

      const data = await res.json();
      // The endpoint returns a path; expo-audio needs an absolute URL.
      const fullUrl = data.url?.startsWith("http")
        ? data.url
        : `${API_URL}${data.url}`;
      startedUrlRef.current = null;
      setTtsUrl(fullUrl);
    } catch (err) {
      if (__DEV__) console.error("TTS error:", err);
      Alert.alert(
        "Playback Unavailable",
        "Audio generation failed. Please try again later.",
      );
    } finally {
      setTtsLoading(false);
    }
  }, [materialId, materialQ.data, ttsUrl, audioStatus.playing, player]);

  /**
   * The blocks the reader shows.
   *
   * The teaching layer is preferred — it is the same material in plain
   * language with every diagram described. The faithful layer is the
   * fallback for anything uploaded before the teaching layer existed,
   * or when the model could not produce one.
   */
  const blocks = useMemo(() => {
    const explained = blocksOf(materialQ.data?.explanation_structure);
    if (explained.length > 0) return explained;
    return blocksOf(materialQ.data?.parsed_structure);
  }, [materialQ.data]);

  const hasOriginalPages = (materialQ.data?.page_count ?? 0) > 0;

  const renderFigure = (block: ContentBlock, key: string) => {
    const figureBlock = block as Extract<ContentBlock, { type: "figure" }>;
    const index = figureBlock.figure_index ?? 0;
    const stored = index > 0 ? figuresByIndex.get(index) : undefined;
    const caption = figureBlock.caption || stored?.caption || "";
    const description =
      figureBlock.text ||
      figureBlock.description ||
      stored?.description ||
      "";
    const page = figureBlock.page ?? stored?.page ?? 1;
    // The crop if there is one, otherwise the page the figure was on.
    const imageUrl = stored?.image_url ?? pageImageFor(page);

    return (
      <View key={key} style={styles.figureCard}>
        {imageUrl ? (
          <ExpoImage
            source={{ uri: imageUrl }}
            style={[
              styles.figureImage,
              // A whole page is tall and narrow; a crop of a diagram
              // is usually wide. Letting the height follow the image
              // keeps both readable.
              { height: stored?.image_url ? 220 : 320 },
            ]}
            contentFit="contain"
            transition={200}
            accessibilityLabel={caption || "Figure from your material"}
          />
        ) : (
          <View style={[styles.figureImage, styles.figurePlaceholder]}>
            <Ionicons name="image-outline" size={22} color={tokens.inkFaint} />
            <Text style={[styles.figurePlaceholderText, { color: tokens.inkMuted }]}>
              Figure {index || ""} from page {page}
            </Text>
          </View>
        )}
        {caption ? (
          <Text style={[styles.figureCaption, { color: tokens.ink }]}>
            {caption}
          </Text>
        ) : null}
        {description ? (
          <Text style={[styles.figureDescription, { color: tokens.inkMuted }]}>
            {description}
          </Text>
        ) : null}
      </View>
    );
  };

  const renderRecap = (block: ContentBlock, key: string) => {
    const recap = block as Extract<ContentBlock, { type: "recap" }>;
    const items = Array.isArray(recap.items) ? recap.items : [];
    if (items.length === 0) return null;
    return (
      <View
        key={key}
        style={[styles.recapCard, { backgroundColor: tokens.mintSoft }]}
      >
        <Text style={[styles.recapTitle, { color: tokens.mint }]}>
          What to remember
        </Text>
        {items.map((item, i) => (
          <View key={i} style={styles.recapItem}>
            <Text style={[styles.recapMarker, { color: tokens.mint }]}>
              {"\u2022"}
            </Text>
            <Text style={[styles.recapItemText, { color: tokens.ink }]}>
              {item}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  const renderContentBlocks = () => {
    if (blocks.length === 0) return null;

    return blocks.map((block: ContentBlock, idx: number) => {
      const key = `block-${idx}`;

      if (block.type === "heading") {
        const level = block.level || 1;
        const fontSize = level === 1 ? 26 : level === 2 ? 21 : 17;
        const fontWeight =
          level === 1 ? "700" : level === 2 ? "600" : "500";
        const marginBottom = level === 1 ? 20 : level === 2 ? 15 : 11;
        const marginTop = level === 1 ? 28 : level === 2 ? 20 : 16;
        const letterSpacing = level <= 2 ? 0.2 : 0.1;

        return (
          <RichText
            key={key}
            color={tokens.ink}
            fontSize={fontSize}
            lineHeight={fontSize * 1.15}
            style={{
              fontWeight,
              marginBottom,
              marginTop,
              letterSpacing,
            }}
          >
            {block.text}
          </RichText>
        );
      }

      if (block.type === "body") {
        return (
          <RichText
            key={key}
            color={tokens.ink}
            fontSize={16}
            lineHeight={26}
            style={{ marginBottom: 12 }}
          >
            {block.text}
          </RichText>
        );
      }

      if (block.type === "list") {
        return (
          <View key={key} style={styles.readerList}>
            {block.items?.map((item, i) => (
              <View key={i} style={styles.readerListItem}>
                <Text
                  style={[
                    styles.readerListMarker,
                    { color: tokens.mint },
                  ]}
                >
                  {"\u2022"}
                </Text>
                <RichText
                  color={tokens.ink}
                  fontSize={15}
                  lineHeight={24}
                  style={styles.readerListItemText}
                >
                  {item}
                </RichText>
              </View>
            ))}
          </View>
        );
      }

      if (block.type === "numbered_list") {
        return (
          <View key={key} style={styles.readerList}>
            {block.items?.map((item, i) => (
              <View key={i} style={styles.readerListItem}>
                <Text
                  style={[
                    styles.readerListMarker,
                    { color: tokens.mint },
                  ]}
                >
                  {i + 1}.
                </Text>
                <RichText
                  color={tokens.ink}
                  fontSize={15}
                  lineHeight={24}
                  style={styles.readerListItemText}
                >
                  {item}
                </RichText>
              </View>
            ))}
          </View>
        );
      }

      if (block.type === "figure") {
        return renderFigure(block, key);
      }

      if (block.type === "recap") {
        return renderRecap(block, key);
      }

      if (SPECIAL_BLOCK_TYPES.has(block.type)) {
        return (
          <SpecialBlockCard
            key={key}
            block={block}
            tokens={tokens}
            index={idx}
          />
        );
      }

      // A block type this screen does not know about is still content.
      // Dropping it silently would take a piece of the student's
      // material out of the lesson without telling them.
      const text = (block as { text?: string }).text;
      if (text) {
        return (
          <RichText
            key={key}
            color={tokens.ink}
            fontSize={16}
            lineHeight={26}
            style={{ marginBottom: 12 }}
          >
            {text}
          </RichText>
        );
      }
      return null;
    });
  };

  if (materialQ.isLoading) {
    return (
      <SafeAreaView
        edges={["top", "bottom"]}
        style={{ flex: 1, backgroundColor: tokens.paper }}
      >
        <View style={styles.centered}>
          <Text style={{ color: tokens.inkMuted }}>
            Loading content...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!materialQ.data) {
    return (
      <SafeAreaView
        edges={["top", "bottom"]}
        style={{ flex: 1, backgroundColor: tokens.paper }}
      >
        <View style={styles.centered}>
          <Text style={{ color: tokens.signal }}>Material not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const hasStructuredContent = blocks.length > 0;

  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={{ flex: 1, backgroundColor: tokens.paper }}
    >
      <PageHeader
        title={materialQ.data.title}
        showBack
        onBack={() => {
          player.pause();
          router.back();
        }}
        backgroundColor={tokens.card}
        borderBottomColor={tokens.border}
        tokens={tokens}
        right={
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={handleTtsPress}
              disabled={ttsLoading}
              style={[
                styles.ttsBtn,
                { borderColor: tokens.border, backgroundColor: tokens.mintSoft },
              ]}
            >
              <Ionicons
                name={
                  ttsLoading
                    ? "hourglass-outline"
                    : ttsUrl && audioStatus.playing
                      ? "pause"
                      : "play"
                }
                size={20}
                color={tokens.mint}
              />
              <Text style={[styles.ttsText, { color: tokens.mint }]}>
                {ttsLoading
                  ? t("common.loading")
                  : ttsUrl && audioStatus.playing
                    ? t("study.tts.pause")
                    : t("study.tts.listen")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() =>
                router.push(`/study/${materialId}/podcast`)
              }
              style={[
                styles.ttsBtn,
                { borderColor: tokens.border, backgroundColor: tokens.card },
              ]}
            >
              <Ionicons name="headset-outline" size={18} color={tokens.ink} />
              <Text style={[styles.ttsText, { color: tokens.ink }]}>
                Podcast
              </Text>
            </TouchableOpacity>
          </View>
        }
      />

      <View style={[styles.modeBar, { borderBottomColor: tokens.border }]}>
        <ModeTab
          label="My material"
          active={mode === "original"}
          onPress={() => setMode("original")}
          tokens={tokens}
          disabled={!hasOriginalPages}
        />
        <ModeTab
          label="Explained"
          active={mode === "explained"}
          onPress={() => setMode("explained")}
          tokens={tokens}
        />
      </View>

      {mode === "original" ? (
        <FlatList
          data={pagesQ.data ?? []}
          keyExtractor={(item) => String(item.page)}
          renderItem={({ item }) => (
            <View style={styles.pageWrap}>
              {item.image_url ? (
                <ExpoImage
                  source={{ uri: item.image_url }}
                  style={styles.pageImage}
                  contentFit="contain"
                  transition={200}
                  recyclingKey={`page-${item.page}`}
                  cachePolicy="memory-disk"
                  accessibilityLabel={`Page ${item.page} of your material`}
                />
              ) : (
                <Text style={[styles.pageMissing, { color: tokens.inkMuted }]}>
                  Page {item.page} is not available.
                </Text>
              )}
            </View>
          )}
          ListEmptyComponent={
            pagesQ.isLoading ? (
              <Text style={[styles.readerBody, { color: tokens.inkMuted }]}>
                Loading your pages...
              </Text>
            ) : (
              <Text style={[styles.readerBody, { color: tokens.inkMuted }]}>
                The pages of this material are not available.
              </Text>
            )
          }
          contentContainerStyle={
            ttsUrl ? styles.scrollContentWithPlayer : styles.pageListContent
          }
          // A decoded page costs about 10 MB, so mounting every page of
          // a long document at once asks for hundreds of megabytes and
          // kills the app on a mid-range phone. Only the pages near
          // the screen are held in memory.
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          windowSize={3}
          removeClippedSubviews
        />
      ) : (
        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={
            ttsUrl ? styles.scrollContentWithPlayer : undefined
          }
        >
          {hasStructuredContent ? (
            renderContentBlocks()
          ) : (
            <Text style={[styles.readerText, { color: tokens.ink }]}>
              {materialQ.data.content || "No content available"}
            </Text>
          )}
        </ScrollView>
      )}

      {ttsUrl && (
        <View style={styles.playerDock} pointerEvents="box-none">
          <StudyAudioPlayer
            title={materialQ.data.title}
            player={player}
            status={audioStatus}
          />
        </View>
      )}

      {materialQ.data && (
        <AudioUnlockModal
          visible={audioUnlockVisible}
          materialId={materialId}
          materialTitle={materialQ.data.title}
          onClose={() => setAudioUnlockVisible(false)}
          onUnlocked={() => {
            // Set the ref synchronously so the handler called below sees it.
            audioUnlockedRef.current = true;
            setAudioUnlocked(true);
            setAudioUnlockVisible(false);
            // Resume the interrupted playback request now that audio is unlocked.
            void handleTtsPress();
          }}
        />
      )}
    </SafeAreaView>
  );
}

function ModeTab({
  label,
  active,
  onPress,
  tokens,
  disabled,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  tokens: (typeof PagePay)["light"];
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={styles.modeTab}
    >
      <Text
        style={[
          styles.modeTabText,
          {
            color: active ? tokens.mint : tokens.inkMuted,
            opacity: disabled ? 0.4 : 1,
            fontWeight: active ? "700" : "500",
          },
        ]}
      >
        {label}
      </Text>
      <View
        style={[
          styles.modeTabUnderline,
          { backgroundColor: active ? tokens.mint : "transparent" },
        ]}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  modeBar: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modeTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
  },
  modeTabText: {
    fontSize: 14,
  },
  modeTabUnderline: {
    height: 2,
    width: 40,
    borderRadius: 2,
    marginTop: 6,
  },
  scrollContent: {
    flex: 1,
    padding: 16,
  },
  scrollContentWithPlayer: {
    paddingBottom: 168,
  },
  playerDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: 12,
  },
  readerHeading: {
    lineHeight: 30,
  },
  readerBody: {
    fontSize: 16,
    lineHeight: 26,
    marginBottom: 12,
  },
  readerList: {
    gap: 8,
    marginBottom: 12,
    paddingLeft: 4,
  },
  readerListItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  readerListMarker: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
    minWidth: 20,
  },
  readerListItemText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 24,
  },
  readerText: {
    fontSize: 16,
    lineHeight: 26,
  },
  figureCard: {
    marginBottom: 18,
    borderRadius: 14,
    overflow: "hidden",
  },
  figureImage: {
    width: "100%",
    height: 220,
    borderRadius: 14,
    backgroundColor: "#F5F2EA",
  },
  figurePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  figurePlaceholderText: {
    fontSize: 13,
  },
  figureCaption: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 8,
  },
  figureDescription: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: 4,
  },
  recapCard: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 18,
  },
  recapTitle: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  recapItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 4,
  },
  recapMarker: {
    fontSize: 14,
    lineHeight: 21,
  },
  recapItemText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
  },
  pageWrap: {
    marginBottom: 18,
    borderRadius: 12,
    overflow: "hidden",
  },
  pageListContent: {
    padding: 16,
  },
  pageImage: {
    width: "100%",
    aspectRatio: 0.72,
    backgroundColor: "#F5F2EA",
  },
  pageMissing: {
    fontSize: 14,
    paddingVertical: 24,
    textAlign: "center",
  },
  ttsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: PagePay.light.mint,
  },
  ttsText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
