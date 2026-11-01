import { useState } from 'react';
import { StyleSheet, Pressable, Text, View, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type DiagramElement = {
  id: string;
  label: string;
  description: string;
  position: string;
};

type DiagramConnection = {
  from: string;
  to: string;
  label: string;
};

type DiagramContent = {
  title: string;
  description: string;
  elements: DiagramElement[];
  connections: DiagramConnection[];
  svg_hint: string;
};

type DiagramViewerProps = {
  content: DiagramContent;
};

const POSITION_MAP: Record<string, { top: number; left: number }> = {
  'top-left': { top: 10, left: 10 },
  'top-center': { top: 10, left: 40 },
  'top-right': { top: 10, left: 70 },
  'center-left': { top: 40, left: 10 },
  'center': { top: 40, left: 40 },
  'center-right': { top: 40, left: 70 },
  'bottom-left': { top: 70, left: 10 },
  'bottom-center': { top: 70, left: 40 },
  'bottom-right': { top: 70, left: 70 },
};

export function DiagramViewer({ content }: DiagramViewerProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const [showDescription, setShowDescription] = useState(false);

  return (
    <View style={[styles.container, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
      <View style={styles.header}>
        <Ionicons name="git-branch-outline" size={24} color={tokens.mint} />
        <Text style={[styles.title, { color: tokens.ink }]}>{content.title}</Text>
        <Pressable
          onPress={() => setShowDescription(!showDescription)}
          style={({ pressed }) => [styles.infoBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons
            name={showDescription ? 'information' : 'information-outline'}
            size={20}
            color={tokens.inkMuted}
          />
        </Pressable>
      </View>

      {showDescription && (
        <View style={[styles.descriptionBox, { backgroundColor: tokens.paper, borderColor: tokens.border }]}>
          <Text style={[styles.descriptionText, { color: tokens.ink }]}>
            {content.description}
          </Text>
        </View>
      )}

      <View style={[styles.diagramArea, { backgroundColor: tokens.paper }]}>
        {content.elements.map((element) => {
          const pos = POSITION_MAP[element.position] || POSITION_MAP['center'];
          return (
            <View
              key={element.id}
              style={[
                styles.element,
                {
                  top: `${pos.top}%`,
                  left: `${pos.left}%`,
                  backgroundColor: tokens.mint + '20',
                  borderColor: tokens.mint,
                },
              ]}
            >
              <View style={[styles.elementBadge, { backgroundColor: tokens.mint }]}>
                <Text style={[styles.elementId, { color: tokens.mintText }]}>{element.id}</Text>
              </View>
              <Text style={[styles.elementLabel, { color: tokens.ink }]}>{element.label}</Text>
              <Text style={[styles.elementDesc, { color: tokens.inkMuted }]}>
                {element.description}
              </Text>
            </View>
          );
        })}

        {content.connections.map((conn, idx) => {
          const fromEl = content.elements.find((e) => e.id === conn.from);
          const toEl = content.elements.find((e) => e.id === conn.to);
          if (!fromEl || !toEl) return null;

          const fromPos = POSITION_MAP[fromEl.position] || POSITION_MAP['center'];
          const toPos = POSITION_MAP[toEl.position] || POSITION_MAP['center'];

          return (
            <View
              key={idx}
              style={[
                styles.connection,
                {
                  top: `${(fromPos.top + toPos.top) / 2}%`,
                  left: `${(fromPos.left + toPos.left) / 2}%`,
                },
              ]}
            >
              <Ionicons name="arrow-forward" size={16} color={tokens.mint} />
              <Text style={[styles.connectionLabel, { color: tokens.inkMuted }]}>
                {conn.label}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={[styles.svgHint, { backgroundColor: tokens.ink + '08', borderColor: tokens.border }]}>
        <Ionicons name="code-slash-outline" size={16} color={tokens.inkMuted} />
        <Text style={[styles.svgHintText, { color: tokens.inkMuted }]} numberOfLines={2}>
          {content.svg_hint}
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
  infoBtn: {
    padding: 4,
  },
  descriptionBox: {
    marginHorizontal: 16,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  descriptionText: {
    fontSize: 14,
    lineHeight: 20,
  },
  diagramArea: {
    marginHorizontal: 16,
    height: 300,
    borderRadius: 12,
    position: 'relative',
  },
  element: {
    position: 'absolute',
    width: '25%',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    gap: 4,
    transform: [{ translateX: -12 }, { translateY: -12 }],
  },
  elementBadge: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  elementId: {
    fontSize: 11,
    fontWeight: '700',
  },
  elementLabel: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  elementDesc: {
    fontSize: 10,
    lineHeight: 14,
  },
  connection: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    transform: [{ translateX: -16 }, { translateY: -8 }],
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  connectionLabel: {
    fontSize: 10,
    maxWidth: 100,
  },
  svgHint: {
    marginHorizontal: 16,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  svgHintText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },
});
