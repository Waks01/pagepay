import Constants from 'expo-constants';
import { useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { apiFetch } from '@/src/shared/api/client';

type AboutModalProps = {
  visible: boolean;
  onClose: () => void;
};

type LegalDocument = {
  slug: string;
  title: string;
  content: string;
  updated_at: string;
};

/**
 * About modal with Terms of Service and Privacy Policy
 */
export function AboutModal({ visible, onClose }: AboutModalProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const [activeDoc, setActiveDoc] = useState<'terms' | 'privacy' | null>(null);

  const version =
    (Constants.expoConfig?.version as string | undefined) ||
    ((Constants.manifest as { version?: string } | undefined)?.version as string | undefined) ||
    '1.0.0';
  const platformLabel =
    Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : Platform.OS;

  // Fetch legal documents
  const termsQuery = useQuery({
    queryKey: ['legal', 'terms'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/legal/terms');
      if (!res.ok) throw new Error('Failed to load Terms of Service');
      return (await res.json()) as LegalDocument;
    },
    enabled: activeDoc === 'terms',
  });

  const privacyQuery = useQuery({
    queryKey: ['legal', 'privacy'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/legal/privacy');
      if (!res.ok) throw new Error('Failed to load Privacy Policy');
      return (await res.json()) as LegalDocument;
    },
    enabled: activeDoc === 'privacy',
  });

  const handleOpenTerms = () => setActiveDoc('terms');
  const handleOpenPrivacy = () => setActiveDoc('privacy');
  const handleBackToAbout = () => setActiveDoc(null);

  // Show legal document if selected
  if (activeDoc) {
    const query = activeDoc === 'terms' ? termsQuery : privacyQuery;
    const title = activeDoc === 'terms' ? 'Terms of Service' : 'Privacy Policy';

    return (
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={onClose}
      >
        <View style={styles.overlay}>
          <View style={[styles.fullSheet, { backgroundColor: tokens.card }]}>
            {/* Header */}
            <View style={[styles.headerRow, { borderBottomColor: tokens.border }]}>
              <Pressable
                onPress={handleBackToAbout}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Back"
                style={styles.backButton}
              >
                <Ionicons name="chevron-back" size={24} color={tokens.mint} />
                <Text style={[styles.backText, { color: tokens.mint }]}>Back</Text>
              </Pressable>
              <Pressable
                onPress={onClose}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Text style={[styles.close, { color: tokens.inkMuted }]}>Done</Text>
              </Pressable>
            </View>

            {/* Content */}
            {query.isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={tokens.mint} />
                <Text style={[styles.loadingText, { color: tokens.inkMuted }]}>
                  Loading {title}...
                </Text>
              </View>
            ) : query.error ? (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle-outline" size={48} color={tokens.signal} />
                <Text style={[styles.errorTitle, { color: tokens.ink }]}>
                  Failed to load {title}
                </Text>
                <Text style={[styles.errorText, { color: tokens.inkMuted }]}>
                  Please check your connection and try again.
                </Text>
                <Pressable
                  onPress={() => query.refetch()}
                  style={[styles.retryButton, { backgroundColor: tokens.mint }]}
                >
                  <Text style={[styles.retryText, { color: tokens.mintText }]}>Retry</Text>
                </Pressable>
              </View>
            ) : (
              <ScrollView
                style={styles.legalScroll}
                contentContainerStyle={styles.legalContent}
              >
                <Text style={[styles.legalTitle, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
                  {query.data?.title}
                </Text>
                <Text style={[styles.legalBody, { color: tokens.inkMuted }]}>
                  {query.data?.content}
                </Text>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    );
  }

  // Show about screen
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
              About PagePay
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={[styles.close, { color: tokens.inkMuted }]}>Done</Text>
            </Pressable>
          </View>

          <View style={styles.body}>
            <View style={styles.brandRow}>
              <View>
                <Text style={[styles.wordmark, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
                  PagePay
                </Text>
              </View>
              <Text style={[styles.tagline, { color: tokens.mint }]}>Read. Earn. Repeat.</Text>
            </View>

            <Text style={[styles.mission, { color: tokens.inkMuted }]}>
              PagePay turns the time you spend reading into points you can
              actually spend. Built for Nigeria first — Nigerian books,
              Nigerian banks, and rewards that actually feel like money.
            </Text>

            <View style={[styles.metaRow, { borderTopColor: tokens.border, borderBottomColor: tokens.border }]}>
              <Meta label="Version" value={version} tokens={tokens} />
              <View style={[styles.divider, { backgroundColor: tokens.border }]} />
              <Meta label="Platform" value={platformLabel} tokens={tokens} />
            </View>

            <View style={styles.legalLinks}>
              <Pressable
                onPress={handleOpenTerms}
                style={[styles.legalButton, { borderColor: tokens.border }]}
                accessibilityRole="button"
              >
                <Ionicons name="document-text-outline" size={20} color={tokens.mint} />
                <Text style={[styles.legalButtonText, { color: tokens.ink }]}>
                  Terms of Service
                </Text>
                <Ionicons name="chevron-forward" size={20} color={tokens.inkMuted} />
              </Pressable>

              <Pressable
                onPress={handleOpenPrivacy}
                style={[styles.legalButton, { borderColor: tokens.border }]}
                accessibilityRole="button"
              >
                <Ionicons name="shield-checkmark-outline" size={20} color={tokens.mint} />
                <Text style={[styles.legalButtonText, { color: tokens.ink }]}>
                  Privacy Policy
                </Text>
                <Ionicons name="chevron-forward" size={20} color={tokens.inkMuted} />
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Meta({
  label,
  value,
  tokens,
}: {
  label: string;
  value: string;
  tokens: (typeof PagePay)['light'] | (typeof PagePay)['dark'];
}) {
  return (
    <View style={styles.meta}>
      <Text style={[styles.metaLabel, { color: tokens.inkMuted }]}>{label}</Text>
      <Text style={[styles.metaValue, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingTop: 18,
    paddingHorizontal: 20,
    paddingBottom: 32,
    maxHeight: '80%',
  },
  fullSheet: {
    flex: 1,
    paddingTop: 50,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backText: {
    fontSize: 16,
    fontWeight: '600',
  },
  title: {
    fontSize: 20,
    letterSpacing: 0.1,
  },
  close: {
    fontSize: 15,
    fontWeight: '600',
  },
  body: {
    gap: 18,
  },
  brandRow: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  wordmark: {
    fontSize: 28,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  tagline: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.4,
  },
  mission: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  meta: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  metaLabel: {
    fontSize: 11,
    letterSpacing: 1.0,
    fontWeight: '600',
  },
  metaValue: {
    fontSize: 16,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 32,
  },
  legalLinks: {
    gap: 10,
    paddingTop: 4,
  },
  legalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  legalButtonText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  // Legal document view
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 40,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  retryButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginTop: 8,
  },
  retryText: {
    fontSize: 15,
    fontWeight: '600',
  },
  legalScroll: {
    flex: 1,
  },
  legalContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  legalTitle: {
    fontSize: 24,
    letterSpacing: -0.5,
    marginBottom: 20,
  },
  legalBody: {
    fontSize: 14,
    lineHeight: 22,
    letterSpacing: 0.2,
  },
});
