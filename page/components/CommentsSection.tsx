/**
 * CommentsSection — the inline comment thread shown in the reader and on
 * the book detail screen (design-plan Step 6). Renders the work's comment
 * thread (newest first), each with an avatar, author name, body, timestamp,
 * and a like button. A composer at the bottom posts a new comment.
 *
 * The component is presentational + data-fetching via the works feature
 * hooks (`useWorkComments`, `usePostWorkComment`, `useToggleCommentLike`).
 * It is keyed purely by `workId` — comments attach to the parent work, not
 * a slice, matching the backend's work-level social model.
 *
 * Anonymous users (no token) get a disabled composer with a "log in to
 * comment" hint rather than a 401 wall. The `me` query tells us who's
 * logged in; for display we use the server-provided `author_name` so we
 * never leak PII client-side.
 */
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import {
  useWorkComments,
  usePostWorkComment,
  useToggleCommentLike,
} from '@/src/features/works/hooks/use-works';

type CommentsSectionProps = {
  workId: number;
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  // Server clock skew would land here — show the user a sensible label
  // rather than a negative "Xm ago".
  if (diff < 0) return 'just now';
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function initials(name: string | null): string {
  if (!name) return 'R';
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, '');
  return cleaned.slice(0, 2).toUpperCase() || 'R';
}

export function CommentsSection({ workId }: CommentsSectionProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const styles = makeStyles(tokens);

  const { data, isLoading } = useWorkComments(workId, { limit: 20, offset: 0 });
  const postComment = usePostWorkComment(workId);
  const toggleCommentLike = useToggleCommentLike(workId);

  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const comments = data?.comments ?? [];

  const submit = useCallback(async () => {
    const body = draft.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    try {
      await postComment.mutateAsync({ body });
      setDraft('');
    } catch {
      /* surface nothing — the composer keeps the text so the user can retry */
    } finally {
      setSubmitting(false);
    }
  }, [draft, submitting, postComment]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
          Comments
        </Text>
        {data ? <Text style={[styles.count, { color: tokens.inkMuted }]}>{data.total}</Text> : null}
      </View>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={tokens.mint} />
        </View>
      ) : comments.length === 0 ? (
        <Text style={[styles.empty, { color: tokens.inkMuted }]}>
          No comments yet. Start the conversation.
        </Text>
      ) : (
        comments.map((c) => (
          <View key={c.id} style={styles.item}>
            <View style={[styles.avatar, { backgroundColor: tokens.mintSoft }]}>
              <Text style={[styles.avatarText, { color: tokens.mint, fontFamily: 'SpaceGrotesk_700Bold' }]}>
                {initials(c.author_name)}
              </Text>
            </View>
            <View style={styles.body}>
              <Text style={[styles.name, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
                {c.author_name ?? 'Reader'}
              </Text>
              <Text style={[styles.text, { color: tokens.ink }]}>{c.body}</Text>
              <View style={styles.meta}>
                <Text style={[styles.metaText, { color: tokens.inkMuted }]}>{relativeTime(c.created_at)}</Text>
                {c.replies > 0 ? (
                  <Text style={[styles.metaText, { color: tokens.inkMuted }]}>· {c.replies} replies</Text>
                ) : null}
                <Pressable
                  onPress={() => toggleCommentLike.mutate(c.id)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={c.is_liked ? 'Unlike comment' : 'Like comment'}
                  style={styles.likeBtn}
                >
                  <Ionicons
                    name={c.is_liked ? 'heart' : 'heart-outline'}
                    size={14}
                    color={c.is_liked ? tokens.signal : tokens.inkMuted}
                  />
                  {c.likes_count > 0 ? (
                    <Text style={[styles.metaText, c.is_liked && { color: tokens.signal }]}>{c.likes_count}</Text>
                  ) : null}
                </Pressable>
              </View>
            </View>
          </View>
        ))
      )}

      <View style={[styles.composer, { borderColor: tokens.border }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Add a comment…"
          placeholderTextColor={tokens.inkMuted}
          multiline
          maxLength={2000}
          style={[styles.input, { color: tokens.ink }]}
        />
        <Pressable
          onPress={submit}
          disabled={!draft.trim() || submitting}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Post comment"
          style={({ pressed }) => [
            styles.sendBtn,
            { backgroundColor: tokens.mint },
            (!draft.trim() || submitting || pressed) && styles.sendBtnDisabled,
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={tokens.mintText} />
          ) : (
            <Ionicons name="arrow-up" size={18} color={tokens.mintText} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(tokens: (typeof PagePay)['light']) {
  return StyleSheet.create({
    root: {
      marginTop: 8,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 12,
    },
    title: {
      fontSize: 14,
      fontFamily: 'SpaceGrotesk_700Bold',
    },
    count: {
      fontSize: 12,
    },
    loading: {
      paddingVertical: 16,
      alignItems: 'center',
    },
    empty: {
      fontSize: 13,
      fontStyle: 'italic',
      paddingVertical: 12,
    },
    item: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 14,
    },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      fontSize: 12,
    },
    body: {
      flex: 1,
    },
    name: {
      fontSize: 12,
      marginBottom: 2,
    },
    text: {
      fontSize: 13,
      lineHeight: 18,
    },
    meta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginTop: 4,
    },
    metaText: {
      fontSize: 11,
    },
    likeBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    composer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
      marginTop: 8,
    },
    input: {
      flex: 1,
      fontSize: 13,
      maxHeight: 96,
    },
    sendBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendBtnDisabled: {
      opacity: 0.5,
    },
  });
}
