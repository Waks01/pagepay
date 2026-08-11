import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  toggleWorkLike, fetchWorkSocial, fetchWorkComments, postWorkComment,
  toggleCommentLike, logWorkShare,
} from '../api';

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
    onSuccess: () => {
      // Invalidate both the thread and the social aggregate so the
      // comment count on the card updates.
      qc.invalidateQueries({ queryKey: ['works', workId, 'comments'] });
      qc.invalidateQueries({ queryKey: ['works', workId, 'social'] });
    },
  });
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
