import { apiFetch, apiUpload } from "@/src/shared/api/client";
import { clearMaterialFileCache } from "./storage";

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

/**
 * Response from the async SOW upload endpoints (image / document).
 * The endpoint reads + validates the file synchronously, inserts a
 * `sow_upload_jobs` row, fires a background worker, and returns the
 * job id immediately. The client then polls
 * `GET /api/v1/study/sow/jobs/{job_id}` to drive its progress bar
 * through the 80→100 window and learn the resulting `material_id`.
 */
export type SowUploadJobAccepted = {
  job_id: string;
  status: "queued" | "processing" | "completed" | "failed";
};

export type SowJobStatus = {
  job_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  material_id?: number | null;
  error?: string | null;
  updated_at: string;
};

export type GenerateAssetRequest = {
  material_id: number;
  asset_type: "mcq" | "flashcard" | "essay" | "diagram" | "video" | "example";
  count?: number;
  topic?: string | null;
  mode?: "topic" | "all";
  difficulty?: "easy" | "medium" | "hard";
  education_level?: "primary" | "secondary" | "tertiary" | "research";
};

export type ExampleGenerateRequest = {
  material_id: number;
  topic?: string | null;
  mode?: "topic" | "all";
  education_level?: "primary" | "secondary" | "tertiary" | "research";
  subject_hints?: string;
};

export type ExampleCheckRequest = {
  material_id: number;
  example_id: number;
  step_index?: number | null;
  user_answer: string;
  user_attempt?: string | null;
};

export type ExampleCheckResponse = {
  correct: boolean;
  feedback: string;
  hint: string | null;
  next_step_instruction: string | null;
  show_answer: boolean;
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
  method: "points" | "ad";
};

export type UnlockResponse = {
  unlocked: boolean;
  content: unknown | null;
  new_balance: number;
  method: string;
  points_spent: number;
};

export async function uploadSowText(
  text: string,
  exam_type?: string | null,
): Promise<SowUploadResponse> {
  const res = await apiFetch("/api/v1/study/sow/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, exam_type }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
}

export type UploadProgressCallback = (loaded: number, total: number) => void;

export async function uploadSowImage(
  file: { uri: string; name: string; type: string },
  exam_type?: string | null,
  onProgress?: UploadProgressCallback,
): Promise<SowUploadJobAccepted> {
  console.log("[study/api] uploadSowImage START", { file, exam_type });
  const form = new FormData();
  form.append("file", { uri: file.uri, name: file.name, type: file.type || "application/octet-stream" } as any);
  if (exam_type) {
    form.append("exam_type", exam_type);
  }

  const res = await apiUpload(
    "/api/v1/study/sow/upload-image",
    form,
    onProgress ? { onProgress } : undefined,
  );
  console.log("[study/api] uploadSowImage RESPONSE", { status: res.status, statusText: res.statusText });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    console.log("[study/api] uploadSowImage ERROR", err);
    throw new Error(err.detail || "Image upload failed");
  }
  const data = await res.json();
  console.log("[study/api] uploadSowImage SUCCESS", data);
  return data;
}

export async function uploadSowDocument(
  file: { uri: string; name: string; type: string },
  exam_type?: string | null,
  onProgress?: UploadProgressCallback,
): Promise<SowUploadJobAccepted> {
  console.log("[study/api] uploadSowDocument START", { file, exam_type });
  const form = new FormData();
  form.append("file", { uri: file.uri, name: file.name, type: file.type || "application/octet-stream" } as any);
  if (exam_type) {
    form.append("exam_type", exam_type);
  }

  const res = await apiUpload(
    "/api/v1/study/sow/upload-document",
    form,
    onProgress ? { onProgress } : undefined,
  );
  console.log("[study/api] uploadSowDocument RESPONSE", { status: res.status, statusText: res.statusText });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    console.log("[study/api] uploadSowDocument ERROR", err);
    throw new Error(err.detail || "Document upload failed");
  }
  const data = await res.json();
  console.log("[study/api] uploadSowDocument SUCCESS", data);
  return data;
}

/**
 * Poll the status of an in-flight SOW upload. Calls `onTick(status)`
 * on every poll so the caller can advance its progress bar. Resolves
 * with the final `SowJobStatus` (status === "completed" | "failed")
 * or rejects after `timeoutMs`. Linear 1s polling for v1 — easy to
 * reason about and matches the project's `recent-credits` pattern.
 */
export async function pollSowJob(
  jobId: string,
  onTick?: (status: SowJobStatus) => void,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<SowJobStatus> {
  const { intervalMs = 1000, timeoutMs = 180_000 } = opts;
  const deadline = Date.now() + timeoutMs;
  let last: SowJobStatus | null = null;
  while (Date.now() < deadline) {
    const res = await apiFetch(`/api/v1/study/sow/jobs/${jobId}`);
    if (!res.ok) {
      throw new Error("Failed to fetch upload status");
    }
    const status = (await res.json()) as SowJobStatus;
    last = status;
    onTick?.(status);
    if (status.status === "completed" || status.status === "failed") {
      return status;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Upload processing timed out after ${Math.round(timeoutMs / 1000)}s`,
  );
}

export async function fetchMaterials(): Promise<MaterialSummary[]> {
  const res = await apiFetch("/api/v1/study/materials");
  if (!res.ok) throw new Error("Failed to load materials");
  return res.json();
}

export async function fetchMaterial(id: number): Promise<MaterialDetail> {
  const res = await apiFetch(`/api/v1/study/materials/${id}`);
  if (!res.ok) throw new Error("Failed to load material");
  return res.json();
}

export async function deleteMaterial(id: number): Promise<void> {
  const res = await apiFetch(`/api/v1/study/materials/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Delete failed");
  }
  await clearMaterialFileCache(id);
}

export async function updateMaterial(
  id: number,
  payload: { title?: string; exam_type?: string | null },
): Promise<MaterialDetail> {
  const res = await apiFetch(`/api/v1/study/materials/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Update failed");
  }
  const data = (await res.json()) as MaterialDetail;
  await clearMaterialFileCache(id);
  return data;
}

export async function generateAsset(
  payload: GenerateAssetRequest,
): Promise<GenerateAssetResponse> {
  const res = await apiFetch("/api/v1/study/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Generation failed");
  }
  return res.json();
}

export async function unlockAsset(
  payload: UnlockRequest,
): Promise<UnlockResponse> {
  const res = await apiFetch("/api/v1/study/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Unlock failed");
  }
  return res.json();
}

export async function generateExample(
  payload: ExampleGenerateRequest,
): Promise<GenerateAssetResponse> {
  const res = await apiFetch("/api/v1/study/examples/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Example generation failed");
  }
  return res.json();
}

export async function checkExampleAnswer(
  payload: ExampleCheckRequest,
): Promise<ExampleCheckResponse> {
  const res = await apiFetch("/api/v1/study/examples/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Answer check failed");
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
  task_type?: "heavy" | "fast" | "chat";
  max_tokens?: number;
};

export type AiRouteResponse = {
  response: string;
  provider: string;
  model: string;
};

export async function claimQuizBonus(
  payload: QuizCompleteRequest,
): Promise<QuizCompleteResponse> {
  const res = await apiFetch("/api/v1/study/quiz/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Bonus claim failed");
  }
  return res.json();
}

export async function routeAi(
  payload: AiRouteRequest,
): Promise<AiRouteResponse> {
  const res = await apiFetch("/api/v1/ai/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "AI route failed");
  }
  return res.json();
}

export async function sendChatMessage(payload: ChatRequest): Promise<string> {
  const res = await apiFetch("/api/v1/study/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Chat failed");
  }
  return res.text();
}
