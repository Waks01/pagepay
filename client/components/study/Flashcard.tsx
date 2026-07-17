import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { reviewCard, type CardDifficulty } from '@/src/features/study/spaced-repetition';

type FlashcardProps = {
  front: string;
  back: string;
  assetId: number;
  cardIndex: number;
  onReviewed?: (difficulty: CardDifficulty) => void;
};

export function Flashcard({ front, back, assetId, cardIndex, onReviewed }: FlashcardProps) {
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  
  const rotation = useSharedValue(0);

  const handleFlip = () => {
    rotation.value = withTiming(flipped ? 0 : 180, { duration: 400 });
    setFlipped((v) => !v);
  };

  const handleDifficulty = async (difficulty: CardDifficulty) => {
    try {
      await reviewCard(assetId, cardIndex, difficulty);
      setReviewed(true);
      if (onReviewed) {
        onReviewed(difficulty);
      }
    } catch (error) {
      console.error('Failed to review card:', error);
    }
  };

  const frontAnimatedStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(rotation.value, [0, 180], [0, 180]);
    const opacity = interpolate(rotation.value, [0, 90, 90, 180], [1, 0, 0, 0]);
    return {
      transform: [{ rotateY: `${rotateY}deg` }],
      opacity,
      backfaceVisibility: 'hidden' as const,
    };
  });

  const backAnimatedStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(rotation.value, [0, 180], [180, 360]);
    const opacity = interpolate(rotation.value, [0, 90, 90, 180], [0, 0, 1, 1]);
    return {
      transform: [{ rotateY: `${rotateY}deg` }],
      opacity,
      backfaceVisibility: 'hidden' as const,
    };
  });

  return (
    <View>
      <TouchableOpacity
        onPress={handleFlip}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={flipped ? 'Show front' : 'Show back'}
        disabled={reviewed}
        accessibilityState={{ disabled: reviewed }}
      >
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Animated.View style={[styles.cardFace, frontAnimatedStyle]}>
            <View style={[styles.labelPill, { backgroundColor: tokens.mintSoft }]}>
              <Text style={[styles.labelText, { color: tokens.mint }]}>Question</Text>
            </View>
            <View style={styles.content}>
              <Text style={[styles.text, { color: tokens.ink }]}>{front}</Text>
            </View>
            <Text style={[styles.hint, { color: tokens.inkMuted }]}>Tap to flip</Text>
          </Animated.View>
          
          <Animated.View style={[styles.cardFace, styles.cardBack, backAnimatedStyle]}>
            <View style={[styles.labelPill, { backgroundColor: tokens.mintSoft }]}>
              <Text style={[styles.labelText, { color: tokens.mint }]}>Answer</Text>
            </View>
            <View style={styles.content}>
              <Text style={[styles.text, { color: tokens.ink }]}>{back}</Text>
            </View>
            {!reviewed && <Text style={[styles.hint, { color: tokens.inkMuted }]}>How difficult?</Text>}
          </Animated.View>
        </View>
      </TouchableOpacity>

      {flipped && !reviewed && (
        <View style={styles.difficultyButtons}>
          <DifficultyButton
            label="Again"
            icon="refresh-outline"
            color={tokens.signal}
            onPress={() => handleDifficulty('again')}
            tokens={tokens}
          />
          <DifficultyButton
            label="Hard"
            icon="remove-circle-outline"
            color="#FF9500"
            onPress={() => handleDifficulty('hard')}
            tokens={tokens}
          />
          <DifficultyButton
            label="Good"
            icon="checkmark-circle-outline"
            color="#34C759"
            onPress={() => handleDifficulty('medium')}
            tokens={tokens}
          />
          <DifficultyButton
            label="Easy"
            icon="flash-outline"
            color={tokens.mint}
            onPress={() => handleDifficulty('easy')}
            tokens={tokens}
          />
        </View>
      )}

      {reviewed && (
        <View style={[styles.reviewedBadge, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}>
          <Ionicons name="checkmark-circle" size={16} color={tokens.mint} />
          <Text style={[styles.reviewedText, { color: tokens.mint }]}>Reviewed</Text>
        </View>
      )}
    </View>
  );
}

function DifficultyButton({ 
  label, 
  icon, 
  color, 
  onPress, 
  tokens 
}: { 
  label: string; 
  icon: keyof typeof Ionicons.glyphMap; 
  color: string; 
  onPress: () => void; 
  tokens: any;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.difficultyBtn, { borderColor: color }]}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Mark as ${label.toLowerCase()}`}
    >
      <Ionicons name={icon} size={18} color={color} />
      <Text style={[styles.difficultyText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 160,
    overflow: 'hidden',
    position: 'relative',
  },
  cardFace: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    padding: 20,
    justifyContent: 'center',
    gap: 12,
  },
  cardBack: {
    top: 0,
    left: 0,
  },
  labelPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  labelText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  content: {
    gap: 8,
    flex: 1,
  },
  text: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: 'normal',
  },
  hint: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },
  difficultyButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  difficultyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  difficultyText: {
    fontSize: 12,
    fontWeight: '600',
  },
  reviewedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
  },
  reviewedText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
