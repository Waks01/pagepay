/**
 * ListenMode — v3 §3.3 audio narration player.
 *
 * Plays pre-rendered TTS MP3 files from /api/v1/content/audio/{unit_id}.mp3.
 * The first unit of any work is free; units 2+ require premium.
 *
 * Player controls per v3 §3.3:
 *   - Play/pause
 *   - ±15s skip (backward/forward)
 *   - Speed: 0.75x / 1x / 1.25x / 1.5x
 *   - Background playback (via expo-av audio mode)
 *
 * UX: the audio URL is fetched from the server (via the slice detail
 * response, which now includes `audio_url: string | null`). If the
 * audio isn't generated yet (404), we fall back to the placeholder
 * with a "Not available yet" message.
 *
 * Gating: the ENDPOINT is public (no JWT), but the PLAYER checks
 * `isPremium` before allowing playback of units 2+. The gate happens
 * here, not server-side, per v3 §3.3 rationale.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { Pressable, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

export interface ListenModeProps {
  unitId: number;
  audioUrl: string | null;
  isFirstUnit: boolean;
  isPremium: boolean;
  onUpgrade: () => void;
}

type PlaybackSpeed = 0.75 | 1 | 1.25 | 1.5;

export function ListenMode({
  unitId,
  audioUrl,
  isFirstUnit,
  isPremium,
  onUpgrade,
}: ListenModeProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const positionUpdateInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const locked = !isFirstUnit && !isPremium;

  // Load audio on mount or when audioUrl/unitId changes
  useEffect(() => {
    if (!audioUrl || locked) return;

    setIsLoading(true);
    setError(null);

    const loadAudio = async () => {
      try {
        // Configure expo-av for background playback (v3 §3.3)
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: true,
        });

        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: audioUrl },
          { shouldPlay: false, rate: speed },
          (status) => {
            if (status.isLoaded) {
              setDuration(status.durationMillis || 0);
              setIsPlaying(status.isPlaying);
              setPosition(status.positionMillis);
            }
          },
        );

        setSound(newSound);
        setIsLoading(false);
      } catch (err) {
        console.error('Audio load failed:', err);
        setError('Audio not available yet. The TTS generation may still be processing.');
        setIsLoading(false);
      }
    };

    loadAudio();

    // Cleanup on unmount or URL change
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
      if (positionUpdateInterval.current) {
        clearInterval(positionUpdateInterval.current);
      }
    };
  }, [audioUrl, unitId, locked, speed]);

  // Update position every 500ms while playing
  useEffect(() => {
    if (isPlaying && sound) {
      positionUpdateInterval.current = setInterval(async () => {
        const status = await sound.getStatusAsync();
        if (status.isLoaded) {
          setPosition(status.positionMillis);
        }
      }, 500);
    } else {
      if (positionUpdateInterval.current) {
        clearInterval(positionUpdateInterval.current);
        positionUpdateInterval.current = null;
      }
    }

    return () => {
      if (positionUpdateInterval.current) {
        clearInterval(positionUpdateInterval.current);
      }
    };
  }, [isPlaying, sound]);

  const togglePlayPause = useCallback(async () => {
    if (!sound) return;
    if (isPlaying) {
      await sound.pauseAsync();
    } else {
      await sound.playAsync();
    }
  }, [sound, isPlaying]);

  const skip = useCallback(
    async (seconds: number) => {
      if (!sound) return;
      const status = await sound.getStatusAsync();
      if (status.isLoaded) {
        const newPos = Math.max(0, Math.min(duration, position + seconds * 1000));
        await sound.setPositionAsync(newPos);
      }
    },
    [sound, position, duration],
  );

  const cycleSpeed = useCallback(async () => {
    if (!sound) return;
    const speeds: PlaybackSpeed[] = [0.75, 1, 1.25, 1.5];
    const currentIndex = speeds.indexOf(speed);
    const nextSpeed = speeds[(currentIndex + 1) % speeds.length];
    await sound.setRateAsync(nextSpeed, true);
    setSpeed(nextSpeed);
  }, [sound, speed]);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  if (locked) {
    // Locked state: free user on unit 2+
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: tokens.signalSoft, borderColor: tokens.signal },
        ]}
      >
        <View style={styles.row}>
          <Ionicons name="lock-closed" size={20} color={tokens.signal} />
          <Text style={[styles.title, { color: tokens.ink }]}>
            Listen mode is Premium
          </Text>
        </View>
        <Text style={[styles.body, { color: tokens.inkMuted }]}>
          The first slice of any book is free to listen. Beyond that, audio narration is part of PagePay Premium.
        </Text>
        <Pressable
          onPress={onUpgrade}
          style={[styles.cta, { backgroundColor: tokens.signal }]}
        >
          <Text style={[styles.ctaText, { color: 'white' }]}>
            See Premium
          </Text>
        </Pressable>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
        <ActivityIndicator size="small" color={tokens.mint} />
        <Text style={[styles.loadingText, { color: tokens.inkMuted }]}>
          Loading audio...
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: tokens.mintSoft, borderColor: tokens.mint },
        ]}
      >
        <Text style={[styles.title, { color: tokens.ink }]}>Audio not available</Text>
        <Text style={[styles.body, { color: tokens.inkMuted }]}>{error}</Text>
      </View>
    );
  }

  if (!audioUrl) {
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: tokens.mintSoft, borderColor: tokens.mint },
        ]}
      >
        <Text style={[styles.title, { color: tokens.ink }]}>No audio available</Text>
        <Text style={[styles.body, { color: tokens.inkMuted }]}>
          This unit doesn't have audio narration yet.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.player, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
      {/* Progress bar */}
      <View style={styles.progressContainer}>
        <Text style={[styles.timeText, { color: tokens.inkMuted }]}>
          {formatTime(position)}
        </Text>
        <View style={[styles.progressBar, { backgroundColor: tokens.border }]}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: tokens.mint, width: `${(position / duration) * 100}%` },
            ]}
          />
        </View>
        <Text style={[styles.timeText, { color: tokens.inkMuted }]}>
          {formatTime(duration)}
        </Text>
      </View>

      {/* Playback controls */}
      <View style={styles.controls}>
        <Pressable onPress={() => skip(-15)} hitSlop={8}>
          <Ionicons name="play-back" size={32} color={tokens.inkMuted} />
        </Pressable>

        <Pressable onPress={togglePlayPause} style={[styles.playButton, {backgroundColor: tokens.mint}]}>
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={40}
            color={tokens.mintText}
            style={styles.playIcon}
          />
        </Pressable>

        <Pressable onPress={() => skip(15)} hitSlop={8}>
          <Ionicons name="play-forward" size={32} color={tokens.inkMuted} />
        </Pressable>
      </View>

      {/* Speed control */}
      <Pressable onPress={cycleSpeed} style={styles.speedButton}>
        <Text style={[styles.speedText, { color: tokens.mint }]}>{speed}×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginVertical: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 8,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  cta: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  ctaText: {
    fontSize: 13,
    fontWeight: '700',
  },
  loadingText: {
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  player: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    marginVertical: 12,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  timeText: {
    fontSize: 11,
    fontWeight: '600',
    minWidth: 36,
  },
  progressBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    marginHorizontal: 12,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
    marginBottom: 16,
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: {
    marginLeft: 2,
  },
  speedButton: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  speedText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
