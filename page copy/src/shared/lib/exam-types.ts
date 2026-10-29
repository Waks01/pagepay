/**
 * Canonical exam-type registry (frontend mirror).
 *
 * Every chip group in the app renders from this single list: the upload
 * card, the two edit sheets, and the Exam Mode setup grid. Adding a
 * board is a one-line change here.
 *
 * `duration` (minutes) and `questions` must stay in sync with the
 * backend registry at backend/app/exam_types.py. That agreement is
 * enforced by backend/tests/test_exam.py::test_exam_types_match_client,
 * which parses this file — keep the object literal shape intact.
 */

export type ExamTypeKey = "jamb" | "waec" | "neco" | "nabteb" | "custom";

export type ExamTypeSpec = {
  /** Stable identifier stored in the DB and sent over the wire. */
  key: ExamTypeKey;
  /** English label. Translated at render time via i18n. */
  label: string;
  /** Minutes allowed for the whole attempt. */
  duration: number;
  /** How many MCQs the generator should produce. */
  questions: number;
};

export const EXAM_TYPES: readonly ExamTypeSpec[] = [
  { key: "jamb", label: "JAMB", duration: 20, questions: 20 },
  { key: "waec", label: "WAEC", duration: 25, questions: 20 },
  { key: "neco", label: "NECO", duration: 25, questions: 20 },
  { key: "nabteb", label: "NABTEB", duration: 25, questions: 20 },
  { key: "custom", label: "Custom", duration: 10, questions: 10 },
];

/** Valid keys, in display order. */
export const EXAM_TYPE_KEYS: readonly ExamTypeKey[] = EXAM_TYPES.map(
  (spec) => spec.key,
);

const BY_KEY = new Map<ExamTypeKey, ExamTypeSpec>(
  EXAM_TYPES.map((spec) => [spec.key, spec]),
);

export function getExamTypeSpec(key: string | null | undefined): ExamTypeSpec | undefined {
  if (!key) return undefined;
  return BY_KEY.get(key as ExamTypeKey);
}

/** Display label for a stored value, falling back to "Custom". */
export function getExamTypeLabel(key: string | null | undefined): string {
  return getExamTypeSpec(key)?.label ?? "Custom";
}

/**
 * Coerce user input to a canonical key.
 *
 * Accepts any casing and surrounding whitespace; returns null for empty
 * input, which is the valid "no exam type" state.
 */
export function normalizeExamTypeKey(
  value: string | null | undefined,
): ExamTypeKey | null {
  if (!value) return null;
  const key = value.trim().toLowerCase();
  if (!key) return null;
  return (BY_KEY.get(key as ExamTypeKey)?.key as ExamTypeKey) ?? null;
}

export function isExamTypeKey(value: string): value is ExamTypeKey {
  return BY_KEY.has(value as ExamTypeKey);
}
