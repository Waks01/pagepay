import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useAudioPlayer } from "expo-audio";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/src/shared/api/client";
import { PageHeader } from "@/components/PageHeader";
import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";

type MaterialDetail = {
  id: number;
  title: string;
  content: string | null;
};

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
          // In the reader screen, we navigate back to the detail screen to unlock
          // because that's where the unlock modal lives.
          router.back();
          return;
        }
        throw new Error("TTS failed");
      }

      const data = await res.json();
      setTtsUrl(data.url);
      setTtsPlaying(true);
    } catch (err) {
      if (__DEV__) console.error("TTS error:", err);
    } finally {
      setTtsLoading(false);
    }
  }, [materialId, materialQ.data, ttsPlaying, player]);

  if (materialQ.isLoading) {
    return (
      <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: tokens.paper }}>
        <View style={styles.centered}>
          <Text style={{ color: tokens.inkMuted }}>Loading content...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!materialQ.data) {
    return (
      <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: tokens.paper }}>
        <View style={styles.centered}>
          <Text style={{ color: tokens.signal }}>Material not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: tokens.paper }}>
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
              {ttsLoading ? t("common.loading") : ttsPlaying ? t("study.tts.pause") : t("study.tts.listen")}
            </Text>
          </TouchableOpacity>
        }
      />
      <ScrollView style={styles.scrollContent}>
        <Text style={[styles.readerText, { color: tokens.ink }]}>
          {materialQ.data.content}
        </Text>
      </ScrollView>
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
