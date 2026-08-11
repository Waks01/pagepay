import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchCommunityFeed, fetchStreak, generateReferralCode,
  getReferralStats, toggleCommunityLike, uploadCommunityNote, validateReferral,
} from '../api';

export function useCommunityFeed(params?: { course_code?: string; sort?: string; limit?: number; offset?: number }) {
  return useQuery({
    queryKey: ['community', 'feed', params],
    queryFn: () => fetchCommunityFeed(params),
  });
}

export function useUploadCommunityNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { title: string; content: string; course_code?: string; university?: string }) =>
      uploadCommunityNote(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['community', 'feed'] });
    },
  });
}

export function useToggleLike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: number) => toggleCommunityLike(noteId),
    onSuccess: (_, noteId) => {
      qc.invalidateQueries({ queryKey: ['community', 'feed'] });
      qc.invalidateQueries({ queryKey: ['community', 'note', noteId] });
    },
  });
}

export function useStreak() {
  return useQuery({
    queryKey: ['streak'],
    queryFn: fetchStreak,
    staleTime: 60_000,
  });
}

export function useGenerateReferral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => generateReferralCode(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['referral', 'stats'] });
    },
  });
}

export function useReferralStats() {
  return useQuery({
    queryKey: ['referral', 'stats'],
    queryFn: getReferralStats,
  });
}

export function useValidateReferral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => validateReferral(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['referral', 'stats'] });
    },
  });
}
