import { apiFetch } from '@/src/shared/api/client';

export type MaterialSummary = {
  id: number;
  title: string;
  exam_type: string | null;
  asset_types: string[];
  created_at: string;
};

export type AssetInfo = {
  id: number;
  type: string;
  points_to_unlock: number;
  created_at: string;
};

export type MaterialDetail = {
  id: number;
  title: string;
  exam_type: string | null;
  parsed_structure: Record<string, unknown> | null;
  assets: AssetInfo[];
  created_at: string;
};

export type SowUploadResponse = {
  material_id: number;
  title: string;
  exam_type: string | null;
  parsed_structure: Record<string, unknown> | null;
};

export type GenerateAssetRequest = {
  material_id: number;
  asset_type: 'mcq' | 'flashcard' | 'essay';
  count?: number;
};

export type GenerateAssetResponse = {
  assets: unknown[];
};

export type ChatRequest = {
  material_id: number;
  message: string;
};

export type UnlockRequest = {
  asset_id: number;
  method: 'points' | 'ad';
};

export type UnlockResponse = {
  unlocked: boolean;
  content: unknown | null;
  new_balance: number;
  method: string;
  points_spent: number;
};

export async function uploadSowText(text: string, exam_type?: string | null): Promise<SowUploadResponse> {
  const res = await apiFetch('/api/v1/study/sow/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, exam_type }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Upload failed');
  }
  return res.json();
}

export async function uploadSowImage(file: { uri: string; name: string; type: string }, exam_type?: string | null): Promise<SowUploadResponse> {
  const form = new FormData();
  form.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.type || 'image/jpeg',
  } as any);
  if (exam_type) {
    form.append('exam_type', exam_type);
  }

  const res = await apiFetch('/api/v1/study/sow/upload-image', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Image upload failed');
  }
  return res.json();
}

export async function uploadSowDocument(file: { uri: string; name: string; type: string }, exam_type?: string | null): Promise<SowUploadResponse> {
  const form = new FormData();
  form.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.type || 'application/pdf',
  } as any);
  if (exam_type) {
    form.append('exam_type', exam_type);
  }

  const res = await apiFetch('/api/v1/study/sow/upload-document', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Document upload failed');
  }
  return res.json();
}

export async function fetchMaterials(): Promise<MaterialSummary[]> {
  const res = await apiFetch('/api/v1/study/materials');
  if (!res.ok) throw new Error('Failed to load materials');
  return res.json();
}

export async function fetchMaterial(id: number): Promise<MaterialDetail> {
  const res = await apiFetch(`/api/v1/study/materials/${id}`);
  if (!res.ok) throw new Error('Failed to load material');
  return res.json();
}

export async function generateAsset(payload: GenerateAssetRequest): Promise<GenerateAssetResponse> {
  const res = await apiFetch('/api/v1/study/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Generation failed');
  }
  return res.json();
}

export async function unlockAsset(payload: UnlockRequest): Promise<UnlockResponse> {
  const res = await apiFetch('/api/v1/study/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Unlock failed');
  }
  return res.json();
}

export type QuizCompleteRequest = {
  asset_id: number;
  score: number;
};

export type QuizCompleteResponse = {
  bonus_awarded: boolean;
  bonus_points: number;
  new_balance: number;
  message: string;
};

export type AiRouteRequest = {
  prompt: string;
  task_type?: 'heavy' | 'fast' | 'chat';
  max_tokens?: number;
};

export type AiRouteResponse = {
  response: string;
  provider: string;
  model: string;
};

export async function claimQuizBonus(payload: QuizCompleteRequest): Promise<QuizCompleteResponse> {
  const res = await apiFetch('/api/v1/study/quiz/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Bonus claim failed');
  }
  return res.json();
}

export async function routeAi(payload: AiRouteRequest): Promise<AiRouteResponse> {
  const res = await apiFetch('/api/v1/ai/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'AI route failed');
  }
  return res.json();
}

export async function sendChatMessage(payload: ChatRequest): Promise<string> {
  const res = await apiFetch('/api/v1/study/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Chat failed');
  }
  return res.text();
}
