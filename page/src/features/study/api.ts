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
  /** The raw text that was read off the upload. */
  content?: string | null;
  file_mime_type?: string | null;
  has_original_file?: boolean;
  /**
   * The teaching layer: the material rewritten in plain language for a
   * beginner, with every diagram described in words. `null` when it
   * could not be built — the faithful `parsed_structure` is still
   * there and the app falls back to it.
   */
  explanation_structure?: Record<string, unknown> | null;
  /** The depth the explanation and the narration are pitched at. */
  education_level?: EducationLevel;
  /** How many pages of the original document were read. */
  page_count?: number;
  /** How many diagrams were found on them. */
  figure_count?: number;
};

/**
 * How deep the explanation and the narration are pitched.
 *
 * "primary" is the default: a student who uploads a syllabus wants it
 * explained to them the way a good teacher would, not the way a paper
 * is written.
 */
export type EducationLevel = "primary" | "secondary" | "tertiary" | "research";

export const EDUCATION_LEVELS: Array<{
  value: EducationLevel;
  label: string;
  blurb: string;
}> = [
  {
    value: "primary",
    label: "Primary",
    blurb: "Simple words and everyday examples",
  },
  {
    value: "secondary",
    label: "Secondary",
    blurb: "More detail, with worked examples",
  },
  {
    value: "tertiary",
    label: "Tertiary",
    blurb: "University level, precise terms",
  },
  {
    value: "research",
    label: "Research",
    blurb: "Assumptions, trade-offs, edge cases",
  },
];

/** One diagram cropped out of an uploaded page. */
export type MaterialFigure = {
  figure_index: number;
  page: number;
  image_url: string | null;
  width: number;
  height: number;
  description: string | null;
  caption: string | null;
};

/** One rendered page of an uploaded document. */
export type MaterialPage = {
  page: number;
  image_url: string | null;
  width: number;
  height: number;
  is_scan: boolean;
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
  /**
   * Real server-side progress, 0-100. The worker writes it as each
   * step completes, so the bar reflects actual work instead of a
   * guessed tick.
   */
  progress?: number | null;
  /**
   * Machine-readable stage code — `queued` | `reading_pages` |
   * `parsing_ai` | `saving` | `completed`. Translated to a label on
   * the client so the user knows *what* is happening.
   */
  stage?: string | null;
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

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatRequest = {
  material_id: number;
  message: string;
  education_level?: "primary" | "secondary" | "tertiary" | "research";
  difficulty?: "easy" | "medium" | "hard";
  /** Active i18n locale (en/ha/ig/pcm/yo); the tutor replies in it. */
  language?: string;
  /** Prior turns, oldest first. Server keeps the last 20. */
  history?: ChatMessage[];
  /**
   * Set to buy this turn with SV when the free daily quota is spent.
   * Without it the server answers 429 carrying the price; with it the
   * turn is billable (or 402 if the balance is short).
   */
  pay_for_turn?: boolean;
};

/**
 * Raised when chat is refused so the caller can distinguish the reasons.
 * A 429 from quota carries `priceSv` — what paying would cost — so the
 * UI can offer it. A 402 is a short balance. A 429 with `paidCapped` set
 * means both the free quota and the paid cap are spent for today.
 */
export class ChatRefusedError extends Error {
  constructor(
    message: string,
    readonly status: 402 | 429,
    readonly priceSv?: number,
    readonly paidCapped = false,
  ) {
    super(message);
    this.name = "ChatRefusedError";
  }
}

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
  education_level?: EducationLevel,
): Promise<SowUploadResponse> {
  const res = await apiFetch("/api/v1/study/sow/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, exam_type, education_level }),
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
  education_level?: EducationLevel,
): Promise<SowUploadJobAccepted> {
  console.log("[study/api] uploadSowImage START", { file, exam_type });
  const form = new FormData();
  form.append("file", { uri: file.uri, name: file.name, type: file.type || "application/octet-stream" } as any);
  if (exam_type) {
    form.append("exam_type", exam_type);
  }
  if (education_level) {
    form.append("education_level", education_level);
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

/**
 * Upload several images as ONE material — the pages of a document.
 *
 * The whole set goes in a single request, so the progress the user
 * sees is the real byte progress of the whole upload, and the server
 * can read every page before it builds the lesson.
 */
export async function uploadSowImages(
  files: Array<{ uri: string; name: string; type: string }>,
  exam_type?: string | null,
  onProgress?: UploadProgressCallback,
  education_level?: EducationLevel,
): Promise<SowUploadJobAccepted> {
  console.log(
    "[study/api] uploadSowImages START",
    { count: files.length, exam_type },
  );
  const form = new FormData();
  for (const file of files) {
    form.append(
      "files",
      {
        uri: file.uri,
        name: file.name,
        type: file.type || "application/octet-stream",
      } as any,
    );
  }
  if (exam_type) {
    form.append("exam_type", exam_type);
  }
  if (education_level) {
    form.append("education_level", education_level);
  }

  const res = await apiUpload(
    "/api/v1/study/sow/upload-images",
    form,
    onProgress ? { onProgress } : undefined,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
}

export async function uploadSowDocument(
  file: { uri: string; name: string; type: string },
  exam_type?: string | null,
  selected_pages?: number[] | null,
  onProgress?: UploadProgressCallback,
  education_level?: EducationLevel,
): Promise<SowUploadJobAccepted> {
  console.log("[study/api] uploadSowDocument START", { file, exam_type, selected_pages });
  const form = new FormData();
  form.append("file", { uri: file.uri, name: file.name, type: file.type || "application/octet-stream" } as any);
  if (exam_type) {
    form.append("exam_type", exam_type);
  }
  if (education_level) {
    form.append("education_level", education_level);
  }
  if (selected_pages && selected_pages.length > 0) {
    form.append("selected_pages", JSON.stringify(selected_pages));
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

export async function sendChatMessage(
  payload: ChatRequest,
  signal?: AbortSignal,
): Promise<string> {
  const res = await apiFetch("/api/v1/study/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  } as RequestInit);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const detail = err.detail || "Chat failed";
    // Distinguish "quota spent, pay to continue" from a real failure so
    // the UI can offer the paid turn rather than dead-ending.
    if (res.status === 402 || res.status === 429) {
      const priceHeader = res.headers?.get?.("X-Chat-Turn-Price");
      const priceSv = priceHeader ? Number(priceHeader) : undefined;
      throw new ChatRefusedError(
        detail,
        res.status,
        Number.isFinite(priceSv) ? priceSv : undefined,
        res.status === 429 && priceSv == null,
      );
    }
    throw new Error(detail);
  }
  return res.text();
}

// ── Exam Mode ────────────────────────────────────────────────────────

export type ExamQuestion = {
  id: number;
  question: string;
  options: string[];
  explanation: string | null;
  saved_answer?: string | null;
};

export type ExamStartResponse = {
  session_id: number;
  exam_type: string;
  total_questions: number;
  duration_seconds: number;
  expires_at: string;
  questions: ExamQuestion[];
};

export type ExamAnswerConfirm = {
  question_id: number;
  is_correct: boolean;
};

export type ExamSubmitResponse = {
  session_id: number;
  score: number;
  correct_count: number;
  wrong_count: number;
  total_questions: number;
  passed: boolean;
};

export type ExamHistoryItem = {
  id: number;
  exam_type: string;
  score: number | null;
  correct_count: number;
  wrong_count: number;
  total_questions: number;
  started_at: string;
  submitted_at: string | null;
  passed: boolean;
};

export type ExamResultDetail = {
  session_id: number;
  exam_type: string;
  score: number;
  correct_count: number;
  wrong_count: number;
  total_questions: number;
  passed: boolean;
  started_at: string;
  submitted_at: string | null;
  questions: Array<{
    id: number;
    question: string;
    options: string[];
    correct_answer: string;
    selected_answer: string | null;
    is_correct: boolean;
    explanation: string | null;
  }>;
};

export async function startExam(
  materialId: number,
  examType: string,
): Promise<ExamStartResponse> {
  const res = await apiFetch("/api/v1/study/exam/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ material_id: materialId, exam_type: examType }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to start exam");
  }
  return res.json();
}

export async function getExamQuestions(sessionId: number): Promise<{
  session_id: number;
  status: string;
  expires_at: string;
  total_questions: number;
  questions: ExamQuestion[];
}> {
  const res = await apiFetch(`/api/v1/study/exam/${sessionId}/questions`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to load exam questions");
  }
  return res.json();
}

export async function submitExamAnswer(
  sessionId: number,
  questionId: number,
  selectedAnswer: string,
): Promise<ExamAnswerConfirm> {
  const res = await apiFetch(`/api/v1/study/exam/${sessionId}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, question_id: questionId, selected_answer: selectedAnswer }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to save answer");
  }
  return res.json();
}

export async function submitExam(sessionId: number): Promise<ExamSubmitResponse> {
  const res = await apiFetch(`/api/v1/study/exam/${sessionId}/submit`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to submit exam");
  }
  return res.json();
}

export async function fetchExamHistory(): Promise<ExamHistoryItem[]> {
  const res = await apiFetch("/api/v1/study/exam/history");
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to load exam history");
  }
  return res.json();
}

export async function fetchExamResult(sessionId: number): Promise<ExamResultDetail> {
  const res = await apiFetch(`/api/v1/study/exam/${sessionId}/result`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to load exam result");
  }
  return res.json();
}

// ── Page and figure artifacts ────────────────────────────────────────
//
// The pages and the diagram crops of an uploaded material. They were
// written to object storage when the material was uploaded, so the
// phone loads them from the CDN instead of pulling a base64 blob of
// every page through the API.

export async function fetchMaterialPages(id: number): Promise<MaterialPage[]> {
  const res = await apiFetch(`/api/v1/study/materials/${id}/page-images`);
  if (!res.ok) throw new Error("Failed to load pages");
  return res.json();
}

export async function fetchMaterialFigures(id: number): Promise<MaterialFigure[]> {
  const res = await apiFetch(`/api/v1/study/materials/${id}/figures`);
  if (!res.ok) throw new Error("Failed to load figures");
  return res.json();
}

// ── Podcast (paid audio narration) ───────────────────────────────────

export type AudioTopic = {
  topic_index: number;
  topic_name: string;
  episodes: number;
  char_count: number;
  estimated_seconds: number;
  cost_sv: number;
};

export type AudioTopicsResponse = {
  material_id: number;
  title: string;
  topics: AudioTopic[];
  levels: EducationLevel[];
  default_level: EducationLevel;
};

export type AudioQuote = {
  level: EducationLevel;
  topics: AudioTopic[];
  topic_count: number;
  episode_count: number;
  total_char_count: number;
  total_cost_sv: number;
  estimated_seconds: number;
  balance_sv: number;
};

export type AudioEpisode = {
  id: number;
  topic_index: number;
  episode_index: number;
  total_episodes: number;
  level: EducationLevel;
  status: "queued" | "generating" | "ready" | "failed";
  cost_sv: number;
  char_count: number;
  estimated_seconds: number;
  actual_duration_seconds: number | null;
  audio_url: string | null;
  position_seconds: number;
  completed_at: string | null;
  refunded_at: string | null;
  error_message: string | null;
  created_at: string | null;
};

export type AudioBatchesResponse = {
  material_id: number;
  episodes: AudioEpisode[];
  next_episode_id: number | null;
  total_cost_sv: number;
  refunded_sv: number;
};

export async function fetchAudioTopics(
  materialId: number,
): Promise<AudioTopicsResponse> {
  const res = await apiFetch(`/api/v1/study/audio/topics/${materialId}`);
  if (!res.ok) throw new Error("Failed to load narratable topics");
  return res.json();
}

export async function quoteAudioNarration(
  materialId: number,
  payload: { topic_indexes: number[]; level?: EducationLevel },
): Promise<AudioQuote> {
  const res = await apiFetch(`/api/v1/study/audio/quote/${materialId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Could not price the narration");
  }
  return res.json();
}

export type AudioBatchCreateResult = {
  ok: boolean;
  error?: string;
  detail?: string;
  cost_sv?: number;
  balance_sv?: number;
  created?: number;
  reused?: number;
  episodes?: AudioEpisode[];
};

export async function createAudioBatches(
  materialId: number,
  payload: { topic_indexes: number[]; level?: EducationLevel },
): Promise<AudioBatchCreateResult> {
  const res = await apiFetch(`/api/v1/study/audio/batches/${materialId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || "Could not start generation");
  }
  return data as AudioBatchCreateResult;
}

export async function fetchAudioBatches(
  materialId: number,
): Promise<AudioBatchesResponse> {
  const res = await apiFetch(`/api/v1/study/audio/batches/${materialId}`);
  if (!res.ok) throw new Error("Failed to load episodes");
  return res.json();
}

/**
 * Ask the server for the next queued episode to be generated.
 *
 * Generation is client-driven on purpose: Render's free tier cannot be
 * relied on to run in-process background tasks, and driving it from
 * the client keeps every bit of progress in Postgres. The server
 * answers with `{ error: "generation_failed", refunded: true }` when
 * an episode fails, so the UI can say so and stop.
 */
export async function generateNextAudioEpisode(
  materialId: number,
): Promise<{
  processed: number | null;
  topic_index?: number;
  episode_index?: number;
  remaining: number;
  error?: string;
  refunded?: boolean;
}> {
  const res = await apiFetch(`/api/v1/study/audio/generate-next/${materialId}`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to generate the next episode");
  return res.json();
}

export async function saveAudioPosition(
  batchId: number,
  payload: { position_seconds: number; completed?: boolean },
): Promise<void> {
  const res = await apiFetch(`/api/v1/study/audio/batches/${batchId}/position`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to save the playback position");
}

export async function retryAudioBatch(batchId: number): Promise<void> {
  const res = await apiFetch(`/api/v1/study/audio/batches/${batchId}/retry`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to retry the episode");
}
