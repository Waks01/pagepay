import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  toggleWorkLike, fetchWorkSocial, fetchWorkComments, postWorkComment,
  toggleCommentLike, logWorkShare,
} from '../api';
import type { WorkCommentItem, WorkCommentFeedResponse } from '../api';

// TanStack Query keys for work-level social. The key shape is the
// contract any consumer uses to invalidate after a mutation:
//   - ['works', workId, 'social'] — like/comment/share aggregates
//   - ['works', workId, 'comments'] — comment thread
//   - ['works', commentId, 'comment-like'] — per-comment like state

export function useWorkSocial(workId: number) {
  return useQuery({
    queryKey: ['works', workId, 'social'],
    queryFn: () => fetchWorkSocial(workId),
    enabled: Number.isFinite(workId) && workId > 0,
  });
}

export function useWorkComments(
  workId: number,
  params?: { limit?: number; offset?: number },
) {
  return useQuery({
    queryKey: ['works', workId, 'comments', params],
    queryFn: () => fetchWorkComments(workId, params),
    enabled: Number.isFinite(workId) && workId > 0,
  });
}

export function useToggleWorkLike(workId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => toggleWorkLike(workId),
    // Optimistic update: flip the like state and bump the count
    // before the server confirms. On error, the catch handler in
    // the consumer can roll back, but the simpler pattern (which
    // we use here) is to refetch on settle.
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['works', workId, 'social'] });
      const prev = qc.getQueryData(['works', workId, 'social']);
      qc.setQueryData(['works', workId, 'social'], (old: any) => {
        if (!old) return old;
        const nextIsLiked = !old.is_liked;
        return {
          ...old,
          is_liked: nextIsLiked,
          likes_count: Math.max(0, old.likes_count + (nextIsLiked ? 1 : -1)),
        };
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['works', workId, 'social'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['works', workId, 'social'] });
    },
  });
}

export function usePostWorkComment(workId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { body: string; parentCommentId?: number }) =>
      postWorkComment(workId, payload.body, payload.parentCommentId),
    onMutate: async (payload) => {
      // Cancel any in-flight refetch so our optimistic row isn't
      // overwritten before the server confirms.
      await qc.cancelQueries({ queryKey: ['works', workId, 'comments'] });
      const prev = qc.getQueryData<WorkCommentFeedResponse>([
        'works',
        workId,
        'comments',
      ]);
      // Build a placeholder comment using the user's local clock so the
      // freshly-posted row shows "just now" instead of the placeholder
      // timestamp the server sometimes returns first
      // (the server's `created_at` may be a stale fallback until the row
      // is materialized on a refresh). The post-mutation refetch replaces
      // this with the authoritative server value.
      const optimisticComment: WorkCommentItem = {
        id: -Date.now(),
        user_id: -1,
        work_id: workId,
        body: payload.body,
        parent_comment_id: payload.parentCommentId ?? null,
        status: 'visible',
        created_at: new Date().toISOString(),
        author_name: null,
        likes_count: 0,
        is_liked: false,
        replies: 0,
      };
      qc.setQueryData<WorkCommentFeedResponse>(
        ['works', workId, 'comments'],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            total: old.total + 1,
            comments: [optimisticComment, ...old.comments],
          };
        },
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(['works', workId, 'comments'], ctx.prev);
      }
    },
    onSuccess: (serverComment) => {
      // Replace the optimistic placeholder with the authoritative server
      // row. If the server provided a real `created_at` we keep it and
      // re-format via `relativeTime` on the next render — but if the
      // server returned a placeholder timestamp (e.g. 1h ago on a fresh
      // post), we override with the client clock so the user sees the
      // accurate local time.
      qc.setQueryData<WorkCommentFeedResponse>(
        ['works', workId, 'comments'],
        (old) => {
          if (!old) return old;
          const merged: WorkCommentItem = {
            ...serverComment,
            // If the server timestamp is suspiciously in the past (more
            // than a few seconds old for a freshly-created row) or in
            // the future, rewrite it to the client's local time so the
            // user sees a sensible relative timestamp.
            created_at: shouldUseClientTimestamp(serverComment.created_at)
              ? new Date().toISOString()
              : serverComment.created_at,
          };
          return {
            ...old,
            comments: old.comments.map((c) =>
              c.id < 0 ? merged : c,
            ),
          };
        },
      );
    },
    onSettled: () => {
      // Background refetch so the thread + social aggregates settle to
      // the server's authoritative state.
      qc.invalidateQueries({ queryKey: ['works', workId, 'comments'] });
      qc.invalidateQueries({ queryKey: ['works', workId, 'social'] });
    },
  });
}

function shouldUseClientTimestamp(serverIso: string): boolean {
  // Treat the server's `created_at` as authoritative if it parses, is
  // within the last 5 minutes (a freshly-created row should be near
  // "just now"), and isn't in the future.
  const t = new Date(serverIso).getTime();
  if (Number.isNaN(t)) return true;
  const now = Date.now();
  const diffMs = now - t;
  // More than 5 minutes old for a brand-new comment is suspicious —
  // the server is returning a placeholder.
  if (diffMs > 5 * 60 * 1000) return true;
  // In the future (server clock skew) — also a placeholder.
  if (diffMs < -60 * 1000) return true;
  return false;
}

export function useToggleCommentLike(workId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: number) => toggleCommentLike(commentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['works', workId, 'comments'] });
    },
  });
}

export function useLogWorkShare(workId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (platform: string) => logWorkShare(workId, platform),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['works', workId, 'social'] });
    },
  });
}
