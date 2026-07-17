import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchMaterials, fetchMaterial, generateAsset, unlockAsset, uploadSowText, uploadSowImage, uploadSowDocument, claimQuizBonus, routeAi } from '../api';

export function useMaterials() {
  return useQuery({
    queryKey: ['study', 'materials'],
    queryFn: fetchMaterials,
  });
}

export function useMaterial(id: number) {
  return useQuery({
    queryKey: ['study', 'material', id],
    queryFn: () => fetchMaterial(id),
    enabled: id > 0,
  });
}

export function useUploadSow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ text, exam_type }: { text: string; exam_type?: string | null }) => uploadSowText(text, exam_type),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['study', 'materials'] });
    },
  });
}

export function useUploadSowImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { file: { uri: string; name: string; type: string }; exam_type?: string | null }) =>
      uploadSowImage(payload.file, payload.exam_type),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['study', 'materials'] });
    },
  });
}

export function useUploadSowDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { file: { uri: string; name: string; type: string }; exam_type?: string | null }) =>
      uploadSowDocument(payload.file, payload.exam_type),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['study', 'materials'] });
    },
  });
}

export function useGenerateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { material_id: number; asset_type: string; count?: number }) =>
      generateAsset({
        material_id: payload.material_id,
        asset_type: payload.asset_type as 'mcq' | 'flashcard' | 'essay',
        count: payload.count || 5,
      }),
  });
}

export function useUnlockAsset() {
  return useMutation({
    mutationFn: (payload: { asset_id: number; method: 'points' | 'ad' }) => unlockAsset(payload),
  });
}

export function useClaimQuizBonus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { asset_id: number; score: number }) => claimQuizBonus(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useAiRoute() {
  return useMutation({
    mutationFn: (payload: { prompt: string; task_type?: 'heavy' | 'fast' | 'chat'; max_tokens?: number }) => routeAi(payload),
  });
}
