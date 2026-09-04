import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchMaterials,
  fetchMaterial,
  generateAsset,
  unlockAsset,
  uploadSowText,
  uploadSowImage,
  uploadSowDocument,
  claimQuizBonus,
  routeAi,
  generateExample,
  checkExampleAnswer,
  deleteMaterial,
  updateMaterial,
  type UploadProgressCallback,
} from '../api';
import { clearMaterialFileCache } from '../storage';

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
    mutationFn: (payload: {
      file: { uri: string; name: string; type: string };
      exam_type?: string | null;
      onProgress?: UploadProgressCallback;
    }) => uploadSowImage(payload.file, payload.exam_type, payload.onProgress),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['study', 'materials'] });
    },
  });
}

export function useUploadSowDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      file: { uri: string; name: string; type: string };
      exam_type?: string | null;
      onProgress?: UploadProgressCallback;
    }) => uploadSowDocument(payload.file, payload.exam_type, payload.onProgress),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['study', 'materials'] });
    },
  });
}

export function useDeleteMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (materialId: number) => {
      await deleteMaterial(materialId);
      await clearMaterialFileCache(materialId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['study', 'materials'] });
    },
  });
}

export function useUpdateMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ materialId, ...payload }: { materialId: number; title?: string; exam_type?: string | null }) => {
      const updated = await updateMaterial(materialId, payload);
      await clearMaterialFileCache(materialId);
      return updated;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['study', 'materials'] });
    },
  });
}

export function useGenerateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      material_id: number;
      asset_type: string;
      count?: number;
      topic?: string | null;
      mode?: 'topic' | 'all';
      difficulty?: 'easy' | 'medium' | 'hard';
      education_level?: 'primary' | 'secondary' | 'tertiary' | 'research';
    }) =>
      generateAsset({
        material_id: payload.material_id,
        asset_type: payload.asset_type as 'mcq' | 'flashcard' | 'essay' | 'diagram' | 'video',
        count: payload.count ?? (payload.mode === 'topic' ? 15 : 20),
        topic: payload.topic ?? null,
        mode: payload.mode ?? 'all',
        difficulty: payload.difficulty ?? 'medium',
        education_level: payload.education_level ?? 'secondary',
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

export function useGenerateExample() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      material_id: number;
      topic?: string | null;
      mode?: 'topic' | 'all';
      education_level?: 'primary' | 'secondary' | 'tertiary' | 'research';
      subject_hints?: string;
    }) =>
      generateExample({
        material_id: payload.material_id,
        topic: payload.topic ?? null,
        mode: payload.mode ?? 'all',
        education_level: payload.education_level ?? 'secondary',
        subject_hints: payload.subject_hints ?? 'general',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['study', 'materials'] });
    },
  });
}

export function useCheckExampleAnswer() {
  return useMutation({
    mutationFn: (payload: {
      material_id: number;
      example_id: number;
      step_index?: number | null;
      user_answer: string;
      user_attempt?: string | null;
    }) =>
      checkExampleAnswer({
        material_id: payload.material_id,
        example_id: payload.example_id,
        step_index: payload.step_index ?? null,
        user_answer: payload.user_answer,
        user_attempt: payload.user_attempt ?? null,
      }),
  });
}
