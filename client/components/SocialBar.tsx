/**
 * SocialBar — the 3-button (like / comment / share) strip that sits
 * at the bottom of a content card or book detail screen. Theme-token
 * driven so it renders correctly in both light and dark mode.
 *
 * Props:
 *   workId — the parent work id (NOT a slice id) that the social
 *     actions attach to. The backend's WorkLike / WorkComment /
 *     WorkShare tables all key on the work id.
 *   initialLikes / initialComments — the starting counts; the
 *     component manages these locally as the user interacts so the
 *     heart fill + count update instantly (optimistic).
 *   onCommentPress — the parent screen handles opening the comment
 *     sheet/screen when this fires. We don't navigate from inside
 *     the bar because the bar can appear in many contexts (cards
 *     on Home, book detail, reader) with different navigation
 *     targets.
 *   compact — when true, renders the bare 3-icon row without the
 *     count text. Used inside dense lists where space is tight.
 *
 * The like button is the only one that mutates server state on tap;
 * comment opens a screen, share opens the native sheet. The Share
 * button here is a "tapped" indicator that the parent uses to
 * trigger its own share sheet — this component does NOT call
 * React Native's Share.share() itself, so the parent stays in
 * control of what link is shared.
 */
import { Pressable, StyleSheet, Text, View, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import {
  useToggleWorkLike, useLogWorkShare,
} from '@/src/features/works/hooks/use-works';

type SocialBarProps = {
  workId: number;
  initialLikes: number;
  initialComments: number;
  isInitiallyLiked?: boolean;
  onCommentPress?: () => void;
  onSharePress?: () => void;
  compact?: boolean;
};

function getTokens(scheme: 'light' | 'dark') {
  return PagePay[scheme];
}

export function SocialBar({
  workId,
  initialLikes,
  initialComments,
  isInitiallyLiked = false,
  onCommentPress,
  onSharePress,
  compact = false,
}: SocialBarProps) {
  const scheme = useEffectiveScheme();
  const tokens = getTokens(scheme);
  const styles = makeStyles(tokens);

  // We track local state for instant feedback; the TanStack mutation
  // re-syncs on settle so the count converges to the server's truth.
  const toggle = useToggleWorkLike(workId);
  const logShare = useLogWorkShare(workId);

  // Use the optimistic mutation's pending data when available, else
  // the initial values. Reading the cache via useQueryClient would be
  // cleaner, but local state keeps the component self-contained.
  const liked = (toggle.data?.liked ?? isInitiallyLiked);
  const likesCount = (toggle.data?.likes_count ?? initialLikes);

  const handleLike = () => {
    toggle.mutate(undefined, {
      onError: () => Alert.alert('Could not save like. Try again.'),
    });
  };

  const handleShare = () => {
    // Log the share event before opening the sheet. The platform arg
    // is best-effort ('other' if the parent doesn't tell us). The
    // parent will overwrite with the specific platform after the
    // sheet closes.
    logShare.mutate('other', {
      onError: () => { /* silent — analytics is best-effort */ },
    });
    onSharePress?.();
  };

  return (
    <View style={styles.bar}>
      <Pressable
        style={styles.btn}
        onPress={handleLike}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={liked ? 'Unlike' : 'Like'}
        accessibilityState={{ selected: liked }}
      >
        <Ionicons
          name={liked ? 'heart' : 'heart-outline'}
          size={compact ? 16 : 18}
          color={liked ? tokens.signal : tokens.inkMuted}
        />
        {!compact && <Text style={[styles.count, liked && { color: tokens.signal }]}>{likesCount}</Text>}
      </Pressable>
      <View style={styles.divider} />
      <Pressable
        style={styles.btn}
        onPress={onCommentPress}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="View comments"
      >
        <Ionicons name="chatbubble-outline" size={compact ? 16 : 18} color={tokens.inkMuted} />
        {!compact && <Text style={styles.count}>{initialComments}</Text>}
      </Pressable>
      <View style={styles.divider} />
      <Pressable
        style={styles.btn}
        onPress={handleShare}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Share"
      >
        <Ionicons name="share-outline" size={compact ? 16 : 18} color={tokens.inkMuted} />
        {!compact && <Text style={styles.count}>{'Share'}</Text>}
      </Pressable>
    </View>
  );
}

function makeStyles(tokens: ReturnType<typeof getTokens>) {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      borderTopWidth: 1,
      borderTopColor: tokens.border,
      marginTop: 8,
      paddingTop: 8,
    },
    btn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minHeight: 44,
      paddingVertical: 4,
    },
    count: {
      fontSize: 12,
      color: tokens.inkMuted,
      fontWeight: '500',
    },
    divider: {
      width: 1,
      height: 20,
      backgroundColor: tokens.border,
    },
  });
}
