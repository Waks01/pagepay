import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useAudioPlayer } from "expo-audio";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/src/shared/api/client";
import { PageHeader } from "@/components/PageHeader";
import { SpecialBlockCard } from "@/components/study/SpecialBlockCard";
import AudioUnlockModal from "@/components/AudioUnlockModal";
import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";

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
  | { type: "table"; headers: string[]; rows: string[][] };

type MaterialDetail = {
  id: number;
  title: string;
  content: string | null;
  parsed_structure: Record<string, unknown> | null;
};

const SPECIAL_BLOCK_TYPES = new Set([
  "tip",
  "warning",
  "calculation",
  "code",
  "quote",
  "formula",
  "table",
]);

export default function MaterialReaderScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const materialId = Number(id);
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [ttsUrl, setTtsUrl] = useState<string | null>(null);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsLoading, setTtsLoading] = useState(false);
  const player = useAudioPlayer(ttsUrl);
  const [audioUnlockVisible, setAudioUnlockVisible] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  const materialQ = useQuery({
    queryKey: ["study", "material", materialId],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/study/materials/${materialId}`);
      if (!res.ok) throw new Error("Failed to load material");
      return res.json() as Promise<MaterialDetail>;
    },
  });

  const handleTtsPress = useCallback(async () => {
    const content = materialQ.data?.content;
    if (!content) return;

    if (ttsPlaying) {
      player.pause();
      setTtsPlaying(false);
      return;
    }

    if (!audioUnlocked) {
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
      setTtsUrl(data.url);
      setTtsPlaying(true);
    } catch (err) {
      if (__DEV__) console.error("TTS error:", err);
      Alert.alert(
        "Playback Unavailable",
        "Audio generation failed. Please try again later.",
      );
    } finally {
      setTtsLoading(false);
    }
  }, [materialId, materialQ.data, ttsPlaying, player, audioUnlocked]);

  const renderContentBlocks = () => {
    const data = materialQ.data;
    if (!data?.parsed_structure) return null;

    try {
      const parsed = JSON.parse(
        JSON.stringify(data.parsed_structure),
      ) as { content_blocks?: ContentBlock[] };
      const blocks = parsed?.content_blocks;

      if (!Array.isArray(blocks) || blocks.length === 0) return null;

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
            <Text
              key={key}
              style={[
                styles.readerHeading,
                {
                  fontSize,
                  fontWeight,
                  marginBottom,
                  marginTop,
                  letterSpacing,
                  color: tokens.ink,
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
              key={key}
              style={[styles.readerBody, { color: tokens.ink }]}
            >
              {block.text}
            </Text>
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
                  <Text
                    style={[
                      styles.readerListItemText,
                      { color: tokens.ink },
                    ]}
                  >
                    {item}
                  </Text>
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
                  <Text
                    style={[
                      styles.readerListItemText,
                      { color: tokens.ink },
                    ]}
                  >
                    {item}
                  </Text>
                </View>
              ))}
            </View>
          );
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

        return null;
      });
    } catch (e) {
      if (__DEV__) {
        console.error("Failed to render content blocks:", e);
      }
      return null;
    }
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

  const hasStructuredContent = (() => {
    try {
      const parsed = JSON.parse(
        JSON.stringify(materialQ.data.parsed_structure),
      ) as { content_blocks?: ContentBlock[] } | null;
      return Array.isArray(parsed?.content_blocks) &&
        parsed.content_blocks.length > 0;
    } catch {
      return false;
    }
  })();

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
          setTtsPlaying(false);
          router.back();
        }}
        backgroundColor={tokens.card}
        borderBottomColor={tokens.border}
        tokens={tokens}
        right={
          <TouchableOpacity
            onPress={handleTtsPress}
            disabled={ttsLoading}
            style={styles.ttsBtn}
          >
            <Ionicons
              name={ttsPlaying ? "pause" : "play"}
              size={20}
              color={tokens.mint}
            />
            <Text style={[styles.ttsText, { color: tokens.mint }]}>
              {ttsLoading
                ? t("common.loading")
                : ttsPlaying
                  ? t("study.tts.pause")
                  : t("study.tts.listen")}
            </Text>
          </TouchableOpacity>
        }
      />
      <ScrollView style={styles.scrollContent}>
        {hasStructuredContent ? (
          renderContentBlocks()
        ) : (
          <Text style={[styles.readerText, { color: tokens.ink }]}>
            {materialQ.data.content || "No content available"}
          </Text>
        )}
      </ScrollView>

      {materialQ.data && (
        <AudioUnlockModal
          visible={audioUnlockVisible}
          materialId={materialId}
          materialTitle={materialQ.data.title}
          contentLength={materialQ.data.content?.length ?? 0}
          onClose={() => setAudioUnlockVisible(false)}
          onUnlocked={() => {
            setAudioUnlocked(true);
            setAudioUnlockVisible(false);
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  scrollContent: {
    flex: 1,
    padding: 16,
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
