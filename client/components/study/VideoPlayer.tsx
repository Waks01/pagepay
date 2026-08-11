import { useState, useEffect } from 'react';
import { StyleSheet, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer } from 'expo-audio';
import { Video, useVideoPlayer } from 'expo-video';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type Scene = {
  time: string;
  visual: string;
  narration: string;
  text_overlay: string;
};

type VideoContent = {
  title: string;
  duration_seconds: number;
  scenes: Scene[];
  summary: string;
};

type VideoPlayerProps = {
  content: VideoContent;
  videoUri?: string | null;
};

type VideoPlayerState = {
  currentScene: number;
  isPlaying: boolean;
  showScript: boolean;
};

export function VideoPlayer({ content, videoUri }: VideoPlayerProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const [state, setState] = useState<VideoPlayerState>({
    currentScene: 0,
    isPlaying: false,
    showScript: false,
  });

  const scenes = content.scenes || [];
  const current = scenes[state.currentScene];
  const isLast = state.currentScene >= scenes.length - 1;

  const audioPlayer = useAudioPlayer(null);
  const videoPlayer = videoUri ? useVideoPlayer(videoUri) : null;

  useEffect(() => {
    return () => {
      audioPlayer.stop();
      videoPlayer?.stop();
    };
  }, [audioPlayer, videoPlayer]);

  const playScene = async (sceneIndex: number) => {
    audioPlayer.stop();
    const scene = scenes[sceneIndex];
    if (!scene?.narration) return;

    try {
      audioPlayer.replace({ uri: `data:audio/mp3;base64,` });
      audioPlayer.play();
    } catch {
      // narration not available
    }
  };

  const handlePlay = async () => {
    if (state.isPlaying) {
      audioPlayer.stop();
      videoPlayer?.pause();
      setState((prev) => ({ ...prev, isPlaying: false }));
      return;
    }

    if (isLast) {
      setState((prev) => ({ ...prev, currentScene: 0, isPlaying: true }));
    } else {
      setState((prev) => ({ ...prev, isPlaying: true }));
    }

    playScene(state.currentScene);
    if (videoPlayer) {
      videoPlayer.play();
    }

    const sceneDuration = (content.duration_seconds / scenes.length) * 1000;
    setTimeout(() => {
      setState((prev) => {
        if (prev.currentScene < scenes.length - 1) {
          return { ...prev, currentScene: prev.currentScene + 1 };
        }
        return { ...prev, isPlaying: false };
      });
    }, sceneDuration);
  };

  const handleNext = async () => {
    if (!isLast) {
      audioPlayer.stop();
      videoPlayer?.pause();
      setState((prev) => ({ ...prev, currentScene: prev.currentScene + 1, isPlaying: false }));
    }
  };

  const handlePrev = async () => {
    if (state.currentScene > 0) {
      audioPlayer.stop();
      videoPlayer?.pause();
      setState((prev) => ({ ...prev, currentScene: prev.currentScene - 1, isPlaying: false }));
    }
  };

  const handleReset = async () => {
    audioPlayer.stop();
    videoPlayer?.stop();
    setState((prev) => ({ ...prev, currentScene: 0, isPlaying: false }));
  };

  return (
    <View style={[styles.container, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
      <View style={styles.header}>
        <Ionicons name="play-circle" size={24} color={tokens.mint} />
        <Text style={[styles.title, { color: tokens.ink }]}>{content.title}</Text>
        <Text style={[styles.duration, { color: tokens.inkMuted }]}>
          {content.duration_seconds}s
        </Text>
      </View>

      <View style={[styles.videoFrame, { backgroundColor: tokens.paper }]}>
        {videoPlayer ? (
          <Video
            player={videoPlayer}
            style={styles.video}
            resizeMode="contain"
          />
        ) : (
          <View style={styles.sceneContainer}>
            <View style={[styles.visualBox, { backgroundColor: tokens.mint + '15' }]}>
              <Ionicons name="image-outline" size={48} color={tokens.mint} />
              <Text style={[styles.visualText, { color: tokens.ink }]}>
                {current?.visual || 'Loading...'}
              </Text>
            </View>

            <View style={[styles.narrationBox, { backgroundColor: tokens.ink + '08' }]}>
              <Ionicons name="volume-high-outline" size={18} color={tokens.inkMuted} />
              <Text style={[styles.narrationText, { color: tokens.ink }]}>
                {current?.narration || ''}
              </Text>
            </View>

            {current?.text_overlay && (
              <View style={[styles.textOverlay, { backgroundColor: tokens.ink + '90' }]}>
                <Text style={styles.overlayText}>{current.text_overlay}</Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.sceneIndicator}>
          {scenes.map((_, idx) => (
            <View
              key={idx}
              style={[
                styles.dot,
                {
                  backgroundColor: idx === state.currentScene ? tokens.mint : tokens.border,
                  width: idx === state.currentScene ? 20 : 8,
                },
              ]}
            />
          ))}
        </View>
      </View>

      <View style={styles.controls}>
        <Pressable
          onPress={handlePrev}
          disabled={state.currentScene === 0}
          style={({ pressed }) => [
            styles.controlBtn,
            { opacity: pressed || state.currentScene === 0 ? 0.5 : 1 },
          ]}
        >
          <Ionicons name="play-back" size={22} color={tokens.ink} />
        </Pressable>

        <Pressable
          onPress={handlePlay}
          style={[styles.playBtn, { backgroundColor: tokens.mint }]}
        >
          <Ionicons
            name={state.isPlaying ? 'pause' : 'play'}
            size={28}
            color={tokens.mintText}
          />
        </Pressable>

        <Pressable
          onPress={handleNext}
          disabled={isLast}
          style={({ pressed }) => [
            styles.controlBtn,
            { opacity: pressed || isLast ? 0.5 : 1 },
          ]}
        >
          <Ionicons name="play-forward" size={22} color={tokens.ink} />
        </Pressable>

        <Pressable onPress={handleReset} style={styles.controlBtn}>
          <Ionicons name="refresh-outline" size={20} color={tokens.inkMuted} />
        </Pressable>

        <Pressable
          onPress={() => setState((prev) => ({ ...prev, showScript: !prev.showScript }))}
          style={styles.controlBtn}
        >
          <Ionicons
            name={state.showScript ? 'document-text' : 'document-text-outline'}
            size={20}
            color={tokens.inkMuted}
          />
        </Pressable>
      </View>

      {state.showScript && (
        <View style={[styles.scriptPanel, { backgroundColor: tokens.paper, borderColor: tokens.border }]}>
          <Text style={[styles.scriptTitle, { color: tokens.ink }]}>Video Script</Text>
          {scenes.map((scene, idx) => (
            <View key={idx} style={styles.scriptScene}>
              <Text style={[styles.scriptTime, { color: tokens.mint }]}>{scene.time}</Text>
              <Text style={[styles.scriptNarration, { color: tokens.ink }]}>
                {scene.narration}
              </Text>
            </View>
          ))}
          <View style={[styles.summaryBox, { backgroundColor: tokens.mint + '15', borderColor: tokens.border }]}>
            <Text style={[styles.summaryText, { color: tokens.ink }]}>
              {content.summary}
            </Text>
          </View>
        </View>
      )}

      <View style={[styles.sceneCounter, { backgroundColor: tokens.paper }]}>
        <Text style={[styles.sceneCounterText, { color: tokens.inkMuted }]}>
          Scene {state.currentScene + 1} of {scenes.length}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  duration: {
    fontSize: 13,
    fontWeight: '500',
  },
  videoFrame: {
    marginHorizontal: 16,
    borderRadius: 8,
    overflow: 'hidden',
  },
  video: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  sceneContainer: {
    padding: 20,
    gap: 12,
    minHeight: 200,
    justifyContent: 'center',
  },
  visualBox: {
    alignItems: 'center',
    gap: 12,
    padding: 20,
    borderRadius: 12,
  },
  visualText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  narrationBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
  },
  narrationText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  textOverlay: {
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  overlayText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  sceneIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 16,
  },
  controlBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scriptPanel: {
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  scriptTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  scriptScene: {
    gap: 4,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: PagePay.light.mint,
  },
  scriptTime: {
    fontSize: 12,
    fontWeight: '600',
  },
  scriptNarration: {
    fontSize: 13,
    lineHeight: 18,
  },
  summaryBox: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  summaryText: {
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  sceneCounter: {
    marginHorizontal: 16,
    padding: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  sceneCounterText: {
    fontSize: 12,
    fontWeight: '500',
  },
});
