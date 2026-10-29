/**
 * Confetti burst. Static version: shows 18 pieces at computed positions
 * without animation, then calls onComplete after a short delay.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

const COLORS = [
  '#0E7C66',
  '#34C39B',
  '#E6F1ED',
  '#C2410C',
  '#FDEFE7',
  '#0B5C4B',
];

const PIECE_COUNT = 18;
const RENDER_MS = 1800;

type Origin = { x: number; y: number };

type Piece = {
  dx: number;
  dy: number;
  rot: number;
  color: string;
  startX: number;
  startY: number;
};

type ConfettiBurstProps = {
  origin: Origin | null;
  onComplete: () => void;
};

export function ConfettiBurst({ origin, onComplete }: ConfettiBurstProps) {
  const [pieces, setPieces] = useState<Piece[] | null>(null);

  useEffect(() => {
    if (!origin) {
      setPieces(null);
      return;
    }
    const next: Piece[] = Array.from({ length: PIECE_COUNT }, (_, i) => {
      const angle = (Math.PI * 2 * i) / PIECE_COUNT;
      const dist = 120 + Math.random() * 100;
      return {
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist + 200,
        rot: Math.random() * 720 - 360,
        color: COLORS[i % COLORS.length],
        startX: origin.x,
        startY: origin.y,
      };
    });
    setPieces(next);

    const t = setTimeout(onComplete, RENDER_MS);
    return () => clearTimeout(t);
  }, [origin, onComplete]);

  if (!pieces) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((p, i) => (
        <View
          key={i}
          style={[
            styles.piece,
            {
              left: p.startX - 4,
              top: p.startY - 6,
              backgroundColor: p.color,
              transform: [
                { translateX: p.dx },
                { translateY: p.dy },
                { rotate: `${p.rot}deg` },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: {
    position: 'absolute',
    width: 8,
    height: 12,
    borderRadius: 1.5,
  },
});
